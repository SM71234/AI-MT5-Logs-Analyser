import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Set global API prefix to /api/v1
  app.setGlobalPrefix('api/v1');

  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const corsOriginsVal = configService.get<string>('CORS_ORIGINS', '');

  let corsOrigin: any = true;
  if (nodeEnv === 'production') {
    if (corsOriginsVal) {
      corsOrigin = corsOriginsVal.split(',').map((o) => o.trim());
    } else {
      corsOrigin = false; // Block all by default in production
    }
  } else {
    // Development mode defaults
    if (corsOriginsVal) {
      corsOrigin = corsOriginsVal.split(',').map((o) => o.trim());
    } else {
      corsOrigin = [
        'http://localhost:3000',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173',
      ];
    }
  }

  // Enable CORS for frontend integration
  app.enableCors({
    origin: corsOrigin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Enable request payload validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // Strips properties not matching the DTO
      transform: true,       // Automatically transforms payloads to DTO instances
      forbidNonWhitelisted: true,
    }),
  );

  // Apply unified response filters and interceptors
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  const port = configService.get<number>('PORT', 4000);

  await app.listen(port);
  logger.log(`NestJS server is running on http://localhost:${port}/api/v1`);
}

bootstrap();
