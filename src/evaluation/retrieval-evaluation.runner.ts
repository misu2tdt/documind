import { RetrievalService } from '../retrieval/retrieval.service';
import { calculateRetrievalMetrics, normalizeKValues } from './metrics';
import {
  EvaluationCaseRun,
  RetrievalEvaluationDataset,
  RetrievalEvaluationReport,
} from './evaluation.types';

export class RetrievalEvaluationRunner {
  constructor(private readonly retrievalService: RetrievalService) {}

  async run(
    dataset: RetrievalEvaluationDataset,
    kValues: number[],
  ): Promise<RetrievalEvaluationReport> {
    const normalizedKValues = normalizeKValues(kValues);
    const maximumK = normalizedKValues.at(-1)!;
    const cases: EvaluationCaseRun[] = [];

    for (const evaluationCase of dataset.cases) {
      cases.push({
        ...evaluationCase,
        retrieved: await this.retrievalService.search(
          evaluationCase.question,
          maximumK,
        ),
      });
    }

    return {
      dataset: dataset.name,
      generatedAt: new Date().toISOString(),
      kValues: normalizedKValues,
      metrics: calculateRetrievalMetrics(cases, normalizedKValues),
      cases,
    };
  }
}

export function formatEvaluationSummary(
  report: RetrievalEvaluationReport,
): string {
  const lines = [
    `Retrieval evaluation: ${report.dataset}`,
    `Cases: ${report.cases.length}`,
    '',
    'K\tHit Rate@K\tRecall@K\tMRR@K',
  ];
  for (const metric of report.metrics) {
    lines.push(
      `${metric.k}\t${percent(metric.hitRate)}\t\t${percent(metric.recall)}\t\t${metric.mrr.toFixed(4)}`,
    );
  }
  return lines.join('\n');
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
