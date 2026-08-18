import { ENV_DEFAULTS, validateEnvironment } from './environment';

const requiredEnvironment = (): Record<string, unknown> => ({
  DB_HOST: 'localhost',
  DB_PORT: '5434',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_DATABASE: 'documind',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6380',
  OPENAI_API_KEY: 'test-api-key',
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
    });

    expect(environment).toMatchObject({
      APP_PORT: 65_535,
      MAX_FILE_SIZE_MB: 128,
      EMBEDDING_DIMENSIONS: 2000,
      CHUNK_SIZE_TOKENS: 1200,
      CHUNK_OVERLAP_PERCENT: 0,
      EMBEDDING_BATCH_SIZE: 100,
      RETRIEVAL_TOP_K: 25,
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
  ])('rejects an out-of-range numeric variable: %s=%s', (key, value) => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment(), [key]: value }),
    ).toThrow(`Environment validation failed: ${key}`);
  });
});
