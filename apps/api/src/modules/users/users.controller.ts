import { Controller, Get, Post, Put, Body, Param, Req, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { roles } from '@platform/contracts';
import { Allowed } from '../../common/guards/access.guard';
import { parse, uuid } from '../../common/validation/parse';
import { Database } from '../../database/database.module';
import { hashPassword } from '../auth/password';
import { requestUser } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
@Allowed('admin')
@Controller('users')
export class UsersController {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}
  @Get() list(): Promise<unknown> {
    return this.db.query('SELECT id,email,role FROM platform.users ORDER BY email');
  }
  @Post() async create(@Body() input: unknown, @Req() req: Request): Promise<unknown> {
    const value = parse(
      z
        .object({ email: z.string().email(), password: z.string().min(12).max(200), role: roles })
        .strict(),
      input,
    );
    const existing = await this.db.query('SELECT id FROM platform.users WHERE email=$1', [
      value.email.toLowerCase(),
    ]);
    if (existing.length) throw new BadRequestException('Email already exists');
    const rows = await this.db.query(
      'INSERT INTO platform.users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id,email,role',
      [value.email.toLowerCase(), await hashPassword(value.password), value.role],
    );
    await this.audit.write(requestUser(req).id, 'user.created', String(rows[0]?.id), {
      role: value.role,
    });
    return rows[0];
  }
  @Get(':id/grants') async grants(@Param('id') raw: string): Promise<unknown> {
    return this.db.query(
      'SELECT dataset_id AS "datasetId",can_import AS "canImport" FROM platform.dataset_grants WHERE user_id=$1',
      [uuid(raw)],
    );
  }
  @Put(':id/grants') async grant(
    @Param('id') raw: string,
    @Body() input: unknown,
    @Req() req: Request,
  ): Promise<unknown> {
    const id = uuid(raw);
    const value = parse(
      z
        .object({
          datasetId: z.string().uuid(),
          canImport: z.boolean(),
          revoke: z.boolean().optional(),
        })
        .strict(),
      input,
    );
    if (value.revoke)
      await this.db.query(
        'DELETE FROM platform.dataset_grants WHERE user_id=$1 AND dataset_id=$2',
        [id, value.datasetId],
      );
    else
      await this.db.query(
        'INSERT INTO platform.dataset_grants(user_id,dataset_id,can_import) VALUES($1,$2,$3) ON CONFLICT(user_id,dataset_id) DO UPDATE SET can_import=excluded.can_import',
        [id, value.datasetId, value.canImport],
      );
    await this.audit.write(requestUser(req).id, 'user.dataset_grant_changed', id, {
      datasetId: value.datasetId,
      canImport: value.canImport,
      revoke: value.revoke ?? false,
    });
    return { ok: true };
  }
}
