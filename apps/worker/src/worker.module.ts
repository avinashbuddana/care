import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { redis } from './config/config';
import { Database, ImportProcessor, QueueRecovery } from './processors/import.processor';
@Module({
  imports: [
    BullModule.forRoot({ connection: redis }),
    BullModule.registerQueue({ name: 'imports' }),
  ],
  providers: [Database, ImportProcessor, QueueRecovery],
})
export class WorkerModule {}
