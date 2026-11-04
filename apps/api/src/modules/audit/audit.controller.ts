import { Controller, Get, Query } from '@nestjs/common';
import { Allowed } from '../../common/guards/access.guard';
import { Database } from '../../database/database.module';
import { pagination, parse } from '../../common/validation/parse';
@Allowed('admin')
@Controller('audit')
export class AuditController {
  constructor(private readonly db: Database) {}
  @Get() async list(@Query() input: unknown): Promise<unknown> {
    const p = parse(pagination, input);
    const rows = await this.db.query(
      'SELECT id,actor_id AS "actorId",action,resource_id AS "resourceId",details,created_at AS "createdAt" FROM platform.audit_events ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [p.pageSize, (p.page - 1) * p.pageSize],
    );
    return rows;
  }
}
