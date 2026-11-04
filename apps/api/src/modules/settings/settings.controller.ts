import { Body, Controller, Get, Put, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { conventionsSchema, identifier } from '@platform/contracts';
import { Allowed } from '../../common/guards/access.guard';
import { Database } from '../../database/database.module';
import { parse } from '../../common/validation/parse';
import { requestUser } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { BedrockService } from '../bedrock/bedrock.service';
@Allowed('admin')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly db: Database,
    private readonly bedrock: BedrockService,
    private readonly audit: AuditService,
  ) {}
  @Get('repository') async repository(): Promise<unknown> {
    const rows = await this.db.query("SELECT value FROM platform.settings WHERE key='repository'");
    return conventionsSchema.parse(rows[0]?.value ?? {});
  }
  @Put('repository') async saveRepository(
    @Body() input: unknown,
    @Req() req: Request,
  ): Promise<unknown> {
    const value = parse(conventionsSchema, input);
    await this.db.query(
      "INSERT INTO platform.settings(key,value) VALUES('repository',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [JSON.stringify(value)],
    );
    await this.audit.write(requestUser(req).id, 'settings.repository_changed', null, {
      configured: true,
    });
    return value;
  }
  @Get('bedrock') bedrockSettings(): Promise<unknown> {
    return this.bedrock.settings();
  }
  @Put('bedrock') async saveBedrock(@Body() input: unknown, @Req() req: Request): Promise<unknown> {
    const result = await this.bedrock.save(input);
    await this.audit.write(requestUser(req).id, 'settings.bedrock_changed', null, {
      enabled: result.enabled,
      authMode: result.authMode,
      region: result.region,
    });
    return result;
  }
  @Post('bedrock/test') test(): Promise<unknown> {
    return this.bedrock.test();
  }
  @Post('bedrock/recommend') recommend(@Body() input: unknown): Promise<unknown> {
    const value = parse(
      z.object({ uploadId: z.string().uuid(), table: identifier }).strict(),
      input,
    );
    return this.bedrock.recommend(value.uploadId, value.table);
  }
}
