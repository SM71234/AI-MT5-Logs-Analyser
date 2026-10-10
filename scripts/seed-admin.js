const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');

async function main() {
  const prisma = new PrismaClient();
  try {
    const hash = await bcrypt.hash('password123', 10);
    console.log('Hash generated successfully.');

    const user = await prisma.user.upsert({
      where: { email: 'sankalpmisal007@gmail.com' },
      update: { passwordHash: hash },
      create: {
        email: 'sankalpmisal007@gmail.com',
        name: 'Sankalp Sunil Misal',
        passwordHash: hash,
        role: 'ADMIN'
      }
    });

    console.log('User saved successfully:', user.email, 'Role:', user.role);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
