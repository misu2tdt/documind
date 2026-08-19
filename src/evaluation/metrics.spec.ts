import { RetrievalResultDto } from '../retrieval/dto/retrieval-result.dto';
import { calculateRetrievalMetrics, normalizeKValues } from './metrics';
import { EvaluationCaseRun } from './evaluation.types';

function result(
  chunkId: string,
  filename: string,
  pageNumber: number,
): RetrievalResultDto {
  return {
    chunkId,
    documentId: `document-${filename}`,
    filename,
    pageNumber,
    content: 'content',
    similarity: 0.9,
  };
}

describe('retrieval metrics', () => {
  const cases: EvaluationCaseRun[] = [
    {
      question: 'first',
      expectedSources: [
        { filename: 'a.pdf', pageNumber: 1 },
        { filename: 'b.pdf', pageNumber: 2 },
      ],
      retrieved: [result('irrelevant', 'x.pdf', 1), result('b', 'b.pdf', 2)],
    },
    {
      question: 'second',
      expectedSources: [{ filename: 'c.pdf' }],
      retrieved: [result('c', 'c.pdf', 4)],
    },
    {
      question: 'miss',
      expectedSources: [{ filename: 'missing.pdf' }],
      retrieved: [result('other', 'other.pdf', 1)],
    },
  ];

  it('computes Hit Rate, Recall, and MRR at each K', () => {
    expect(calculateRetrievalMetrics(cases, [1, 2])).toEqual([
      {
        k: 1,
        hitRate: 1 / 3,
        recall: 1 / 3,
        mrr: 1 / 3,
      },
      {
        k: 2,
        hitRate: 2 / 3,
        recall: 0.5,
        mrr: 0.5,
      },
    ]);
  });

  it('normalizes K values deterministically', () => {
    expect(normalizeKValues([5, 1, 5, 3])).toEqual([1, 3, 5]);
  });

  it('rejects invalid K values', () => {
    for (const values of [[], [0], [1.5], [101]]) {
      expect(() => normalizeKValues(values)).toThrow(
        'K values must be unique integers between 1 and 100',
      );
    }
  });
});
