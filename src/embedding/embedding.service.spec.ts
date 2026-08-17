import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/environment';
import { EmbeddingService } from './embedding.service';

describe('EmbeddingService', () => {
  const createEmbedding = jest.fn();
  const config: Pick<
    EnvironmentVariables,
    'OPENAI_API_KEY' | 'EMBEDDING_MODEL' | 'EMBEDDING_DIMENSIONS'
  > = {
    OPENAI_API_KEY: 'test-api-key',
    EMBEDDING_MODEL: 'text-embedding-3-small',
    EMBEDDING_DIMENSIONS: 3,
  };

  let service: EmbeddingService;

  beforeEach(() => {
    createEmbedding.mockReset();

    const configService = {
      get: jest.fn((key: keyof typeof config) => config[key]),
    } as unknown as ConfigService<EnvironmentVariables, true>;

    service = new EmbeddingService(configService);
    Object.defineProperty(service, 'client', {
      value: { embeddings: { create: createEmbedding } },
    });
  });

  it('requests and returns embeddings with the configured dimensions', async () => {
    createEmbedding.mockResolvedValue({
      data: [{ embedding: [1, 2, 3] }, { embedding: [4, 5, 6] }],
    });

    await expect(service.embedBatch(['first', 'second'])).resolves.toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(createEmbedding).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['first', 'second'],
      dimensions: 3,
    });
  });

  it('rejects a vector count mismatch', async () => {
    createEmbedding.mockResolvedValue({
      data: [{ embedding: [1, 2, 3] }],
    });

    await expect(service.embedBatch(['first', 'second'])).rejects.toThrow(
      'Invalid embedding provider response: returned 1 vectors for 2 inputs',
    );
  });

  it('rejects a vector dimension mismatch', async () => {
    createEmbedding.mockResolvedValue({
      data: [{ embedding: [1, 2] }],
    });

    await expect(service.embedOne('first')).rejects.toThrow(
      'Invalid embedding provider response: vector 0 has 2 dimensions; expected 3',
    );
  });

  it('wraps provider failures with embedding context', async () => {
    const providerError = new Error('rate limited');
    createEmbedding.mockRejectedValue(providerError);

    await expect(service.embedOne('first')).rejects.toMatchObject({
      message: 'Embedding provider request failed: rate limited',
      cause: providerError,
    });
  });

  it('does not call the provider for an empty batch', async () => {
    await expect(service.embedBatch([])).resolves.toEqual([]);
    expect(createEmbedding).not.toHaveBeenCalled();
  });
});
