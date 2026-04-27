import { Controller, Get, Redirect } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  @Redirect('/admin/quotes', 302)
  root() {
    return undefined;
  }
}
