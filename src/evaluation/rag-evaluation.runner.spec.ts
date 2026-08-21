import { QuestionsService } from '../questions/questions.service';
import { RetrievalResultDto } from '../retrieval/dto/retrieval-result.dto';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RagEvaluationRunner } from './rag-evaluation.runner';

describe('RagEvaluationRunner', () => {
  it('keeps retrieval and generation results separate without provider calls', async () => {
    const retrieved: RetrievalResultDto = {
      chunkId: 'chunk-1',
      documentId: 'document-1',
      filename: 'policy.pdf',
      pageNumber: 2,
      content: 'The limit is 25 dollars.',
      similarity: 0.9,
    };
    const search = jest.fn().mockResolvedValue([retrieved]);
    const answer = jest
      .fn()
      .mockResolvedValueOnce({
        answer: 'The limit is 25 dollars. [Source 1]',
        citations: [
          {
            documentId: retrieved.documentId,
            filename: retrieved.filename,
            pageNumber: retrieved.pageNumber,
            chunkId: retrieved.chunkId,
          },
        ],
      })
      .mockResolvedValueOnce({
        answer:
          'I do not have enough information in the provided documents to answer this question.',
        citations: [],
      });
    const runner = new RagEvaluationRunner(
      { search } as unknown as RetrievalService,
      { answer } as unknown as QuestionsService,
    );

    const report = await runner.run(
      {
        name: 'rag-fixture',
        cases: [
          {
            id: 'supported',
            question: 'What is the limit?',
            referenceAnswer: 'The limit is 25 dollars.',
            expectedSources: [{ filename: 'policy.pdf', pageNumber: 2 }],
          },
          {
            id: 'unsupported',
            question: 'What is the dress code?',
            expectedSources: [],
          },
        ],
      },
      3,
    );

    expect(report.retrieval.metrics[0]).toEqual({
      k: 3,
      hitRate: 1,
      recall: 1,
      mrr: 1,
    });
    expect(report.generation.metrics).toMatchObject({
      citationPrecision: 1,
      citationRecall: 1,
      noSourceAccuracy: 1,
    });
    expect(report.generation.cases[0]).toMatchObject({
      referenceAnswer: 'The limit is 25 dollars.',
      answer: 'The limit is 25 dollars. [Source 1]',
      citations: [{ filename: 'policy.pdf', pageNumber: 2 }],
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(answer).toHaveBeenCalledTimes(2);
  });
});
