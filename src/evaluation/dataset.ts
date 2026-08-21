import { readFile } from 'node:fs/promises';
import {
  ExpectedSource,
  RetrievalEvaluationCase,
  RetrievalEvaluationDataset,
} from './evaluation.types';

export async function loadEvaluationDataset(
  path: string,
): Promise<RetrievalEvaluationDataset> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isRecord(parsed) || typeof parsed.name !== 'string') {
    throw new Error('Evaluation dataset must have a name');
  }
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error('Evaluation dataset must contain at least one case');
  }

  return {
    name: parsed.name,
    ...(typeof parsed.description === 'string' && {
      description: parsed.description,
    }),
    cases: parsed.cases.map(validateCase),
  };
}

function validateCase(value: unknown, index: number): RetrievalEvaluationCase {
  if (
    !isRecord(value) ||
    typeof value.question !== 'string' ||
    value.question.trim() === ''
  ) {
    throw new Error(`Evaluation case ${index + 1} must have a question`);
  }
  if (!Array.isArray(value.expectedSources)) {
    throw new Error(`Evaluation case ${index + 1} must define expectedSources`);
  }

  return {
    ...(typeof value.id === 'string' && { id: value.id }),
    question: value.question.trim(),
    ...(typeof value.referenceAnswer === 'string' &&
      value.referenceAnswer.trim().length > 0 && {
        referenceAnswer: value.referenceAnswer.trim(),
      }),
    expectedSources: value.expectedSources.map((source, sourceIndex) =>
      validateExpectedSource(source, index, sourceIndex),
    ),
  };
}

function validateExpectedSource(
  value: unknown,
  caseIndex: number,
  sourceIndex: number,
): ExpectedSource {
  if (!isRecord(value)) {
    throw new Error(sourceError(caseIndex, sourceIndex));
  }
  const source: ExpectedSource = {
    ...(typeof value.documentId === 'string' && {
      documentId: value.documentId,
    }),
    ...(typeof value.filename === 'string' && { filename: value.filename }),
    ...(Number.isInteger(value.pageNumber) && {
      pageNumber: value.pageNumber as number,
    }),
    ...(typeof value.chunkId === 'string' && { chunkId: value.chunkId }),
  };

  if (source.documentId === undefined && source.filename === undefined) {
    throw new Error(sourceError(caseIndex, sourceIndex));
  }
  return source;
}

function sourceError(caseIndex: number, sourceIndex: number): string {
  return `Expected source ${sourceIndex + 1} in case ${caseIndex + 1} must identify a document by documentId or filename`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
