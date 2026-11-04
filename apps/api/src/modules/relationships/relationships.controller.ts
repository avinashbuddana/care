import { BadRequestException, Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { identifier } from '@platform/contracts';
import {
  analyzeReference,
  suggestReferences,
  uploadPath,
  type ReferenceAnalysis,
  type ReferenceSuggestion,
} from '@platform/ingestion';
import { Allowed } from '../../common/guards/access.guard';
import { parse } from '../../common/validation/parse';
import { loadEnvironment } from '../../config/environment';
import { Database } from '../../database/database.module';
import { DatasetsService } from '../datasets/datasets.service';

const analyzeSchema = z
  .object({
    uploadId: z.string().uuid(),
    sourceHeader: z.string().min(1).max(200),
    targetDatasetId: z.string().uuid(),
    targetColumn: identifier,
  })
  .strict();

// Messages produced by our own CSV/catalog checks are safe to show; anything else stays generic.
function rethrow(error: unknown): never {
  if (
    error instanceof Error &&
    /^(CSV|Blank|Duplicate|Invalid|Truncated|app\.)/.test(error.message)
  )
    throw new BadRequestException(error.message);
  throw new BadRequestException('Reference analysis failed. Check the upload and target dataset.');
}

@ApiTags('Relationships')
@Allowed('admin')
@Controller('relationships')
export class RelationshipsController {
  constructor(
    private readonly db: Database,
    private readonly datasets: DatasetsService,
  ) {}

  private async uploadFile(uploadId: string): Promise<string> {
    const rows = await this.db.query('SELECT storage_key FROM platform.uploads WHERE id=$1', [
      uploadId,
    ]);
    if (!rows[0]) throw new NotFoundException('Upload not found');
    return uploadPath(loadEnvironment().STORAGE_ROOT, z.string().parse(rows[0].storage_key));
  }

  /** Full-file match analysis of one CSV column against a verified parent dataset column. */
  @Post('analyze') async analyze(@Body() input: unknown): Promise<ReferenceAnalysis> {
    const value = parse(analyzeSchema, input);
    const target = await this.datasets.get(value.targetDatasetId);
    if (target.status !== 'ready')
      throw new BadRequestException('Verify the parent dataset before analysing references.');
    if (!target.contract.columns.some((c) => c.name === value.targetColumn))
      throw new BadRequestException('Target column is not part of the parent import contract.');
    const path = await this.uploadFile(value.uploadId);
    return analyzeReference(this.db.pool, path, value.sourceHeader, {
      table: target.contract.table,
      column: value.targetColumn,
    }).catch(rethrow);
  }

  /** Value-overlap suggestions against verified single-key datasets; never name-based. */
  @Post('suggest') async suggest(
    @Body() input: unknown,
  ): Promise<(ReferenceSuggestion & { targetDatasetId: string })[]> {
    const { uploadId } = parse(z.object({ uploadId: z.string().uuid() }).strict(), input);
    const path = await this.uploadFile(uploadId);
    const ready = (
      await this.db.query("SELECT id FROM platform.datasets WHERE status='ready'")
    ).map((r) => z.string().parse(r.id));
    const targets = (await Promise.all(ready.map((id) => this.datasets.get(id))))
      .filter((d) => d.contract.uniqueKey.length === 1)
      .map((d) => ({ id: d.id, table: d.contract.table, column: d.contract.uniqueKey[0] ?? '' }));
    const suggestions = await suggestReferences(
      this.db.pool,
      path,
      targets.map(({ table, column }) => ({ table, column })),
      loadEnvironment().PROFILE_SAMPLE_ROWS,
    ).catch(rethrow);
    return suggestions.map((s) => ({
      ...s,
      targetDatasetId: targets.find((t) => t.table === s.target.table)?.id ?? '',
    }));
  }
}
