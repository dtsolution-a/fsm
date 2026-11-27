import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function buildOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('FSM API')
    .setDescription(
      'Field Service Management for Shah Engineers and Consultants. ' +
        'Sign in with POST /auth/login, then click "Authorize" and paste the accessToken. ' +
        'Roles: admin, ga_head, supervisor, engineer, client - each endpoint lists who may call it in its description.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

// Interactive docs at /api/docs. Off in production unless ENABLE_API_DOCS=true.
export function setupDocs(app: INestApplication) {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_API_DOCS !== 'true') return false;
  SwaggerModule.setup('api/docs', app, buildOpenApi(app), { swaggerOptions: { persistAuthorization: true } });
  return true;
}
