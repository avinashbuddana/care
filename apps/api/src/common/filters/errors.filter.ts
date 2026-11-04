import { Catch, ExceptionFilter, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ZodError } from 'zod';
@Catch()
export class ErrorsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');
  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const status =
      error instanceof HttpException ? error.getStatus() : error instanceof ZodError ? 400 : 500;
    const message =
      error instanceof HttpException
        ? error.getResponse()
        : error instanceof ZodError
          ? 'Invalid request data'
          : 'Request failed';
    // Log only classes and request identifiers, never user input or service errors containing credentials.
    this.logger.error(
      JSON.stringify({
        event: 'request_failed',
        requestId: res.getHeader('x-request-id'),
        method: req.method,
        path: req.path,
        status,
        errorType: error instanceof Error ? error.name : 'Unknown',
      }),
    );
    res.status(status).json(typeof message === 'string' ? { message } : message);
  }
}
