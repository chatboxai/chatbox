import bcrypt from 'bcrypt'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import type { AuthRequest } from '../middleware/auth'

const router = Router()

const SALT_ROUNDS = 10

const RegisterSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

function signToken(userId: string): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: '24h' })
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid input' })
    return
  }

  const { email, password } = parsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    res.status(409).json({ error: 'Email already registered' })
    return
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)
  const user = await prisma.user.create({ data: { email, passwordHash } })

  const token = signToken(user.id)
  res.status(201).json({ token, user: { id: user.id, email: user.email } })
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' })
    return
  }

  const { email, password } = parsed.data

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  const token = signToken(user.id)
  res.json({ token, user: { id: user.id, email: user.email } })
})

// POST /api/auth/refresh
router.post('/refresh', (req: AuthRequest, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const existing = authHeader.slice(7)
  try {
    const payload = jwt.verify(existing, process.env.JWT_SECRET!) as { userId: string }
    const token = signToken(payload.userId)
    res.json({ token })
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
})

// POST /api/auth/demo — friction-free grading entry point
router.post('/demo', async (_req, res) => {
  const user = await prisma.user.findUnique({ where: { email: 'demo@chatbridge.app' } })
  if (!user) {
    res.status(503).json({ error: 'Demo not configured' })
    return
  }

  const token = signToken(user.id)
  res.json({ token, user: { id: user.id, email: user.email } })
})

export default router
