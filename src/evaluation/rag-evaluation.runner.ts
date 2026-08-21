import { QuestionsService } from '../questions/questions.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import {
  RetrievalEvaluationDataset,
  RetrievalEvaluationReport,
} from './evaluation.types';
import {
  calculateRagMetrics,
  RagEvaluationCaseRun,
  RagMetricSummary,
} from './rag-metrics';
import { RetrievalEvaluationRunner } from './retrieval-evaluation.runner';

export interface RagEvaluationReport {
  dataset: string;
  generatedAt: string;
  retrieval: RetrievalEvaluationReport;
  generation: {
    metrics: RagMetricSummary;
    cases: RagEvaluationCaseRun[];
  };
}

export class RagEvaluationRunner {
  constructor(
    private readonly retrievalService: RetrievalService,
    private readonly questionsService: QuestionsService,
  ) {}

  async run(
    dataset: RetrievalEvaluationDataset,
    topK: number,
  ): Promise<RagEvaluationReport> {
    const retrieval = await new RetrievalEvaluationRunner(
      this.retrievalService,
    ).run(dataset, [topK]);
    const cases: RagEvaluationCaseRun[] = [];

    for (const evaluationCase of dataset.cases) {
      const response = await this.questionsService.answer(
        evaluationCase.question,
        topK,
      );
      cases.push({
        ...evaluationCase,
        answer: response.answer,
        citations: response.citations,
      });
    }

    return {
      dataset: dataset.name,
      generatedAt: new Date().toISOString(),
      retrieval,
      generation: {
        metrics: calculateRagMetrics(cases),
        cases,
      },
    };
  }
}
