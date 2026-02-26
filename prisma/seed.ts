/**
 * Prisma seed: optional test candidate and competencies.
 * Run with: npx prisma db seed
 * Requires DATABASE_URL in backend/.env (copy from .env.example and set your PostgreSQL URL).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.candidate.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'candidate@example.com',
      name: 'Test Candidate',
    },
    update: {},
  });

  const competencies = [
    { id: 'communication', name: 'Communication', description: 'Clarity and effectiveness of expression' },
    { id: 'problem_solving', name: 'Problem Solving', description: 'Analytical and solution-oriented thinking' },
    { id: 'technical_depth', name: 'Technical Depth', description: 'Depth of technical knowledge and practice' },
    { id: 'judgment', name: 'Judgment', description: 'Quality of decisions and trade-offs' },
    { id: 'collaboration', name: 'Collaboration', description: 'Working with others and stakeholders' },
    { id: 'engagement', name: 'Engagement', description: 'Interest and questions about the role' },
  ];

  for (const c of competencies) {
    await prisma.competency.upsert({
      where: { id: c.id },
      create: c,
      update: { name: c.name, description: c.description ?? undefined },
    });
  }

  console.log('Seed done: candidate + competencies');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
