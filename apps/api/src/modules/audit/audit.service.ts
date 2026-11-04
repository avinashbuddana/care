import { Injectable } from '@nestjs/common';
import { Database } from '../../database/database.module';
@Injectable()
export class AuditService {
  constructor(private readonly db: Database) {}
  async write(
    actorId: string | null,
    action: string,
    resourceId: string | null,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.db.query(
      'INSERT INTO platform.audit_events(actor_id,action,resource_id,details) VALUES($1,$2,$3,$4)',
      [actorId, action, resourceId, JSON.stringify(details)],
    );
  }
}
