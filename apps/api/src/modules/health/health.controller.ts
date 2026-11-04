import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/guards/access.guard';
import { Database } from '../../database/database.module';
import { loadEnvironment } from '../../config/environment';
@Controller()
export class HealthController {
  constructor(private readonly db: Database) {}
  @Public() @Get('health') async health(): Promise<unknown> {
    await this.db.query('SELECT 1');
    return { status: 'ok' };
  }
  @Get('analytics') analytics(): unknown {
    return { url: loadEnvironment().SUPERSET_URL, separateAuthentication: true };
  }
}
