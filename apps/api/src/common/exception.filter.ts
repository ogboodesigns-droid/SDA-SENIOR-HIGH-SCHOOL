import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

interface PgError {
  code?: string;
  constraint?: string;
}

/** Turns database constraint violations into readable 409s and hides internals of unexpected errors. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    const pg = (exception as { cause?: PgError }).cause ?? (exception as PgError);
    if (pg?.code === '23505') {
      res.status(409).json({ statusCode: 409, message: 'A record with these details already exists', constraint: pg.constraint });
      return;
    }
    if (pg?.code === '23503') {
      res.status(409).json({ statusCode: 409, message: 'This record is linked to other records and cannot be changed this way' });
      return;
    }
    if (pg?.code === '23514' || pg?.code === '22P02') {
      res.status(400).json({ statusCode: 400, message: 'Some values are not allowed' });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ statusCode: 500, message: 'Something went wrong. Please try again.' });
  }
}
