import { Router } from 'express'
import { prisma } from '../lib/prisma'
import type { AuthRequest } from '../middleware/auth'

const router = Router()

// GET /api/conversations — list conversations for the authenticated user
router.get('/', async (req: AuthRequest, res) => {
  const userId = req.user!.userId

  const conversations = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, updatedAt: true, createdAt: true },
  })

  res.json({ conversations })
})

// GET /api/conversations/:id — get conversation with messages
router.get('/:id', async (req: AuthRequest, res) => {
  const userId = req.user!.userId
  const { id } = req.params

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          content: true,
          toolCallId: true,
          toolName: true,
          toolParams: true,
          createdAt: true,
        },
      },
    },
  })

  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' })
    return
  }

  res.json(conversation)
})

// POST /api/conversations — create a new conversation
router.post('/', async (req: AuthRequest, res) => {
  const userId = req.user!.userId
  const { title } = req.body as { title?: string }

  const conversation = await prisma.conversation.create({
    data: { userId, title: title ?? 'New conversation' },
    select: { id: true, title: true, createdAt: true },
  })

  res.status(201).json(conversation)
})

// DELETE /api/conversations/:id — delete a conversation
router.delete('/:id', async (req: AuthRequest, res) => {
  const userId = req.user!.userId
  const { id } = req.params

  const conversation = await prisma.conversation.findFirst({ where: { id, userId } })
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' })
    return
  }

  // Delete messages first (no cascade configured), then the conversation
  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId: id } }),
    prisma.conversation.delete({ where: { id } }),
  ])

  res.status(204).send()
})

export default router
