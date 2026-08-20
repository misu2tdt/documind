import {
  EvaluationCaseRun,
  RetrievalBenchmarkResult,
  RetrievalEvaluationReport,
} from './evaluation.types';

export interface BaselineComparison {
  result: RetrievalBenchmarkResult;
  evaluation: RetrievalEvaluationReport;
  noSourceAccuracy: number;
  balancedScore: number;
}

export function createBaselineComparison(
  result: RetrievalBenchmarkResult,
  evaluation: RetrievalEvaluationReport,
): BaselineComparison {
  const noSourceAccuracy = calculateNoSourceAccuracy(evaluation.cases);
  return {
    result,
    evaluation,
    noSourceAccuracy,
    balancedScore: (result.metrics.recall + noSourceAccuracy) / 2,
  };
}

export function rankBaselineComparisons(
  comparisons: BaselineComparison[],
): BaselineComparison[] {
  return [...comparisons].sort(
    (left, right) =>
      right.balancedScore - left.balancedScore ||
      right.result.metrics.recall - left.result.metrics.recall ||
      right.result.metrics.mrr - left.result.metrics.mrr ||
      left.result.configuration.topK - right.result.configuration.topK ||
      right.result.configuration.minimumSimilarity -
        left.result.configuration.minimumSimilarity ||
      left.result.configuration.strategy.localeCompare(
        right.result.configuration.strategy,
      ),
  );
}

export function calculateNoSourceAccuracy(cases: EvaluationCaseRun[]): number {
  const negativeCases = cases.filter(
    (evaluationCase) => evaluationCase.expectedSources.length === 0,
  );
  if (negativeCases.length === 0) return 1;
  return (
    negativeCases.filter(
      (evaluationCase) => evaluationCase.retrieved.length === 0,
    ).length / negativeCases.length
  );
}
