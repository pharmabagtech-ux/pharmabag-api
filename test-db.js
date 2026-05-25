const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); prisma.product.findFirst().then(console.log).finally(() => prisma.$disconnect());
