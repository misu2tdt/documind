import { RetrievalResultDto } from '../retrieval/dto/retrieval-result.dto';
import {
  EvaluationCaseRun,
  ExpectedSource,
  RetrievalMetricSummary,
} from './evaluation.types';

export function sourceMatches(
  expected: ExpectedSource,
  actual: RetrievalResultDto,
): boolean {
  return (
    (expected.documentId === undefined ||
      expected.documentId === actual.documentId) &&
    (expected.filename === undefined ||
      expected.filename === actual.filename) &&
    (expected.pageNumber === undefined ||
      expected.pageNumber === actual.pageNumber) &&
    (expected.chunkId === undefined || expected.chunkId === actual.chunkId)
  );
}

export function normalizeKValues(kValues: number[]): number[] {
  const normalized = [...new Set(kValues)].sort((left, right) => left - right);
  if (
    normalized.length === 0 ||
    normalized.some(
      (value) => !Number.isInteger(value) || value < 1 || value > 100,
    )
  ) {
    throw new Error('K values must be unique integers between 1 and 100');
  }
  return normalized;
}

export function calculateRetrievalMetrics(
  cases: EvaluationCaseRun[],
  kValues: number[],
): RetrievalMetricSummary[] {
  if (cases.length === 0) {
    throw new Error('At least one evaluation case is required');
  }

  const relevantCases = cases.filter(
    (evaluationCase) => evaluationCase.expectedSources.length > 0,
  );
  if (relevantCases.length === 0) {
    throw new Error('At least one case with an expected source is required');
  }

  return normalizeKValues(kValues).map((k) => {
    let hits = 0;
    let recallTotal = 0;
    let reciprocalRankTotal = 0;

    for (const evaluationCase of relevantCases) {
      const retrieved = evaluationCase.retrieved.slice(0, k);
      const matchedExpected = evaluationCase.expectedSources.filter(
        (expected) =>
          retrieved.some((actual) => sourceMatches(expected, actual)),
      ).length;
      const firstRelevantIndex = retrieved.findIndex((actual) =>
        evaluationCase.expectedSources.some((expected) =>
          sourceMatches(expected, actual),
        ),
      );

      if (matchedExpected > 0) hits += 1;
      recallTotal += matchedExpected / evaluationCase.expectedSources.length;
      if (firstRelevantIndex >= 0) {
        reciprocalRankTotal += 1 / (firstRelevantIndex + 1);
      }
    }

    return {
      k,
      hitRate: hits / relevantCases.length,
      recall: recallTotal / relevantCases.length,
      mrr: reciprocalRankTotal / relevantCases.length,
    };
  });
}
