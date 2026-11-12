import { defineConfig } from 'prisma/config';

// The app reads .env.local (Next.js), so the Prisma CLI does too.
try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local: use the environment as it is
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // default: the Postgres from docker-compose.yml
    url: process.env.DATABASE_URL ?? 'postgresql://cardsimcha:cardsimcha@localhost:5433/cardsimcha',
  },
});
