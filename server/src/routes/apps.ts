import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import type { AuthRequest } from '../middleware/auth'

const router = Router()

const ToolSchemaSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()),
})

const RegisterAppSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  description: z.string().min(1),
  tools: z.array(ToolSchemaSchema).min(1),
})

const UpdateStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
})

// GET /api/apps/all — returns all app registrations regardless of status (requires auth)
router.get('/all', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const rows = await prisma.appRegistration.findMany()

    const apps = rows.map(({ toolSchemas, authRequired, authProvider, timeout, createdAt, ...rest }) => ({
      ...rest,
      tools: toolSchemas as unknown[],
      ...(authRequired ? { authRequired, authProvider } : {}),
    }))

    res.json({ apps })
  } catch (err) {
    console.error('Failed to load all apps', err)
    res.status(500).json({ error: 'Failed to load apps' })
  }
})

// GET /api/apps — returns approved app registrations (no auth required)
router.get('/', async (_req, res) => {
  try {
    const rows = await prisma.appRegistration.findMany({
      where: { status: 'approved' },
    })

    const apps = rows.map(({ toolSchemas, authRequired, authProvider, timeout, createdAt, ...rest }) => ({
      ...rest,
      tools: toolSchemas as unknown[],
      ...(authRequired ? { authRequired, authProvider } : {}),
    }))

    res.json(apps)
  } catch (err) {
    console.error('Failed to load apps', err)
    res.status(500).json({ error: 'Failed to load apps' })
  }
})

// POST /api/apps/register — register a new app (requires auth)
router.post('/register', requireAuth, async (req: AuthRequest, res) => {
  const parsed = RegisterAppSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid app schema' })
    return
  }

  const { name, url, description, tools } = parsed.data

  const app = await prisma.appRegistration.create({
    data: {
      name,
      url,
      description,
      toolSchemas: tools as unknown as Prisma.InputJsonValue,
      status: 'pending',
    },
    select: { id: true, status: true },
  })

  res.status(201).json(app)
})

// PATCH /api/apps/:id/status — change app status (requires auth)
router.patch('/:id/status', requireAuth, async (req: AuthRequest, res) => {
  const parsed = UpdateStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'status must be pending, approved, or rejected' })
    return
  }

  const { id } = req.params

  const existing = await prisma.appRegistration.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ error: 'App not found' })
    return
  }

  const updated = await prisma.appRegistration.update({
    where: { id },
    data: { status: parsed.data.status },
    select: { id: true, status: true },
  })

  res.json(updated)
})

export default router
