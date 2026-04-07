import { rateLimit } from 'express-rate-limit'

const isTest = process.env.NODE_ENV === 'test'

// Auth endpoints: 10 attempts per minute (prevents brute force)
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
})

// General API: 60 requests per minute
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
})
