/**
 * Prisma seed: default candidate + competencies for local testing.
 * Run with: npm run db:seed  or  npx prisma db seed
 */
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_CANDIDATE_ID = '00000000-0000-0000-0000-000000000001';

const competencies = [
  { id: 'communication', name: 'Communication', description: 'Clarity and effectiveness of expression' },
  { id: 'problem_solving', name: 'Problem Solving', description: 'Analytical and solution-oriented thinking' },
  { id: 'technical_depth', name: 'Technical Depth', description: 'Depth of technical knowledge and practice' },
  { id: 'judgment', name: 'Judgment', description: 'Quality of decisions and trade-offs' },
  { id: 'collaboration', name: 'Collaboration', description: 'Working with others and stakeholders' },
  { id: 'engagement', name: 'Engagement', description: 'Interest and questions about the role' },
];

async function main() {
  await prisma.candidate.upsert({
    where: { id: TEST_CANDIDATE_ID },
    create: {
      id: TEST_CANDIDATE_ID,
      email: 'candidate@example.com',
      name: 'Test Candidate',
    },
    update: {},
  });
  console.log('Seeded candidate:', TEST_CANDIDATE_ID);

  for (const c of competencies) {
    await prisma.competency.upsert({
      where: { id: c.id },
      create: c,
      update: { name: c.name, description: c.description },
    });
  }
  console.log('Seeded', competencies.length, 'competencies');
}

main()
  .catch((e: unknown) => {
    const err = e as { message?: string; code?: string };
    if (err.message?.includes('Authentication failed') || err.message?.includes('credentials')) {
      console.error('\n❌ Database authentication failed.');
      console.error('   Your DATABASE_URL in .env is being rejected by PostgreSQL.\n');
      console.error('   Fix:');
      console.error('   1. Ensure PostgreSQL is running (e.g. brew services start postgresql@14)');
      console.error('   2. Use the same user/password you use to connect to Postgres.');
      console.error('      Example: postgresql://postgres:YOUR_REAL_PASSWORD@localhost:5432/ai_interviewer');
      console.error('   3. Create the DB if needed: createdb -U postgres ai_interviewer\n');
    } else {
      console.error(e);
    }
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
