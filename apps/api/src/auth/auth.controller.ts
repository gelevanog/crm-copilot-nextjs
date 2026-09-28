import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  loginRequestSchema,
  type CurrentUser as CurrentUserDto,
  type LoginRequest,
  type LoginResponse,
} from '@crm/shared';
import { CurrentUser, Public, type AuthUser } from '../common/auth-user';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
  ): Promise<LoginResponse> {
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<CurrentUserDto> {
    return this.auth.me(user);
  }
}
