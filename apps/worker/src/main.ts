import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}
void main().catch(() => {
  process.stderr.write(
    'Worker startup failed. Verify validated configuration and service availability.\n',
  );
  process.exitCode = 1;
});
