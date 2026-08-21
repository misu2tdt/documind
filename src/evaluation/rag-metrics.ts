import { SourceCitationDto } from '../questions/dto/question-response.dto';
import { INSUFFICIENT_CONTEXT_ANSWER } from '../questions/questions.constants';
import { ExpectedSource, RetrievalEvaluationCase } from './evaluation.types';

export interface RagEvaluationCaseRun extends RetrievalEvaluationCase {
  answer: string;
  citations: SourceCitationDto[];
}

export interface RagMetricSummary {
  citationPrecision: number;
  citationRecall: number;
  sourceCorrectness: number;
  pageCorrectness: number;
  noSourceAccuracy: number;
  citedSources: number;
  expectedSources: number;
  noSourceCases: number;
}

export function calculateRagMetrics(
  cases: RagEvaluationCaseRun[],
): RagMetricSummary {
  if (cases.length === 0) {
    throw new Error('At least one RAG evaluation case is required');
  }

  let citedSources = 0;
  let correctCitations = 0;
  let sourceCorrectCitations = 0;
  let pageCorrectCitations = 0;
  let expectedSources = 0;
  let recalledSources = 0;
  let correctNoSourceCases = 0;
  const noSourceCases = cases.filter(
    (evaluationCase) => evaluationCase.expectedSources.length === 0,
  );

  for (const evaluationCase of cases) {
    citedSources += evaluationCase.citations.length;
    expectedSources += evaluationCase.expectedSources.length;

    for (const citation of evaluationCase.citations) {
      if (
        evaluationCase.expectedSources.some((expected) =>
          citationMatches(expected, citation, 'exact'),
        )
      ) {
        correctCitations += 1;
      }
      if (
        evaluationCase.expectedSources.some((expected) =>
          citationMatches(expected, citation, 'source'),
        )
      ) {
        sourceCorrectCitations += 1;
      }
      if (
        evaluationCase.expectedSources.some((expected) =>
          citationMatches(expected, citation, 'page'),
        )
      ) {
        pageCorrectCitations += 1;
      }
    }

    recalledSources += evaluationCase.expectedSources.filter((expected) =>
      evaluationCase.citations.some((citation) =>
        citationMatches(expected, citation, 'exact'),
      ),
    ).length;

    if (
      evaluationCase.expectedSources.length === 0 &&
      evaluationCase.answer === INSUFFICIENT_CONTEXT_ANSWER &&
      evaluationCase.citations.length === 0
    ) {
      correctNoSourceCases += 1;
    }
  }

  return {
    citationPrecision: ratio(correctCitations, citedSources),
    citationRecall: ratio(recalledSources, expectedSources),
    sourceCorrectness: ratio(sourceCorrectCitations, citedSources),
    pageCorrectness: ratio(pageCorrectCitations, citedSources),
    noSourceAccuracy: ratio(correctNoSourceCases, noSourceCases.length),
    citedSources,
    expectedSources,
    noSourceCases: noSourceCases.length,
  };
}

type MatchLevel = 'source' | 'page' | 'exact';

function citationMatches(
  expected: ExpectedSource,
  citation: SourceCitationDto,
  level: MatchLevel,
): boolean {
  const sourceMatches =
    (expected.documentId === undefined ||
      expected.documentId === citation.documentId) &&
    (expected.filename === undefined ||
      expected.filename === citation.filename);
  if (!sourceMatches || level === 'source') return sourceMatches;

  const pageMatches =
    expected.pageNumber === undefined ||
    expected.pageNumber === citation.pageNumber;
  if (!pageMatches || level === 'page') return pageMatches;

  return (
    expected.chunkId === undefined || expected.chunkId === citation.chunkId
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}
