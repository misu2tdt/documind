import { RetrievalResultDto } from '../retrieval/dto/retrieval-result.dto';
import { RetrievalService } from '../retrieval/retrieval.service';
import { GenerationService } from './generation.service';
import { INSUFFICIENT_CONTEXT_ANSWER } from './questions.constants';
import { QuestionsService } from './questions.service';

describe('QuestionsService', () => {
  const search = jest.fn();
  const generate = jest.fn();
  let service: QuestionsService;

  const source: RetrievalResultDto = {
    chunkId: '550e8400-e29b-41d4-a716-446655440001',
    documentId: '550e8400-e29b-41d4-a716-446655440000',
    filename: 'handbook.pdf',
    pageNumber: 7,
    content: 'Records are retained for seven years.',
    similarity: 0.91,
  };

  beforeEach(() => {
    search.mockReset();
    generate.mockReset();
    service = new QuestionsService(
      { search } as unknown as RetrievalService,
      { generate } as unknown as GenerationService,
    );
  });

  it('retrieves context, generates an answer, and returns source citations', async () => {
    const documentId = source.documentId;
    search.mockResolvedValue([source]);
    generate.mockResolvedValue('Seven years. [Source 1]');

    await expect(
      service.answer('  How long?  ', 3, documentId),
    ).resolves.toEqual({
      answer: 'Seven years. [Source 1]',
      citations: [
        {
          documentId,
          filename: 'handbook.pdf',
          pageNumber: 7,
          chunkId: source.chunkId,
        },
      ],
    });
    expect(search).toHaveBeenCalledWith('How long?', 3, documentId);
    expect(generate).toHaveBeenCalledWith('How long?', [source]);
  });

  it('deduplicates chunks and ignores blank source content', async () => {
    const blank = { ...source, chunkId: 'blank', content: '   ' };
    search.mockResolvedValue([source, { ...source }, blank]);
    generate.mockResolvedValue('Grounded answer. [Source 1]');

    const response = await service.answer('question');

    expect(generate).toHaveBeenCalledWith('question', [source]);
    expect(response.citations).toHaveLength(1);
  });

  it('returns an insufficient-context response without calling the LLM', async () => {
    search.mockResolvedValue([]);

    await expect(service.answer('unknown question')).resolves.toEqual({
      answer: INSUFFICIENT_CONTEXT_ANSWER,
      citations: [],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('omits citations when the model reports insufficient context', async () => {
    search.mockResolvedValue([source]);
    generate.mockResolvedValue(INSUFFICIENT_CONTEXT_ANSWER);

    await expect(service.answer('unsupported question')).resolves.toEqual({
      answer: INSUFFICIENT_CONTEXT_ANSWER,
      citations: [],
    });
  });
});
