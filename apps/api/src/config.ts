import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  /** At least 32 random characters. Generate with `openssl rand -base64 48`. */
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Comma-separated origins allowed to call the API from a browser (the admin portal). */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  /** Number of reverse proxies in front of the API, so client IPs are logged correctly. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Send push notifications through Expo's push service. */
  EXPO_PUSH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

export function config(): AppConfig {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    if (parsed.data.STORAGE_DRIVER === 's3' && !parsed.data.S3_BUCKET) {
      throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests that change process.env between app instances. */
export function resetConfigCache() {
  cached = undefined;
}
