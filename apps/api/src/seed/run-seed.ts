import { PrismaClient } from '@prisma/client';
import { loadDotEnvFile } from '../config/env';
import { seedDatabase } from './seed';

/** CLI entry: `pnpm db:seed` (skips if data exists) or `pnpm db:seed -- --reset`. */
async function main(): Promise<void> {
  loadDotEnvFile();
  const prisma = new PrismaClient();
  try {
    await seedDatabase(prisma, {
      reset: process.argv.includes('--reset'),
      log: (m) => console.log(`[seed] ${m}`),
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
