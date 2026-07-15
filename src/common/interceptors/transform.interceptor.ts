import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ResponseWrapper<T> {
  success: boolean;
  data: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, any> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const header = response.getHeader('Content-Type');
    const contentType = header ? String(header) : '';

    return next.handle().pipe(
      map((data: unknown) => {
        if (typeof data === 'string') {
          const strData = data.trim();
          if (
            contentType.includes('xml') ||
            contentType.includes('text/xml') ||
            strData.startsWith('<')
          ) {
            return data;
          }
        }

        return {
          success: true,
          data,
        };
      }),
    );
  }
}
