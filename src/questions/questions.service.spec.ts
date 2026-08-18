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
    generate.mockResolvedValue({
      answer: 'Seven years. [Source 1]',
      sources: [source],
    });

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
    generate.mockResolvedValue({
      answer: 'Grounded answer. [Source 1]',
      sources: [source],
    });

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
    generate.mockResolvedValue({
      answer: INSUFFICIENT_CONTEXT_ANSWER,
      sources: [source],
    });

    await expect(service.answer('unsupported question')).resolves.toEqual({
      answer: INSUFFICIENT_CONTEXT_ANSWER,
      citations: [],
    });
  });

  it('returns only the subset of sources cited by the answer', async () => {
    const second = {
      ...source,
      chunkId: '550e8400-e29b-41d4-a716-446655440002',
      filename: 'policy.pdf',
      pageNumber: 4,
    };
    const third = {
      ...source,
      chunkId: '550e8400-e29b-41d4-a716-446655440003',
      filename: 'appendix.pdf',
      pageNumber: 9,
    };
    search.mockResolvedValue([source, second, third]);
    generate.mockResolvedValue({
      answer: 'The policy is described here. [Source 2]',
      sources: [source, second, third],
    });

    const response = await service.answer('policy question');

    expect(response.citations).toEqual([
      {
        documentId: second.documentId,
        filename: second.filename,
        pageNumber: second.pageNumber,
        chunkId: second.chunkId,
      },
    ]);
  });

  it('deduplicates citations in deterministic first-reference order', async () => {
    const second = {
      ...source,
      chunkId: '550e8400-e29b-41d4-a716-446655440002',
      filename: 'policy.pdf',
    };
    search.mockResolvedValue([source, second]);
    generate.mockResolvedValue({
      answer: '[Source 2] then [Source 1] and [Source 2] again.',
      sources: [source, second],
    });

    const response = await service.answer('ordered citations');

    expect(response.citations.map((citation) => citation.chunkId)).toEqual([
      second.chunkId,
      source.chunkId,
    ]);
  });

  it('ignores invalid and nonexistent source markers safely', async () => {
    search.mockResolvedValue([source]);
    generate.mockResolvedValue({
      answer: 'Invalid [Source 0], [Source 2], and [Source unknown].',
      sources: [source],
    });

    await expect(service.answer('invalid citations')).resolves.toEqual({
      answer: 'Invalid [Source 0], [Source 2], and [Source unknown].',
      citations: [],
    });
  });
});
