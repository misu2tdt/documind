import { DataSource } from 'typeorm';
import { EmbeddingService } from '../embedding/embedding.service';
import { RetrievalResultDto } from '../retrieval/dto/retrieval-result.dto';
import { RetrievalService } from '../retrieval/retrieval.service';
import { RetrievalStrategy } from '../retrieval/retrieval-strategy';
import {
  ExpectedSource,
  RetrievalEvaluationDataset,
  RetrievalMetricSummary,
} from './evaluation.types';
import {
  calculateRetrievalMetrics,
  normalizeKValues,
  sourceMatches,
} from './metrics';

interface CandidateRow extends Omit<RetrievalResultDto, 'similarity'> {
  similarity: number | string;
}

interface LexicalCandidateRow extends CandidateRow {
  lexicalScore: number | string;
  matchedTerms: number | string;
  queryTerms: number | string;
  lexicalMatch: boolean;
}

export interface LexicalCandidate extends RetrievalResultDto {
  lexicalScore: number;
  matchedTerms: number;
  queryTerms: number;
  lexicalMatch: boolean;
}

export interface CandidateRecallResult {
  strategy: RetrievalStrategy;
  minimumSimilarity: number;
  metrics: RetrievalMetricSummary[];
}

export interface RelevantCandidateDiagnostic {
  expectedSource: ExpectedSource;
  chunkId: string | null;
  vectorRank: number | null;
  vectorSimilarity: number | null;
  rawLexicalRank: number | null;
  guardedLexicalRank: number | null;
  lexicalScore: number | null;
  lexicalMatchedTerms: number;
  lexicalQueryTerms: number;
  hybridRank: number | null;
  removedByBaseFilter: boolean;
  removedByThreshold: boolean;
  removedByLexicalGuard: boolean;
  rejectedByLexicalQuery: boolean;
  lexicalMatchAbsent: boolean;
}

export interface CandidateFailureDiagnostic {
  id: string;
  question: string;
  relevant: RelevantCandidateDiagnostic[];
  cause: 'candidate-generation' | 'ranking';
}

export interface CandidateAnalysisReport {
  dataset: string;
  generatedAt: string;
  kValues: number[];
  thresholds: number[];
  baseline: { topK: number; minimumSimilarity: number };
  candidateRecall: CandidateRecallResult[];
  failures: CandidateFailureDiagnostic[];
}

export type CandidateRetrievalServiceFactory = (
  strategy: RetrievalStrategy,
  minimumSimilarity: number,
) => RetrievalService;

const DIAGNOSTIC_LIMIT = 100;

export class CandidateAnalysisRunner {
  constructor(
    private readonly dataSource: DataSource,
    private readonly embeddingService: EmbeddingService,
    private readonly serviceFactory: CandidateRetrievalServiceFactory,
  ) {}

  async run(
    dataset: RetrievalEvaluationDataset,
    kValues: number[],
    thresholds: number[],
    baseline = { topK: 3, minimumSimilarity: 0.2 },
  ): Promise<CandidateAnalysisReport> {
    const normalizedKValues = normalizeKValues(kValues);
    const normalizedThresholds = normalizeThresholds(thresholds);
    const maximumK = normalizedKValues.at(-1)!;
    const candidateRecall: CandidateRecallResult[] = [];

    for (const strategy of ['vector', 'hybrid'] as const) {
      for (const minimumSimilarity of normalizedThresholds) {
        const service = this.serviceFactory(strategy, minimumSimilarity);
        const cases = await Promise.all(
          dataset.cases.map(async (evaluationCase) => ({
            ...evaluationCase,
            retrieved: await service.search(evaluationCase.question, maximumK),
          })),
        );
        candidateRecall.push({
          strategy,
          minimumSimilarity,
          metrics: calculateRetrievalMetrics(cases, normalizedKValues),
        });
      }
    }

    const failures: CandidateFailureDiagnostic[] = [];
    const baselineService = this.serviceFactory(
      'hybrid',
      baseline.minimumSimilarity,
    );

    for (const evaluationCase of dataset.cases) {
      if (evaluationCase.expectedSources.length === 0) continue;
      const baselineResults = await baselineService.search(
        evaluationCase.question,
        Math.max(maximumK, baseline.topK),
      );
      const failedAtBaseline = evaluationCase.expectedSources.some(
        (expected) =>
          !baselineResults
            .slice(0, baseline.topK)
            .some((actual) => sourceMatches(expected, actual)),
      );
      if (!failedAtBaseline) continue;

      const queryEmbedding = await this.embeddingService.embedOne(
        evaluationCase.question,
      );
      const [vectorCandidates, lexicalEvidence] = await Promise.all([
        this.vectorCandidates(queryEmbedding),
        this.lexicalCandidates(evaluationCase.question, queryEmbedding),
      ]);
      const lexicalCandidates = lexicalEvidence.filter(
        (candidate) => candidate.lexicalMatch,
      );
      const guardedLexical = lexicalCandidates.filter(passesLexicalGuard);
      const relevant = evaluationCase.expectedSources.map((expected) =>
        diagnoseRelevantCandidate(
          expected,
          vectorCandidates,
          lexicalEvidence,
          lexicalCandidates,
          guardedLexical,
          baselineResults,
          baseline.minimumSimilarity,
        ),
      );

      failures.push({
        id: evaluationCase.id ?? evaluationCase.question,
        question: evaluationCase.question,
        relevant,
        cause: relevant.every((diagnostic) => diagnostic.hybridRank !== null)
          ? 'ranking'
          : 'candidate-generation',
      });
    }

    return {
      dataset: dataset.name,
      generatedAt: new Date().toISOString(),
      kValues: normalizedKValues,
      thresholds: normalizedThresholds,
      baseline,
      candidateRecall,
      failures,
    };
  }

  private async vectorCandidates(
    queryEmbedding: number[],
  ): Promise<RetrievalResultDto[]> {
    const rows = await this.dataSource.query<CandidateRow[]>(
      `SELECT
         c.id AS "chunkId",
         c.document_id AS "documentId",
         d.filename AS "filename",
         c."pageNumber" AS "pageNumber",
         c.content AS "content",
         1 - (c.embedding <=> $1::vector) AS "similarity"
       FROM chunks c
       INNER JOIN documents d ON d.id = c.document_id
       WHERE c.embedding IS NOT NULL
         AND d.status = 'completed'
       ORDER BY c.embedding <=> $1::vector ASC, c.id ASC
       LIMIT $2`,
      [JSON.stringify(queryEmbedding), DIAGNOSTIC_LIMIT],
    );
    return rows.map(numericCandidate);
  }

  private async lexicalCandidates(
    question: string,
    queryEmbedding: number[],
  ): Promise<LexicalCandidate[]> {
    const rows = await this.dataSource.query<LexicalCandidateRow[]>(
      `WITH lexical_terms AS (
         SELECT
           array_agg(lexeme ORDER BY lexeme) AS terms,
           string_agg(quote_literal(lexeme), ' | ' ORDER BY lexeme) AS expression
         FROM unnest(
           tsvector_to_array(to_tsvector('english', $1))
         ) AS lexeme
       ), lexical_query AS (
         SELECT
           terms,
           to_tsquery('simple', expression) AS query
         FROM lexical_terms
       )
       SELECT
         c.id AS "chunkId",
         c.document_id AS "documentId",
         d.filename AS "filename",
         c."pageNumber" AS "pageNumber",
         c.content AS "content",
         1 - (c.embedding <=> $2::vector) AS "similarity",
         ts_rank_cd(to_tsvector('english', c.content), lexical_query.query) AS "lexicalScore",
         (
           SELECT count(*)
           FROM unnest(
             tsvector_to_array(to_tsvector('english', c.content))
           ) AS content_lexeme
           WHERE content_lexeme = ANY(lexical_query.terms)
         ) AS "matchedTerms",
         cardinality(lexical_query.terms) AS "queryTerms",
         to_tsvector('english', c.content) @@ lexical_query.query AS "lexicalMatch"
       FROM chunks c
       INNER JOIN documents d ON d.id = c.document_id
       CROSS JOIN lexical_query
       WHERE c.embedding IS NOT NULL
         AND d.status = 'completed'
         AND lexical_query.query IS NOT NULL
       ORDER BY "lexicalMatch" DESC, "lexicalScore" DESC, c.id ASC
       LIMIT $3`,
      [question, JSON.stringify(queryEmbedding), DIAGNOSTIC_LIMIT],
    );
    return rows.map((row) => ({
      ...numericCandidate(row),
      lexicalScore: Number(row.lexicalScore),
      matchedTerms: Number(row.matchedTerms),
      queryTerms: Number(row.queryTerms),
      lexicalMatch: row.lexicalMatch,
    }));
  }
}

export function diagnoseRelevantCandidate(
  expectedSource: ExpectedSource,
  vectorCandidates: RetrievalResultDto[],
  lexicalEvidence: LexicalCandidate[],
  lexicalCandidates: LexicalCandidate[],
  guardedLexicalCandidates: LexicalCandidate[],
  hybridCandidates: RetrievalResultDto[],
  minimumSimilarity: number,
): RelevantCandidateDiagnostic {
  const vectorIndex = vectorCandidates.findIndex((candidate) =>
    sourceMatches(expectedSource, candidate),
  );
  const lexicalIndex = lexicalCandidates.findIndex((candidate) =>
    sourceMatches(expectedSource, candidate),
  );
  const lexicalEvidenceCandidate = lexicalEvidence.find((candidate) =>
    sourceMatches(expectedSource, candidate),
  );
  const guardedIndex = guardedLexicalCandidates.findIndex((candidate) =>
    sourceMatches(expectedSource, candidate),
  );
  const hybridIndex = hybridCandidates.findIndex((candidate) =>
    sourceMatches(expectedSource, candidate),
  );
  const vector = vectorCandidates[vectorIndex];
  const lexical = lexicalCandidates[lexicalIndex];
  const actual = vector ?? lexicalEvidenceCandidate;

  return {
    expectedSource,
    chunkId: actual?.chunkId ?? null,
    vectorRank: vectorIndex < 0 ? null : vectorIndex + 1,
    vectorSimilarity:
      vector?.similarity ?? lexicalEvidenceCandidate?.similarity ?? null,
    rawLexicalRank: lexicalIndex < 0 ? null : lexicalIndex + 1,
    guardedLexicalRank: guardedIndex < 0 ? null : guardedIndex + 1,
    lexicalScore: lexicalEvidenceCandidate?.lexicalScore ?? null,
    lexicalMatchedTerms: lexicalEvidenceCandidate?.matchedTerms ?? 0,
    lexicalQueryTerms: lexicalEvidenceCandidate?.queryTerms ?? 0,
    hybridRank: hybridIndex < 0 ? null : hybridIndex + 1,
    removedByBaseFilter: actual === undefined,
    removedByThreshold:
      vector !== undefined && vector.similarity < minimumSimilarity,
    removedByLexicalGuard: lexical !== undefined && guardedIndex < 0,
    rejectedByLexicalQuery:
      lexicalEvidenceCandidate !== undefined &&
      !lexicalEvidenceCandidate.lexicalMatch,
    lexicalMatchAbsent: lexical === undefined,
  };
}

function passesLexicalGuard(candidate: LexicalCandidate): boolean {
  return candidate.matchedTerms >= Math.min(2, candidate.queryTerms);
}

function numericCandidate(row: CandidateRow): RetrievalResultDto {
  return { ...row, similarity: Number(row.similarity) };
}

function normalizeThresholds(thresholds: number[]): number[] {
  const normalized = [...new Set(thresholds)].sort(
    (left, right) => left - right,
  );
  if (
    normalized.length === 0 ||
    normalized.some(
      (value) => !Number.isFinite(value) || value < -1 || value > 1,
    )
  ) {
    throw new Error('Thresholds must be numbers between -1 and 1');
  }
  return normalized;
}
