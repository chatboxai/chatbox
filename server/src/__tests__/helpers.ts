import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'

const JWT_SECRET = process.env.JWT_SECRET!

/** Generate a signed JWT for a userId (doesn't need to exist in DB for middleware tests). */
export function generateToken(userId: string, opts: jwt.SignOptions = {}): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1h', ...opts })
}

/** Generate an expired JWT for negative tests. */
export function generateExpiredToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '-1s' })
}

/** Delete all users whose email matches the test domain, plus their dependent data. */
export async function cleanupTestUsers(): Promise<void> {
  const testUsers = await prisma.user.findMany({
    where: { email: { contains: '@jest.test' } },
    select: { id: true },
  })

  if (testUsers.length === 0) return

  const userIds = testUsers.map((u) => u.id)

  // Must delete child rows before parents (no cascade configured)
  const conversations = await prisma.conversation.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  })
  const conversationIds = conversations.map((c) => c.id)

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } }),
    prisma.conversation.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.oAuthToken.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ])
}

/** Make a unique test email to avoid collisions across runs. */
export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@jest.test`
}
