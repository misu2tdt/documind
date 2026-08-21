import { RetrievalResultDto } from '../retrieval/dto/retrieval-result.dto';
import { RetrievalStrategy } from '../retrieval/retrieval-strategy';

export interface ExpectedSource {
  documentId?: string;
  filename?: string;
  pageNumber?: number;
  chunkId?: string;
}

export interface RetrievalEvaluationCase {
  id?: string;
  question: string;
  referenceAnswer?: string;
  expectedSources: ExpectedSource[];
}

export interface RetrievalEvaluationDataset {
  name: string;
  description?: string;
  cases: RetrievalEvaluationCase[];
}

export interface EvaluationCaseRun extends RetrievalEvaluationCase {
  retrieved: RetrievalResultDto[];
}

export interface RetrievalMetricSummary {
  k: number;
  hitRate: number;
  recall: number;
  mrr: number;
}

export interface RetrievalEvaluationReport {
  dataset: string;
  generatedAt: string;
  kValues: number[];
  metrics: RetrievalMetricSummary[];
  cases: EvaluationCaseRun[];
}

export interface RetrievalBenchmarkConfiguration {
  strategy: RetrievalStrategy;
  topK: number;
  minimumSimilarity: number;
}

export interface RetrievalBenchmarkResult {
  rank: number;
  configuration: RetrievalBenchmarkConfiguration;
  metrics: RetrievalMetricSummary;
}

export interface RetrievalBenchmarkReport {
  dataset: string;
  generatedAt: string;
  configurations: RetrievalBenchmarkResult[];
}
