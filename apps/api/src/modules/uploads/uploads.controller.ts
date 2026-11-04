import {
  Controller,
  Get,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { Request } from 'express';
import { profileCsv } from '@platform/ingestion';
import { loadEnvironment } from '../../config/environment';
import { Allowed } from '../../common/guards/access.guard';
import { Database } from '../../database/database.module';
import { requestUser } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
@Controller('uploads')
@Allowed('admin', 'operator')
export class UploadsController {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}
  @Get() async list(@Req() req: Request): Promise<unknown> {
    const user = requestUser(req);
    const rows = await this.db.query(
      `SELECT id,original_name,bytes,profile,created_at FROM platform.uploads ${user.role === 'admin' ? '' : 'WHERE uploaded_by=$1'} ORDER BY created_at DESC LIMIT 200`,
      user.role === 'admin' ? [] : [user.id],
    );
    return rows.map((r) => ({
      id: r.id,
      originalName: r.original_name,
      bytes: Number(r.bytes),
      profile: r.profile,
      createdAt: r.created_at,
    }));
  }
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const root = resolve(loadEnvironment().STORAGE_ROOT);
          mkdirSync(root, { recursive: true, mode: 0o700 });
          cb(null, root);
        },
        filename: (_req, _file, cb) => cb(null, `${randomUUID()}.csv`),
      }),
      limits: { fileSize: loadEnvironment().UPLOAD_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<unknown> {
    if (!file) throw new BadRequestException('Upload a CSV file');
    try {
      const profile = await profileCsv(file.path, loadEnvironment().PROFILE_SAMPLE_ROWS);
      const rows = await this.db.query(
        'INSERT INTO platform.uploads(original_name,storage_key,bytes,profile,uploaded_by) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at',
        [
          basename(file.originalname).slice(0, 200),
          file.filename,
          file.size,
          JSON.stringify(profile),
          requestUser(req).id,
        ],
      );
      await this.audit.write(requestUser(req).id, 'upload.profiled', String(rows[0]?.id), {
        bytes: file.size,
        rowsSampled: profile.rowsSampled,
        sampled: profile.sampled,
      });
      return {
        id: rows[0]?.id,
        originalName: basename(file.originalname),
        bytes: file.size,
        profile,
        createdAt: rows[0]?.created_at,
      };
    } catch (error: unknown) {
      await unlink(file.path).catch(() => undefined);
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'CSV profiling failed. Use valid UTF-8 CSV with unique headers and consistent quoting; check delimiter and maximum row length.',
      );
    }
  }
}
