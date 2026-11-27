import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { assertEnv, corsOrigins } from './config/env';
import { apiRateLimit } from './common/rate-limit';

async function bootstrap() {
  assertEnv();
  // required after env is validated: AuthModule reads JWT_SECRET when it is imported
  const { AppModule } = await import('./app.module');
  const { setupDocs } = await import('./docs');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const docsOn = process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true';
  app.set('trust proxy', 1); // behind the AWS load balancer: real client IP for rate limiting
  // The API only returns JSON, so a content-security-policy adds nothing; it only blocks the Swagger page when docs are on.
  app.use(helmet({ contentSecurityPolicy: docsOn ? false : undefined }));
  app.disable('x-powered-by');
  app.use(apiRateLimit());
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks(); // finish in-flight requests on SIGTERM (ECS deploys / scale-in)
  const docs = setupDocs(app);

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`FSM API listening on :${port} (${process.env.NODE_ENV || 'development'})${docs ? ' - docs at /api/docs' : ''}`);
}
bootstrap();
