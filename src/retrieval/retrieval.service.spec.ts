import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EnvironmentVariables } from '../config/environment';
import { EmbeddingService } from '../embedding/embedding.service';
import { RetrievalService } from './retrieval.service';

describe('RetrievalService', () => {
  const query = jest.fn();
  const embedOne = jest.fn();
  let service: RetrievalService;

  beforeEach(() => {
    query.mockReset();
    embedOne.mockReset();

    const dataSource = { query } as unknown as DataSource;
    const embeddingService = { embedOne } as unknown as EmbeddingService;
    const configService = {
      get: jest.fn((key: keyof EnvironmentVariables) =>
        key === 'RETRIEVAL_TOP_K' ? 5 : 0.5,
      ),
    } as unknown as ConfigService<EnvironmentVariables, true>;

    service = new RetrievalService(dataSource, embeddingService, configService);
  });

  it('embeds the query and searches with the configured topK', async () => {
    embedOne.mockResolvedValue([1, 0, 0]);
    query.mockResolvedValue([
      {
        chunkId: 'chunk-1',
        documentId: 'document-1',
        filename: 'guide.pdf',
        pageNumber: 2,
        content: 'matching content',
        similarity: '0.875',
      },
    ]);

    await expect(service.search('matching query')).resolves.toEqual([
      expect.objectContaining({
        chunkId: 'chunk-1',
        similarity: 0.875,
      }),
    ]);
    expect(embedOne).toHaveBeenCalledWith('matching query');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('c.embedding <=> $1::vector'),
      [JSON.stringify([1, 0, 0]), 5, 0.5, 'completed'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.not.stringContaining('c.document_id = $5'),
      [JSON.stringify([1, 0, 0]), 5, 0.5, 'completed'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('AND d.status = $4'),
      expect.any(Array),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('AND 1 - (c.embedding <=> $1::vector) >= $3'),
      expect.any(Array),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ORDER BY c.embedding <=> $1::vector ASC, c.id ASC',
      ),
      expect.any(Array),
    );
  });

  it('uses an explicit topK and a parameterized document filter', async () => {
    const documentId = '550e8400-e29b-41d4-a716-446655440000';
    embedOne.mockResolvedValue([0, 1, 0]);
    query.mockResolvedValue([]);

    await service.search('filtered query', 2, documentId);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('AND c.document_id = $5'),
      [JSON.stringify([0, 1, 0]), 2, 0.5, 'completed', documentId],
    );
  });

  it('trims the query before embedding it', async () => {
    embedOne.mockResolvedValue([1, 0, 0]);
    query.mockResolvedValue([]);

    await service.search('  useful query  ');

    expect(embedOne).toHaveBeenCalledWith('useful query');
  });

  it.each(['', '   ', '\n\t'])('rejects an empty query: %j', async (value) => {
    await expect(service.search(value)).rejects.toThrow(
      'Query must not be empty',
    );
    expect(embedOne).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it.each([0, 101, 1.5, Number.NaN])(
    'rejects an invalid topK: %s',
    async (topK) => {
      await expect(service.search('query', topK)).rejects.toThrow(
        'topK must be an integer between 1 and 100',
      );
      expect(embedOne).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    },
  );
});
