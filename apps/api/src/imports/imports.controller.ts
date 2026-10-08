import {
  BadRequestException,
  Controller,
  Get,
  Module,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { InjectDb, type Database } from '../database/database.module';
import type { AuthUser } from '../common/auth-user';
import { clientIp, CurrentUser, RequirePermissions } from '../common/decorators';
import { AccessService } from '../access/access.service';
import { CurriculumService } from '../academics/curriculum.service';
import { ResultsModule } from '../results/results.controller';
import { GradeImportService } from './grade-import.service';
import { StudentImportService } from './student-import.service';
import { buildScoreSheet, buildStudentTemplate } from './templates';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_UPLOAD = 5 * 1024 * 1024;

function xlsxUpload(file?: Express.Multer.File): Buffer {
  if (!file) throw new BadRequestException('Choose the .xlsx file to import');
  // .xlsx files are zip archives: "PK\x03\x04".
  if (!(file.buffer[0] === 0x50 && file.buffer[1] === 0x4b)) throw new BadRequestException('Upload an Excel .xlsx file (not .xls or .csv)');
  return file.buffer;
}

const flag = (v?: string) => v === 'true' || v === '1';

function download(res: Response, buffer: Buffer, fileName: string) {
  res.setHeader('Cache-Control', 'private, no-store');
  return new StreamableFile(buffer, { type: XLSX, length: buffer.length, disposition: `attachment; filename="${encodeURIComponent(fileName)}"` });
}

@Controller('imports')
export class ImportsController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly studentsImport: StudentImportService,
    private readonly gradesImport: GradeImportService,
    private readonly access: AccessService,
    private readonly curriculum: CurriculumService,
  ) {}

  @RequirePermissions('users:manage')
  @Get('students/template')
  async studentTemplate(@Res({ passthrough: true }) res: Response) {
    return download(res, await buildStudentTemplate(this.db), 'SDA SHS Student Registration Import.xlsx');
  }

  /** ?dryRun=true checks every row and changes nothing; without it, valid rows are imported. */
  @RequirePermissions('users:manage')
  @Post('students')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  importStudents(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Query('dryRun') dryRun: string | undefined, @Req() req: Request) {
    return this.studentsImport.run(user, xlsxUpload(file), flag(dryRun), clientIp(req));
  }

  /** The class's score sheet for a subject and semester, with its register and any marks entered. */
  @RequirePermissions('results:enter')
  @Get('results/template')
  async scoreSheet(
    @CurrentUser() user: AuthUser,
    @Query('termId', ParseUUIDPipe) termId: string,
    @Query('classId', ParseUUIDPipe) classId: string,
    @Query('subjectId', ParseUUIDPipe) subjectId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.access.assertCanTeach(user, classId, subjectId);
    const studentIds = await this.curriculum.studentIdsTakingSubject(classId, subjectId);
    const { buffer, fileName } = await buildScoreSheet(this.db, termId, classId, subjectId, studentIds);
    return download(res, buffer, fileName);
  }

  @RequirePermissions('results:enter')
  @Post('results')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  importResults(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRun: string | undefined,
    @Query('overwrite') overwrite: string | undefined,
    @Req() req: Request,
  ) {
    return this.gradesImport.run(user, xlsxUpload(file), { dryRun: flag(dryRun), overwrite: flag(overwrite) }, clientIp(req));
  }
}

@Module({ imports: [ResultsModule], controllers: [ImportsController], providers: [StudentImportService, GradeImportService] })
export class ImportsModule {}
