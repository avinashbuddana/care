import { Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { AccessGuard } from './common/guards/access.guard';
import { AuthService } from './modules/auth/auth.service';
import { AuthController } from './modules/auth/auth.controller';
import { DatasetsController } from './modules/datasets/datasets.controller';
import { DatasetsService } from './modules/datasets/datasets.service';
import {
  ProposalsController,
  HandoffsController,
} from './modules/schema-proposals/proposals.controller';
import { UploadsController } from './modules/uploads/uploads.controller';
import { ImportsController } from './modules/imports/imports.controller';
import { SettingsController } from './modules/settings/settings.controller';
import { BedrockService } from './modules/bedrock/bedrock.service';
import { AuditService } from './modules/audit/audit.service';
import { AuditController } from './modules/audit/audit.controller';
import { UsersController } from './modules/users/users.controller';
import { HealthController } from './modules/health/health.controller';
import { RelationshipsController } from './modules/relationships/relationships.controller';
import { dataSource } from './database/data-source';
@Module({
  imports: [DatabaseModule],
  controllers: [
    AuthController,
    DatasetsController,
    ProposalsController,
    HandoffsController,
    UploadsController,
    ImportsController,
    SettingsController,
    AuditController,
    UsersController,
    HealthController,
    RelationshipsController,
  ],
  providers: [
    AuthService,
    DatasetsService,
    BedrockService,
    AuditService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule implements OnModuleDestroy, OnModuleInit {
  async onModuleInit(): Promise<void> {
    if (!dataSource.isInitialized) await dataSource.initialize();
  }
  async onModuleDestroy(): Promise<void> {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}
