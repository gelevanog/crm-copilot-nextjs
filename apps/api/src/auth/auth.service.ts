import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { CurrentUser, LoginResponse } from '@crm/shared';
import { PrismaService } from '../prisma/prisma.module';
import type { AuthUser } from '../common/auth-user';
import { verifyPassword } from './password';

interface TokenPayload {
  sub: string;
  wid: string;
  email: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { workspace: true },
    });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const payload: TokenPayload = {
      sub: user.id,
      wid: user.workspaceId,
      email: user.email,
      name: user.name,
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        workspace: { id: user.workspace.id, name: user.workspace.name },
      },
    };
  }

  async verifyToken(token: string): Promise<AuthUser> {
    try {
      const payload = await this.jwt.verifyAsync<TokenPayload>(token);
      return {
        userId: payload.sub,
        workspaceId: payload.wid,
        email: payload.email,
        name: payload.name,
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async me(auth: AuthUser): Promise<CurrentUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: auth.userId, workspaceId: auth.workspaceId },
      include: { workspace: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      workspace: { id: user.workspace.id, name: user.workspace.name },
    };
  }
}
