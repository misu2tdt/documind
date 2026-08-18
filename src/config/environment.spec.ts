import {
  ENV_DEFAULTS,
  validateDatabaseEnvironment,
  validateEnvironment,
} from './environment';

const requiredEnvironment = (): Record<string, unknown> => ({
  DB_HOST: 'localhost',
  DB_PORT: '5434',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_DATABASE: 'documind',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6380',
  OPENAI_API_KEY: 'test-api-key',
  ANTHROPIC_API_KEY: 'test-anthropic-api-key',
});

describe('validateEnvironment', () => {
  it('parses numeric values and applies defaults', () => {
    const environment = validateEnvironment(requiredEnvironment());

    expect(environment).toMatchObject({
      DB_PORT: 5434,
      REDIS_PORT: 6380,
      ...ENV_DEFAULTS,
    });
    expect(typeof environment.DB_PORT).toBe('number');
    expect(typeof environment.EMBEDDING_BATCH_SIZE).toBe('number');
  });

  it('parses valid configured numeric values', () => {
    const environment = validateEnvironment({
      ...requiredEnvironment(),
      APP_PORT: '65535',
      MAX_FILE_SIZE_MB: '128',
      EMBEDDING_DIMENSIONS: '2000',
      CHUNK_SIZE_TOKENS: '1200',
      CHUNK_OVERLAP_PERCENT: '0',
      EMBEDDING_BATCH_SIZE: '100',
      RETRIEVAL_TOP_K: '25',
      RETRIEVAL_MIN_SIMILARITY: '0.72',
      GENERATION_MODEL: 'claude-test-model',
      GENERATION_MAX_TOKENS: '2048',
      GENERATION_CONTEXT_MAX_CHARS: '16000',
    });

    expect(environment).toMatchObject({
      APP_PORT: 65_535,
      MAX_FILE_SIZE_MB: 128,
      EMBEDDING_DIMENSIONS: 2000,
      CHUNK_SIZE_TOKENS: 1200,
      CHUNK_OVERLAP_PERCENT: 0,
      EMBEDDING_BATCH_SIZE: 100,
      RETRIEVAL_TOP_K: 25,
      RETRIEVAL_MIN_SIMILARITY: 0.72,
      GENERATION_MODEL: 'claude-test-model',
      GENERATION_MAX_TOKENS: 2048,
      GENERATION_CONTEXT_MAX_CHARS: 16_000,
    });
  });

  it.each([
    'DB_HOST',
    'DB_PORT',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_DATABASE',
    'REDIS_HOST',
    'REDIS_PORT',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
  ])('rejects a missing required variable: %s', (key) => {
    const environment = requiredEnvironment();
    delete environment[key];

    expect(() => validateEnvironment(environment)).toThrow(
      `Environment validation failed: ${key} is required`,
    );
  });

  it.each([
    ['DB_PORT', '0'],
    ['REDIS_PORT', '65536'],
    ['APP_PORT', '1.5'],
    ['MAX_FILE_SIZE_MB', '0'],
    ['EMBEDDING_DIMENSIONS', '2001'],
    ['CHUNK_SIZE_TOKENS', '0'],
    ['CHUNK_OVERLAP_PERCENT', '100'],
    ['EMBEDDING_BATCH_SIZE', '0'],
    ['RETRIEVAL_TOP_K', '101'],
    ['RETRIEVAL_MIN_SIMILARITY', '1.01'],
    ['GENERATION_MAX_TOKENS', '8193'],
    ['GENERATION_CONTEXT_MAX_CHARS', '511'],
  ])('rejects an out-of-range numeric variable: %s=%s', (key, value) => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment(), [key]: value }),
    ).toThrow(`Environment validation failed: ${key}`);
  });
});

describe('validateDatabaseEnvironment', () => {
  it('validates DB config without requiring application secrets', () => {
    const databaseEnvironment = validateDatabaseEnvironment({
      DB_HOST: 'localhost',
      DB_PORT: '5434',
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'postgres',
      DB_DATABASE: 'documind',
    });

    expect(databaseEnvironment).toEqual({
      DB_HOST: 'localhost',
      DB_PORT: 5434,
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'postgres',
      DB_DATABASE: 'documind',
    });
  });

  it('still rejects invalid DB config', () => {
    expect(() =>
      validateDatabaseEnvironment({
        ...requiredEnvironment(),
        DB_PORT: '0',
      }),
    ).toThrow('Environment validation failed: DB_PORT');
  });
});
