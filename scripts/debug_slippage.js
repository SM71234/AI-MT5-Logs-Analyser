const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const inv = await prisma.investigation.findUnique({
      where: { id: 'e6b4eaa6-2b22-4107-bc42-36ed366c8f47' }
    });
    const events = JSON.parse(inv.events);
    console.log('Total events:', events.length);
    console.log('FIRST 10 EVENTS:');
    for (let i = 0; i < Math.min(10, events.length); i++) {
      console.log(i, events[i].timestamp, events[i].eventType, events[i].rawMessage, events[i].metadata);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
