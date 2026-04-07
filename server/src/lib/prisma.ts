import { PrismaClient } from '@prisma/client'

// Prevent multiple PrismaClient instances in ts-node hot-reload (dev mode)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
