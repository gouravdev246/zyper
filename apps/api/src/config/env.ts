import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load root .env (monorepo root) first, then local package .env, then process.cwd() fallback
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgresql://zyper:zyper_secure_password@localhost:5432/zyper_db?schema=public'),
  INTERNAL_ORCHESTRATOR_URL: z.string().default('http://localhost:8000/internal/v1'),
  JWT_SECRET: z.string().default('development_secret_key_minimum_32_characters_long_for_security'),
  INTERNAL_SERVICE_KEY: z.string().default('development_internal_service_key_zyper'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:4000/api/v1/connections/gmail/callback'),
});

export const env = envSchema.parse(process.env);
