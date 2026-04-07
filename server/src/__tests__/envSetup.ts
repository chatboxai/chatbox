/**
 * Runs before each test file (setupFiles in jest.config.js).
 * Sets required env vars BEFORE index.ts is imported, so dotenv/config
 * inside index.ts won't override these test-safe values.
 */

import path from 'path'
import dotenv from 'dotenv'

// Load .env to get DATABASE_URL (and other vars).
// dotenv will NOT override vars already in process.env.
dotenv.config({ path: path.join(__dirname, '../../.env') })

// Override with known test values so tokens generated in tests are verifiable.
// These take effect BEFORE index.ts is imported.
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only'
process.env.ANTHROPIC_API_KEY = 'test-anthropic-api-key'
process.env.NODE_ENV = 'test'
