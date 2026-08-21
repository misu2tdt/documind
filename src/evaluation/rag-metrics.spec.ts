import { INSUFFICIENT_CONTEXT_ANSWER } from '../questions/questions.constants';
import { calculateRagMetrics, RagEvaluationCaseRun } from './rag-metrics';

describe('RAG evaluation metrics', () => {
  it('calculates deterministic citation and no-source metrics', () => {
    const cases: RagEvaluationCaseRun[] = [
      {
        question: 'first',
        expectedSources: [{ filename: 'a.pdf', pageNumber: 1, chunkId: 'a-1' }],
        answer: 'Answer [Source 1].',
        citations: [citation('a.pdf', 1, 'a-1'), citation('a.pdf', 3, 'a-3')],
      },
      {
        question: 'second',
        expectedSources: [{ filename: 'b.pdf', pageNumber: 2 }],
        answer: 'Answer [Source 1].',
        citations: [citation('b.pdf', 2, 'b-2')],
      },
      {
        question: 'unsupported correct',
        expectedSources: [],
        answer: INSUFFICIENT_CONTEXT_ANSWER,
        citations: [],
      },
      {
        question: 'unsupported incorrect',
        expectedSources: [],
        answer: 'Invented answer [Source 1].',
        citations: [citation('c.pdf', 1, 'c-1')],
      },
    ];

    expect(calculateRagMetrics(cases)).toEqual({
      citationPrecision: 0.5,
      citationRecall: 1,
      sourceCorrectness: 0.75,
      pageCorrectness: 0.5,
      noSourceAccuracy: 0.5,
      citedSources: 4,
      expectedSources: 2,
      noSourceCases: 2,
    });
  });

  it('uses neutral perfect scores for metric groups with no denominator', () => {
    expect(
      calculateRagMetrics([
        {
          question: 'unsupported',
          expectedSources: [],
          answer: INSUFFICIENT_CONTEXT_ANSWER,
          citations: [],
        },
      ]),
    ).toMatchObject({
      citationPrecision: 1,
      citationRecall: 1,
      sourceCorrectness: 1,
      pageCorrectness: 1,
      noSourceAccuracy: 1,
    });
  });
});

function citation(filename: string, pageNumber: number, chunkId: string) {
  return {
    documentId: `document-${filename}`,
    filename,
    pageNumber,
    chunkId,
  };
}
