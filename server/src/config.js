import 'dotenv/config';

const env = process.env;
const bool = (v, def) => (v === undefined || v === '' ? def : v === 'true');
const num = (v, def) => (v === undefined || v === '' ? def : Number(v));

export const config = {
  NODE_ENV: env.NODE_ENV || 'development',
  PORT: num(env.PORT, 4000),
  MONGO_URI: env.MONGO_URI || 'mongodb://127.0.0.1:27017/tradesim',
  // Multi-document transactions need a replica set (MongoDB Atlas free tier has one).
  // With a plain local MongoDB set MONGO_TRANSACTIONS=false.
  MONGO_TRANSACTIONS: bool(env.MONGO_TRANSACTIONS, true),
  JWT_SECRET: env.JWT_SECRET || 'dev-only-secret-change-me-please',
  ACCESS_TTL_SECONDS: num(env.ACCESS_TTL_SECONDS, 15 * 60),
  REFRESH_TTL_SECONDS: num(env.REFRESH_TTL_SECONDS, 7 * 24 * 3600),
  CLIENT_ORIGIN: env.CLIENT_ORIGIN || 'http://localhost:5173',
  BOTS_ENABLED: bool(env.BOTS_ENABLED, true),
  ADMIN_EMAIL: env.ADMIN_EMAIL || 'admin@tradesim.dev',
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || 'admin12345',
  ORDER_RATE_LIMIT_PER_MIN: num(env.ORDER_RATE_LIMIT_PER_MIN, 300),
  // Optional: enables the real LLM for "Explain my portfolio". Otherwise a template explanation is used.
  ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || undefined,
  AI_MODEL: env.AI_MODEL || 'claude-sonnet-5-5',
};

/** New users start with INR 10,00,000 (stored in paise). */
export const STARTING_CASH = 10_00_000 * 100;
