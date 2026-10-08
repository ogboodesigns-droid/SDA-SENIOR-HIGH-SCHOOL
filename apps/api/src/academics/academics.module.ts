import { Module } from '@nestjs/common';
import { AcademicsController } from './academics.controller';

@Module({ controllers: [AcademicsController] })
export class AcademicsModule {}
