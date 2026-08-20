import {
  createBaselineComparison,
  rankBaselineComparisons,
} from './baseline-analysis';
import {
  EvaluationCaseRun,
  RetrievalBenchmarkResult,
  RetrievalEvaluationReport,
} from './evaluation.types';

function comparison(
  topK: number,
  threshold: number,
  recall: number,
  negativeRetrieved: boolean,
) {
  const result: RetrievalBenchmarkResult = {
    rank: 1,
    configuration: {
      strategy: 'vector',
      topK,
      minimumSimilarity: threshold,
    },
    metrics: { k: topK, hitRate: recall, recall, mrr: recall },
  };
  const cases: EvaluationCaseRun[] = [
    {
      question: 'negative',
      expectedSources: [],
      retrieved: negativeRetrieved
        ? [
            {
              chunkId: 'chunk',
              documentId: 'document',
              filename: 'document.pdf',
              pageNumber: 1,
              content: 'irrelevant',
              similarity: 0.1,
            },
          ]
        : [],
    },
  ];
  const evaluation: RetrievalEvaluationReport = {
    dataset: 'baseline',
    generatedAt: '2026-08-20T00:00:00.000Z',
    kValues: [topK],
    metrics: [result.metrics],
    cases,
  };
  return createBaselineComparison(result, evaluation);
}

describe('baseline analysis', () => {
  it('balances positive recall with no-source accuracy', () => {
    const permissive = comparison(5, 0, 1, true);
    const guarded = comparison(3, 0.2, 0.9, false);

    expect(permissive.balancedScore).toBe(0.5);
    expect(guarded.balancedScore).toBe(0.95);
    expect(rankBaselineComparisons([permissive, guarded])[0]).toBe(guarded);
  });

  it('uses smaller topK as a deterministic quality tie-breaker', () => {
    const wider = comparison(5, 0.2, 0.9, false);
    const narrower = comparison(3, 0.2, 0.9, false);

    expect(rankBaselineComparisons([wider, narrower])[0]).toBe(narrower);
  });
});
