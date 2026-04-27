import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import hbs = require('hbs');
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('hbs');

  hbs.registerHelper('money', (value: unknown) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      return '-';
    }

    return `${number.toLocaleString('ko-KR')}원`;
  });

  hbs.registerHelper('signedMoney', (value: unknown) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return '-';
    }

    const prefix = number > 0 ? '+' : '';
    return `${prefix}${number.toLocaleString('ko-KR')}원`;
  });

  hbs.registerHelper('json', (value: unknown) => JSON.stringify(value, null, 2));

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
