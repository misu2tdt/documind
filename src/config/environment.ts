export interface EnvironmentVariables {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_DATABASE: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  OPENAI_API_KEY: string;
  APP_PORT: number;
  UPLOAD_DIR: string;
  MAX_FILE_SIZE_MB: number;
  EMBEDDING_MODEL: string;
  EMBEDDING_DIMENSIONS: number;
  CHUNK_SIZE_TOKENS: number;
  CHUNK_OVERLAP_PERCENT: number;
  EMBEDDING_BATCH_SIZE: number;
  RETRIEVAL_TOP_K: number;
  RETRIEVAL_MIN_SIMILARITY: number;
}

export const ENV_DEFAULTS = {
  APP_PORT: 3001,
  UPLOAD_DIR: './uploads',
  MAX_FILE_SIZE_MB: 20,
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_DIMENSIONS: 1536,
  CHUNK_SIZE_TOKENS: 800,
  CHUNK_OVERLAP_PERCENT: 15,
  EMBEDDING_BATCH_SIZE: 50,
  RETRIEVAL_TOP_K: 5,
  RETRIEVAL_MIN_SIMILARITY: 0.5,
} as const;

function requiredString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Environment validation failed: ${key} is required`);
  }
  return value.trim();
}

function stringWithDefault(
  config: Record<string, unknown>,
  key: string,
  defaultValue: string,
): string {
  const value = config[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `Environment validation failed: ${key} must be a non-empty string`,
    );
  }
  return value.trim();
}

function integerInRange(
  config: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  defaultValue?: number,
): number {
  const rawValue = config[key];
  const value =
    rawValue === undefined || rawValue === null || rawValue === ''
      ? defaultValue
      : rawValue;

  if (value === undefined) {
    throw new Error(`Environment validation failed: ${key} is required`);
  }

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `Environment validation failed: ${key} must be an integer between ${minimum} and ${maximum}`,
    );
  }

  return parsed;
}

function numberInRange(
  config: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  defaultValue?: number,
): number {
  const rawValue = config[key];
  const value =
    rawValue === undefined || rawValue === null || rawValue === ''
      ? defaultValue
      : rawValue;

  if (value === undefined) {
    throw new Error(`Environment validation failed: ${key} is required`);
  }

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `Environment validation failed: ${key} must be a number between ${minimum} and ${maximum}`,
    );
  }

  return parsed;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  return {
    ...config,
    DB_HOST: requiredString(config, 'DB_HOST'),
    DB_PORT: integerInRange(config, 'DB_PORT', 1, 65_535),
    DB_USERNAME: requiredString(config, 'DB_USERNAME'),
    DB_PASSWORD: requiredString(config, 'DB_PASSWORD'),
    DB_DATABASE: requiredString(config, 'DB_DATABASE'),
    REDIS_HOST: requiredString(config, 'REDIS_HOST'),
    REDIS_PORT: integerInRange(config, 'REDIS_PORT', 1, 65_535),
    OPENAI_API_KEY: requiredString(config, 'OPENAI_API_KEY'),
    APP_PORT: integerInRange(
      config,
      'APP_PORT',
      1,
      65_535,
      ENV_DEFAULTS.APP_PORT,
    ),
    UPLOAD_DIR: stringWithDefault(
      config,
      'UPLOAD_DIR',
      ENV_DEFAULTS.UPLOAD_DIR,
    ),
    MAX_FILE_SIZE_MB: integerInRange(
      config,
      'MAX_FILE_SIZE_MB',
      1,
      1024,
      ENV_DEFAULTS.MAX_FILE_SIZE_MB,
    ),
    EMBEDDING_MODEL: stringWithDefault(
      config,
      'EMBEDDING_MODEL',
      ENV_DEFAULTS.EMBEDDING_MODEL,
    ),
    EMBEDDING_DIMENSIONS: integerInRange(
      config,
      'EMBEDDING_DIMENSIONS',
      1,
      2000,
      ENV_DEFAULTS.EMBEDDING_DIMENSIONS,
    ),
    CHUNK_SIZE_TOKENS: integerInRange(
      config,
      'CHUNK_SIZE_TOKENS',
      1,
      100_000,
      ENV_DEFAULTS.CHUNK_SIZE_TOKENS,
    ),
    CHUNK_OVERLAP_PERCENT: integerInRange(
      config,
      'CHUNK_OVERLAP_PERCENT',
      0,
      99,
      ENV_DEFAULTS.CHUNK_OVERLAP_PERCENT,
    ),
    EMBEDDING_BATCH_SIZE: integerInRange(
      config,
      'EMBEDDING_BATCH_SIZE',
      1,
      2048,
      ENV_DEFAULTS.EMBEDDING_BATCH_SIZE,
    ),
    RETRIEVAL_TOP_K: integerInRange(
      config,
      'RETRIEVAL_TOP_K',
      1,
      100,
      ENV_DEFAULTS.RETRIEVAL_TOP_K,
    ),
    RETRIEVAL_MIN_SIMILARITY: numberInRange(
      config,
      'RETRIEVAL_MIN_SIMILARITY',
      -1,
      1,
      ENV_DEFAULTS.RETRIEVAL_MIN_SIMILARITY,
    ),
  };
}
