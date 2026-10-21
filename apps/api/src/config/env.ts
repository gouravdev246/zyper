import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgresql://zyper:zyper_secure_password@localhost:5432/zyper_db?schema=public'),
  INTERNAL_ORCHESTRATOR_URL: z.string().default('http://localhost:8000/internal/v1'),
  JWT_SECRET: z.string().default('development_secret_key_minimum_32_characters_long_for_security'),
  INTERNAL_SERVICE_KEY: z.string().default('development_internal_service_key_zyper'),
});

export const env = envSchema.parse(process.env);
