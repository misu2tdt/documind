import { ConfigService } from '@nestjs/config';
import { ENV_DEFAULTS, EnvironmentVariables } from '../config/environment';
import { EmbeddingService } from '../embedding/embedding.service';

export function createRetrievalConfig(
  topK: number,
  minimumSimilarity = numberEnvironmentValue(
    'RETRIEVAL_MIN_SIMILARITY',
    ENV_DEFAULTS.RETRIEVAL_MIN_SIMILARITY,
  ),
): ConfigService<EnvironmentVariables, true> {
  const values = {
    OPENAI_API_KEY: requiredEnvironmentValue('OPENAI_API_KEY'),
    EMBEDDING_MODEL:
      process.env.EMBEDDING_MODEL ?? ENV_DEFAULTS.EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS: integerEnvironmentValue(
      'EMBEDDING_DIMENSIONS',
      ENV_DEFAULTS.EMBEDDING_DIMENSIONS,
    ),
    RETRIEVAL_TOP_K: topK,
    RETRIEVAL_MIN_SIMILARITY: minimumSimilarity,
  };
  return {
    get: (key: keyof typeof values) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

export function createCachedEmbeddingService(
  embeddingService: EmbeddingService,
): EmbeddingService {
  const cache = new Map<string, Promise<number[]>>();
  return {
    embedOne: (text: string) => {
      const cached = cache.get(text);
      if (cached) return cached;
      const pending = embeddingService.embedOne(text);
      cache.set(text, pending);
      return pending;
    },
  } as EmbeddingService;
}

function requiredEnvironmentValue(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required for retrieval evaluation`);
  return value;
}

function integerEnvironmentValue(key: string, fallback: number): number {
  const value = process.env[key];
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

function numberEnvironmentValue(key: string, fallback: number): number {
  const value = process.env[key];
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < -1 || parsed > 1) {
    throw new Error(`${key} must be a number between -1 and 1`);
  }
  return parsed;
}
