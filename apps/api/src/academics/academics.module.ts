import { Module } from '@nestjs/common';
import { AcademicsController } from './academics.controller';
export { CurriculumModule } from './curriculum.service';

@Module({ controllers: [AcademicsController] })
export class AcademicsModule {}
