import { Injectable, NotFoundException } from '@nestjs/common';
import { Database } from '../../database/database.module';
import { contractSchema } from '@platform/contracts';
import { deployedDatasets } from '../../database/registry';
import { dataSource } from '../../database/data-source';
import { verifyContract } from '@platform/ingestion';
import { contractHash } from '../developer-handoff/templates';
import { AuditService } from '../audit/audit.service';
import { z } from 'zod';
const datasetRow = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  contract: contractSchema,
  proposal_id: z.string().uuid().nullable(),
  verification: z.unknown(),
  created_at: z.date(),
});
@Injectable()
export class DatasetsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}
  async get(id: string): Promise<z.infer<typeof datasetRow>> {
    const rows = await this.db.query('SELECT * FROM platform.datasets WHERE id=$1', [id]);
    if (!rows[0]) throw new NotFoundException('Dataset not found');
    return datasetRow.parse(rows[0]);
  }
  async verify(id: string, actorId: string): Promise<{ ready: boolean; errors: string[] }> {
    const dataset = await this.get(id);
    const contract = dataset.contract;
    const errors: string[] = [];
    const registration = deployedDatasets.find((d) => d.contract.table === contract.table);
    if (!registration)
      errors.push(
        'No repository-managed deployed dataset registration. Apply the proposed registry insertion and deploy.',
      );
    else {
      if (contractHash(registration.contract) !== contractHash(contract))
        errors.push(
          'Deployed import contract differs from the approved contract. Reconcile proposal before activation.',
        );
      if (!dataSource.isInitialized) await dataSource.initialize();
      if (!dataSource.hasMetadata(registration.entity))
        errors.push('TypeORM entity is not registered in the deployed DataSource.');
      const migrations = await this.db.query(
        'SELECT name FROM public.typeorm_migrations WHERE name=$1',
        [registration.migration],
      );
      if (!migrations.length)
        errors.push(
          `Required deployed migration ${registration.migration} is missing from TypeORM history.`,
        );
    }
    if (dataset.proposal_id) {
      const handoffs = await this.db.query(
        'SELECT contract_hash,proposal_version FROM platform.developer_handoffs WHERE proposal_id=$1 ORDER BY created_at DESC LIMIT 1',
        [dataset.proposal_id],
      );
      const h = handoffs[0];
      if (
        !h ||
        h.contract_hash !== contractHash(contract) ||
        h.proposal_version !== contract.version
      )
        errors.push('Handoff version and deployed contract do not match.');
    }
    const client = await this.db.pool.connect();
    try {
      errors.push(...(await verifyContract(client, contract)));
    } finally {
      client.release();
    }
    const result = { ready: errors.length === 0, errors };
    await this.db.query('UPDATE platform.datasets SET status=$2,verification=$3 WHERE id=$1', [
      id,
      result.ready ? 'ready' : 'awaiting_deployment',
      JSON.stringify({ ...result, checkedAt: new Date().toISOString() }),
    ]);
    if (dataset.proposal_id && result.ready)
      await this.db.query("UPDATE platform.schema_proposals SET status='ready' WHERE id=$1", [
        dataset.proposal_id,
      ]);
    await this.audit.write(actorId, 'schema.verified', id, result);
    return result;
  }
}
