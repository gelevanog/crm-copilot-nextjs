import { TEST_DATABASE_URL } from './helpers/db-url';

// Deterministic, key-free configuration for every test file.
process.env.NODE_ENV = 'test';
process.env.LLM_PROVIDER = 'fake';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'test-secret-with-enough-length';
process.env.LOG_LEVEL ??= 'silent';
process.env.AI_RATE_LIMIT_CAPACITY ??= '50';
