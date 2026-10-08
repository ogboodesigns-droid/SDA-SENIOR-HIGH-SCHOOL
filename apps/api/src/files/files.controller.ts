import {
  BadRequestException,
  Controller,
  Get,
  Global,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { isLeadership, UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES } from '@sda-shs/shared';
import type { Response } from 'express';
import { InjectDb, type Database } from '../database/database.module';
import { assignments, files, submissions } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators';
import { AccessService } from '../access/access.service';
import { StorageService } from './storage.service';

type AllowedMime = (typeof UPLOAD_MIME_TYPES)[number];

/** Checks the file's leading bytes so a renamed executable can't pass as a PDF. */
function sniff(buf: Buffer): AllowedMime | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return 'application/msword';
  if (starts(0x50, 0x4b, 0x03, 0x04)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return null;
}

const EXTENSIONS: Record<AllowedMime, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

@Injectable()
export class FilesService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: AccessService,
  ) {}

  /** The uploader, or anyone allowed to read the submission the file is attached to. */
  async assertCanRead(user: AuthUser, fileId: string) {
    const [file] = await this.db.select().from(files).where(eq(files.id, fileId));
    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId === user.id || isLeadership(user.role)) return file;

    const [sub] = await this.db
      .select({ studentId: submissions.studentId, classId: assignments.classId, subjectId: assignments.subjectId })
      .from(submissions)
      .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
      .where(eq(submissions.fileId, fileId))
      .limit(1);
    if (sub) {
      if (user.role === 'teacher' && (await this.access.teachesSubject(user.id, sub.classId, sub.subjectId))) return file;
      if (user.role === 'parent' && (await this.access.childStudentIds(user.id)).includes(sub.studentId)) return file;
    }
    throw new NotFoundException('File not found');
  }

  /** Files can be attached only by the person who uploaded them. */
  async assertOwned(user: AuthUser, fileId: string) {
    const [file] = await this.db.select({ id: files.id }).from(files).where(and(eq(files.id, fileId), eq(files.ownerId, user.id)));
    if (!file) throw new BadRequestException('Attach a file you uploaded');
  }
}

@Controller('files')
export class FilesController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly storage: StorageService,
    private readonly service: FilesService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose a file to upload');
    const mime = sniff(file.buffer);
    if (!mime) throw new BadRequestException('Upload a PDF, Word document, JPEG or PNG');

    const id = randomUUID();
    const key = `uploads/${new Date().toISOString().slice(0, 7)}/${id}.${EXTENSIONS[mime]}`;
    await this.storage.put(key, file.buffer, mime);
    const fileName = file.originalname.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || `file.${EXTENSIONS[mime]}`;
    const [row] = await this.db
      .insert(files)
      .values({
        id,
        ownerId: user.id,
        storageKey: key,
        fileName,
        mimeType: mime,
        sizeBytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
      })
      .returning({ id: files.id, fileName: files.fileName, mimeType: files.mimeType, sizeBytes: files.sizeBytes });
    return row;
  }

  @Get(':id')
  async download(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.service.assertCanRead(user, id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(await this.storage.get(file.storageKey), {
      type: file.mimeType,
      length: file.sizeBytes,
      disposition: `attachment; filename="${encodeURIComponent(file.fileName)}"`,
    });
  }
}

@Global()
@Module({ controllers: [FilesController], providers: [StorageService, FilesService], exports: [FilesService] })
export class FilesModule {}
