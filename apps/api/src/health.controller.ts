import { Controller, Get } from '@nestjs/common';
import { Public } from './common/auth-user';
import { PrismaService } from './prisma/prisma.module';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<{ status: 'ok' }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}
