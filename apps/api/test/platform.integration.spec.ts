import 'reflect-metadata';
import { Server } from 'node:http';
import {
  createServer,
  type Http2Server,
  type Http2Session,
  type IncomingHttpHeaders,
} from 'node:http2';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { Pool } from 'pg';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
import { artifactSchema, contractSchema, conventionsSchema } from '@platform/contracts';
import { verifyContract } from '@platform/ingestion';
import { hashPassword } from '../src/modules/auth/password';
import { generateArtifacts } from '../src/modules/developer-handoff/templates';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const suite = enabled ? describe : describe.skip;
const DEPARTMENTS = '10000000-0000-4000-8000-000000000001';

/**
 * Minimal stand-in for the Bedrock Runtime Converse endpoint, reached through the real SDK via
 * AWS_ENDPOINT_URL_BEDROCK_RUNTIME. The SDK speaks HTTP/2 to Bedrock Runtime, so this is h2c.
 */
interface FakeBedrock {
  reply: { status: number; body: string; errorType?: string };
  last: { body: string; headers: IncomingHttpHeaders } | undefined;
}
function converseBody(text: string): string {
  return JSON.stringify({
    output: { message: { role: 'assistant', content: [{ text }] } },
    stopReason: 'end_turn',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    metrics: { latencyMs: 1 },
  });
}

interface Migration {
  up(q: { query: (sql: string) => Promise<unknown> }): Promise<void>;
  down(q: { query: (sql: string) => Promise<unknown> }): Promise<void>;
}
function isMigration(value: unknown): value is Migration {
  return (
    typeof value === 'object' &&
    value !== null &&
    'up' in value &&
    typeof value.up === 'function' &&
    'down' in value &&
    typeof value.down === 'function'
  );
}
/** Compiles a generated migration artifact exactly as a developer's build would, then loads it. */
function loadMigration(source: string): Migration {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(js, { exports, require: () => ({}) });
  const exported = Object.values(exports)[0];
  if (typeof exported !== 'function') throw new Error('Migration class not exported');
  const instance: unknown = Reflect.construct(exported, []);
  if (!isMigration(instance)) throw new Error('Not a migration');
  return instance;
}

suite('PostgreSQL API safety boundaries', () => {
  let app: INestApplication;
  let http: Server;
  let pool: Pool;
  let cookie: string;
  let userId: string;
  let storage: string;
  let bedrockServer: Http2Server;
  const fake: FakeBedrock = { reply: { status: 200, body: converseBody('{}') }, last: undefined };
  const logs: string[] = [];
  const sessions = new Set<Http2Session>();
  const email = `integration-${Date.now()}@example.test`;
  const password = 'A-test-password-012345';
  const contract = contractSchema.parse({
    version: 1,
    table: `proposal_test_${Date.now()}`,
    columns: [
      { name: 'source_code', source: 'Code', type: 'text', nullable: false },
      { name: 'name', source: 'Name', type: 'text', nullable: false },
      { name: 'source_updated_at', source: 'Modified', type: 'timestamptz', nullable: true },
    ],
    uniqueKey: ['source_code'],
    references: [],
    reportingColumns: ['source_code', 'name'],
  });
  const rows = <T>(schema: z.ZodType<T>, result: { rows: unknown[] }): T[] =>
    z.array(schema).parse(result.rows);

  beforeAll(async () => {
    storage = await mkdtemp(join(tmpdir(), 'api-integration-'));
    bedrockServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        fake.last = { body, headers: req.headers };
        res.writeHead(fake.reply.status, {
          'content-type': 'application/json',
          ...(fake.reply.errorType ? { 'x-amzn-errortype': fake.reply.errorType } : {}),
        });
        res.end(fake.reply.body);
      });
    });
    // close() waits for idle client sessions; track them so teardown is immediate.
    bedrockServer.on('session', (session) => sessions.add(session));
    await new Promise<void>((resolve) => bedrockServer.listen(0, '127.0.0.1', resolve));
    const address = bedrockServer.address();
    if (!address || typeof address === 'string') throw new Error('No fake Bedrock port');
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      SECRET_ENCRYPTION_KEY: 'a'.repeat(64),
      NODE_ENV: 'test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379',
      STORAGE_ROOT: storage,
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: `http://127.0.0.1:${address.port}`,
      AWS_ACCESS_KEY_ID: 'AKIAFAKECHAINTEST',
      AWS_SECRET_ACCESS_KEY: 'fake-chain-secret-value',
      AWS_EC2_METADATA_DISABLED: 'true',
    });
    // Capture everything the application logs so secret leakage can be asserted.
    for (const stream of [process.stdout, process.stderr])
      jest.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => {
        logs.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      });
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    const { dataSource } = await import('../src/database/data-source');
    await dataSource.initialize();
    await dataSource.runMigrations();
    const inserted = await pool.query(
      "INSERT INTO platform.users(email,password_hash,role) VALUES($1,$2,'admin') RETURNING id",
      [email, await hashPassword(password)],
    );
    userId = z.object({ id: z.string() }).parse(inserted.rows[0]).id;
    const { AppModule } = await import('../src/app.module');
    const { ErrorsFilter } = await import('../src/common/filters/errors.filter');
    app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ErrorsFilter());
    await app.init();
    http = z.instanceof(Server).parse(app.getHttpServer());
    const login = await request(http).post('/api/auth/login').send({ email, password }).expect(201);
    cookie = z.array(z.string()).parse(login.headers['set-cookie'])[0] ?? '';
  });
  afterAll(async () => {
    if (app) await app.close();
    if (pool) {
      await pool.query("DELETE FROM platform.settings WHERE key='bedrock'");
      await pool.query('DELETE FROM app.departments');
      await pool.end();
    }
    for (const session of sessions) session.destroy();
    if (bedrockServer) await new Promise((resolve) => bedrockServer.close(resolve));
    if (storage) await rm(storage, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  async function upload(csv: string, profile: unknown): Promise<string> {
    const id = randomUUID();
    await writeFile(join(storage, `${id}.csv`), csv);
    await pool.query(
      'INSERT INTO platform.uploads(id,original_name,storage_key,bytes,profile,uploaded_by) VALUES($1,$2,$3,$4,$5,$6)',
      [id, 'test.csv', `${id}.csv`, Buffer.byteLength(csv), JSON.stringify(profile), userId],
    );
    return id;
  }
  const profileColumn = (source: string, samples: string[]): Record<string, unknown> => ({
    source,
    name: source.toLowerCase().replace(/\W+/g, '_'),
    type: 'text',
    nullable: false,
    nullPercent: 0,
    maxLength: 30,
    precision: 0,
    scale: 0,
    leadingZeros: false,
    mixed: false,
    uniqueCandidate: true,
    evidence: 'test',
    confidence: 0.8,
    samples,
  });
  const profile = (columns: Record<string, unknown>[]): Record<string, unknown> => ({
    encoding: 'UTF-8',
    delimiter: ',',
    sampled: false,
    rowsSampled: 4,
    columns,
    warnings: [],
  });

  it('runs repository migrations once and keeps entities identical to the migrated schema', async () => {
    const { dataSource } = await import('../src/database/data-source');
    expect(await dataSource.runMigrations()).toEqual([]);
    expect(dataSource.entityMetadatas.some((e) => e.tablePath === 'app.departments')).toBe(true);
    // Same comparison `migration:generate` performs; any drift would emit DROP CONSTRAINT etc.
    const pending = await dataSource.driver.createSchemaBuilder().log();
    expect(pending.upQueries.map((q) => q.query)).toEqual([]);
  });

  it('approval and handoff create no table; the reviewed migration is still required to deploy', async () => {
    const created = await request(http)
      .post('/api/proposals')
      .set('Cookie', cookie)
      .send({ name: 'Manual proposal without AI', contract })
      .expect(201);
    const proposal = z.object({ id: z.string() }).parse(created.body);
    await request(http)
      .post(`/api/proposals/${proposal.id}/approve`)
      .set('Cookie', cookie)
      .send({})
      .expect(201);
    const relation = async (): Promise<string | null> =>
      z
        .object({ r: z.string().nullable() })
        .parse(
          (await pool.query('SELECT to_regclass($1)::text AS r', [`app.${contract.table}`]))
            .rows[0],
        ).r;
    expect(await relation()).toBeNull();
    const handoff = z
      .object({ proposalVersion: z.number(), artifacts: z.array(artifactSchema) })
      .parse(
        (
          await request(http)
            .post(`/api/proposals/${proposal.id}/handoff`)
            .set('Cookie', cookie)
            .send({})
            .expect(201)
        ).body,
      );
    expect(handoff.proposalVersion).toBe(1);
    expect(await relation()).toBeNull();
    const [dataset] = rows(
      z.object({ id: z.string(), status: z.string() }),
      await pool.query('SELECT id,status FROM platform.datasets WHERE proposal_id=$1', [
        proposal.id,
      ]),
    );
    if (!dataset) throw new Error('dataset missing');
    expect(dataset.status).toBe('awaiting_deployment');
    const verify = async (): Promise<{ ready: boolean; errors: string[] }> =>
      z
        .object({ ready: z.boolean(), errors: z.array(z.string()) })
        .parse(
          (
            await request(http)
              .post(`/api/datasets/${dataset.id}/verify`)
              .set('Cookie', cookie)
              .send({})
              .expect(201)
          ).body,
        );
    expect((await verify()).ready).toBe(false);
    await request(http)
      .post('/api/imports')
      .set('Cookie', cookie)
      .send({
        datasetId: dataset.id,
        uploadId: randomUUID(),
        mapping: {
          columns: { source_code: 'Code' },
          mode: 'insert',
          emptyAsNull: true,
          ignored: [],
        },
      })
      .expect(400);
    await request(http)
      .patch(`/api/proposals/${proposal.id}`)
      .set('Cookie', cookie)
      .send({ name: 'changed', contract })
      .expect(400);

    // Simulate the developer applying Alternative B: compile and run the generated migration.
    const migrationArtifact = handoff.artifacts.find((a) => a.path.includes('/migrations/'));
    if (!migrationArtifact) throw new Error('migration artifact missing');
    const migration = loadMigration(migrationArtifact.content);
    const runner = { query: (sql: string) => pool.query(sql) };
    await migration.up(runner);
    try {
      const client = await pool.connect();
      try {
        expect(await verifyContract(client, contract)).toEqual([]);
      } finally {
        client.release();
      }
      // Without the repository registration/entity/migration history, activation stays blocked.
      const result = await verify();
      expect(result.ready).toBe(false);
      expect(result.errors.join(' ')).toContain('deployed dataset registration');

      // Generated trigger: source metadata and no-op updates keep updated_at; business changes advance it.
      const table = `app."${contract.table}"`;
      const stamp = z.object({ updated_at: z.date(), created_at: z.date(), id: z.string() });
      const first = stamp.parse(
        (await pool.query(`INSERT INTO ${table}(source_code,name) VALUES('A','Alpha') RETURNING *`))
          .rows[0],
      );
      const sourceOnly = stamp.parse(
        (
          await pool.query(
            `UPDATE ${table} SET source_updated_at=now() WHERE source_code='A' RETURNING *`,
          )
        ).rows[0],
      );
      expect(sourceOnly.updated_at).toEqual(first.updated_at);
      const business = stamp.parse(
        (await pool.query(`UPDATE ${table} SET name='Beta' WHERE source_code='A' RETURNING *`))
          .rows[0],
      );
      expect(business.updated_at.getTime()).toBeGreaterThan(first.updated_at.getTime());
      expect(business.created_at).toEqual(first.created_at);
      expect(business.id).toBe(first.id);
    } finally {
      await migration.down(runner);
    }
    expect(await relation()).toBeNull();
  });

  it('rejects mutation of immutable proposal snapshots at the database boundary', async () => {
    const [version] = rows(
      z.object({ proposal_id: z.string(), version: z.number() }),
      await pool.query(
        'SELECT proposal_id,version FROM platform.proposal_versions WHERE created_by=$1 LIMIT 1',
        [userId],
      ),
    );
    await expect(
      pool.query(
        'UPDATE platform.proposal_versions SET contract=contract WHERE proposal_id=$1 AND version=$2',
        [version?.proposal_id, version?.version],
      ),
    ).rejects.toThrow('immutable');
  });

  it('Bedrock: sends masked metadata only, validates structured output and maps failures; manual proposals still work', async () => {
    const sensitive = 'SAMPLE-SENSITIVE-VALUE';
    const uploadId = await upload(
      'Employee Code\nX\n',
      profile([profileColumn('Employee Code', [sensitive])]),
    );
    const settings = {
      enabled: true,
      region: 'us-east-1',
      authMode: 'chain',
      inferenceProfileArn:
        'arn:aws:bedrock:us-east-1:000000000000:inference-profile/us.example-model',
      timeoutMs: 5000,
      retries: 0,
      maxTokens: 500,
      shareSamples: false,
      maskSamples: true,
    };
    await request(http)
      .put('/api/settings/bedrock')
      .set('Cookie', cookie)
      .send(settings)
      .expect(200);
    const recommend = () =>
      request(http)
        .post('/api/settings/bedrock/recommend')
        .set('Cookie', cookie)
        .send({ uploadId, table: 'employees' });
    const aiContract = {
      version: 1,
      table: 'employees',
      columns: [{ name: 'employee_code', source: 'Employee Code', type: 'text', nullable: false }],
      uniqueKey: ['employee_code'],
      references: [],
      reportingColumns: [],
    };

    fake.reply = {
      status: 200,
      body: converseBody('```json\n' + JSON.stringify(aiContract) + '\n```'),
    };
    const ok = await recommend().expect(201);
    expect(contractSchema.parse(ok.body).table).toBe('employees');
    expect(fake.last?.body).toContain('untrusted DATA');
    expect(fake.last?.body).not.toContain(sensitive);

    await request(http)
      .put('/api/settings/bedrock')
      .set('Cookie', cookie)
      .send({ ...settings, shareSamples: true })
      .expect(200);
    await recommend().expect(201);
    expect(fake.last?.body).not.toContain(sensitive);
    expect(fake.last?.body).toContain('xxxxxx-xxxxxxxxx-xxxxx');

    fake.reply = { status: 200, body: converseBody('Sure! {"version": 1, oops') };
    expect((await recommend().expect(400)).text).toContain('malformed');
    fake.reply = {
      status: 200,
      body: converseBody(JSON.stringify({ ...aiContract, table: 'users' })),
    };
    expect((await recommend().expect(400)).text).toContain('unsupported');
    fake.reply = { status: 429, body: '{"message":"slow down"}', errorType: 'ThrottlingException' };
    expect((await recommend().expect(400)).text).toContain('throttled');
    fake.reply = { status: 403, body: '{"message":"denied"}', errorType: 'AccessDeniedException' };
    expect(
      (
        await request(http)
          .post('/api/settings/bedrock/test')
          .set('Cookie', cookie)
          .send({})
          .expect(400)
      ).text,
    ).toContain('IAM permissions');

    await request(http)
      .post('/api/proposals')
      .set('Cookie', cookie)
      .send({
        name: 'Manual after AI failure',
        contract: { ...contract, table: `manual_${Date.now()}` },
      })
      .expect(201);
  });

  it('never returns, audits, logs or generates saved credentials', async () => {
    const secret = 'super-secret-example-value';
    const settings = {
      enabled: true,
      region: 'us-east-1',
      authMode: 'explicit',
      accessKeyId: 'AKIAEXPLICITTEST',
      secretAccessKey: secret,
      inferenceProfileArn: 'arn:aws:bedrock:us-east-1:000000000000:inference-profile/example',
      timeoutMs: 5000,
      retries: 0,
      maxTokens: 100,
      shareSamples: false,
      maskSamples: true,
    };
    const saved = await request(http)
      .put('/api/settings/bedrock')
      .set('Cookie', cookie)
      .send(settings)
      .expect(200);
    const read = await request(http).get('/api/settings/bedrock').set('Cookie', cookie).expect(200);
    for (const body of [saved.text, read.text]) {
      expect(body).not.toContain(secret);
      expect(body).not.toContain(settings.accessKeyId);
    }
    expect(z.object({ hasCredentials: z.boolean() }).parse(read.body).hasCredentials).toBe(true);
    const stored = z
      .object({ secret: z.string() })
      .parse(
        (await pool.query("SELECT secret FROM platform.settings WHERE key='bedrock'")).rows[0],
      );
    expect(stored.secret).not.toContain(secret);
    // Saved explicit credentials sign the request; the secret itself is never transmitted.
    fake.reply = { status: 200, body: converseBody('READY') };
    await request(http)
      .post('/api/settings/bedrock/test')
      .set('Cookie', cookie)
      .send({})
      .expect(201);
    expect(fake.last?.headers.authorization).toContain('AKIAEXPLICITTEST');
    expect(JSON.stringify(fake.last)).not.toContain(secret);
    fake.reply = { status: 403, body: '{"message":"denied"}', errorType: 'AccessDeniedException' };
    await request(http)
      .post('/api/settings/bedrock/test')
      .set('Cookie', cookie)
      .send({})
      .expect(400);
    const audit = await pool.query('SELECT details FROM platform.audit_events');
    expect(JSON.stringify(audit.rows)).not.toContain(secret);
    const artifacts = generateArtifacts(
      contract,
      conventionsSchema.parse({}),
      randomUUID(),
      1760000002001,
    );
    expect(JSON.stringify(artifacts)).not.toContain(secret);
    expect(logs.join('')).not.toContain(secret);
    expect(logs.join('')).not.toContain(settings.accessKeyId);
  });

  it('sends a saved Bedrock API key as a bearer token and never returns it', async () => {
    const apiKey = 'bedrock-api-key-example-value';
    const settings = {
      enabled: true,
      region: 'us-east-1',
      authMode: 'apiKey',
      apiKey,
      inferenceProfileArn: 'arn:aws:bedrock:us-east-1:000000000000:inference-profile/example',
      timeoutMs: 5000,
      retries: 0,
      maxTokens: 100,
      shareSamples: false,
      maskSamples: true,
    };
    const saved = await request(http)
      .put('/api/settings/bedrock')
      .set('Cookie', cookie)
      .send(settings)
      .expect(200);
    expect(saved.text).not.toContain(apiKey);
    // Blank key on a later save keeps the stored one.
    const { apiKey: omitted, ...withoutKey } = settings;
    void omitted;
    await request(http)
      .put('/api/settings/bedrock')
      .set('Cookie', cookie)
      .send(withoutKey)
      .expect(200);
    fake.reply = { status: 200, body: converseBody('READY') };
    await request(http)
      .post('/api/settings/bedrock/test')
      .set('Cookie', cookie)
      .send({})
      .expect(201);
    expect(fake.last?.headers.authorization).toBe(`Bearer ${apiKey}`);
    expect(logs.join('')).not.toContain(apiKey);
  });

  it('verifies the deployed Departments dataset, reports upload mismatches and analyses references by value', async () => {
    const verified = await request(http)
      .post(`/api/datasets/${DEPARTMENTS}/verify`)
      .set('Cookie', cookie)
      .send({})
      .expect(201);
    expect(verified.body).toEqual({ ready: true, errors: [] });
    await pool.query(
      "INSERT INTO app.departments(source_department_code,name) VALUES('HR','Human Resources'),('FIN','Finance')",
    );

    const wrong = await upload(
      'Dept,Title\nHR,x\n',
      profile([profileColumn('Dept', ['HR']), profileColumn('Title', ['x'])]),
    );
    const mismatch = await request(http)
      .get(`/api/datasets/${DEPARTMENTS}/compatibility?uploadId=${wrong}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(mismatch.body).toMatchObject({
      compatible: false,
      unexpectedHeaders: ['Dept', 'Title'],
    });

    const employees = await upload(
      'employee_code,department_code,legacy_department\nE1,HR,hr\nE2,FIN,XX\nE3,HR,\nE4,FIN,FIN\n',
      profile([profileColumn('employee_code', [])]),
    );
    const suggestions = z
      .array(
        z.object({ sourceHeader: z.string(), targetDatasetId: z.string(), matchRate: z.number() }),
      )
      .parse(
        (
          await request(http)
            .post('/api/relationships/suggest')
            .set('Cookie', cookie)
            .send({ uploadId: employees })
            .expect(201)
        ).body,
      );
    // Suggested by values only; employee_code and the partially matching column are not suggested.
    expect(suggestions).toEqual([
      { sourceHeader: 'department_code', targetDatasetId: DEPARTMENTS, matchRate: 1 },
    ]);
    const analysis = await request(http)
      .post('/api/relationships/analyze')
      .set('Cookie', cookie)
      .send({
        uploadId: employees,
        sourceHeader: 'legacy_department',
        targetDatasetId: DEPARTMENTS,
        targetColumn: 'source_department_code',
      })
      .expect(201);
    expect(analysis.body).toMatchObject({
      rows: 4,
      emptyRows: 1,
      matchedRows: 1,
      missingRows: 2,
      targetUnique: true,
      targetDuplicateKeys: 0,
      incompatibleValues: 0,
      ambiguousSamples: ['hr'],
      sampled: false,
    });
    expect(
      z
        .object({ missingSamples: z.array(z.string()) })
        .parse(analysis.body)
        .missingSamples.sort(),
    ).toEqual(['XX', 'hr']);
  });

  it('keeps Superset reporting credentials read-only and confined to the reporting schema', async () => {
    const role = z
      .object({ login: z.boolean() })
      .parse(
        (
          await pool.query(
            "SELECT rolcanlogin AS login FROM pg_roles WHERE rolname='reporting_reader'",
          )
        ).rows[0],
      );
    await pool.query('ALTER ROLE reporting_reader LOGIN');
    const url = new URL(process.env.DATABASE_URL ?? '');
    url.username = 'reporting_reader';
    url.password = '';
    const reader = new Pool({ connectionString: url.toString(), max: 1 });
    try {
      const synthetic = await reader.query(
        'SELECT data_origin FROM reporting.synthetic_department_headcount',
      );
      expect(synthetic.rowCount).toBeGreaterThan(0);
      await reader.query('SELECT * FROM reporting.departments');
      for (const sql of [
        "INSERT INTO app.departments(source_department_code,name) VALUES('X','x')",
        'DELETE FROM app.departments',
        'SELECT * FROM app.departments',
        'SELECT * FROM platform.users',
        'CREATE TABLE reporting.injected(id int)',
        'CREATE VIEW reporting.injected AS SELECT 1',
      ])
        await expect(reader.query(sql)).rejects.toThrow(/permission denied/);
    } finally {
      await reader.end();
      if (!role.login) await pool.query('ALTER ROLE reporting_reader NOLOGIN');
    }
  });

  it('enforces authentication, admin role and cross-site protection', async () => {
    await request(http).get('/api/datasets').expect(401);
    await request(http)
      .post('/api/proposals')
      .set('Cookie', cookie)
      .set('Origin', 'https://attacker.example')
      .send({ name: 'bad', contract })
      .expect(403);
    const viewerEmail = `viewer-${Date.now()}@example.test`;
    await pool.query(
      "INSERT INTO platform.users(email,password_hash,role) VALUES($1,$2,'viewer')",
      [viewerEmail, await hashPassword(password)],
    );
    const response = await request(http)
      .post('/api/auth/login')
      .send({ email: viewerEmail, password })
      .expect(201);
    const viewerCookie = z.array(z.string()).parse(response.headers['set-cookie'])[0] ?? '';
    await request(http).get('/api/settings/bedrock').set('Cookie', viewerCookie).expect(403);
    await request(http)
      .post('/api/relationships/suggest')
      .set('Cookie', viewerCookie)
      .send({ uploadId: randomUUID() })
      .expect(403);
    const result = await request(http).get('/api/datasets').set('Cookie', viewerCookie).expect(200);
    expect(result.body).toEqual([]);
  });
});
