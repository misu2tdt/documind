import { readFile } from 'node:fs/promises';
import { DataSource } from 'typeorm';
import { Chunk } from '../documents/entities/chunk.entity';
import {
  Document,
  DocumentStatus,
} from '../documents/entities/document.entity';
import { deterministicEmbedding } from './deterministic-embedding';

export interface BaselineCorpus {
  name: string;
  documents: BaselineDocument[];
}

interface BaselineDocument {
  id: string;
  filename: string;
  pages: Array<{
    pageNumber: number;
    chunks: Array<{ id: string; content: string }>;
  }>;
}

export interface SeedSummary {
  documents: number;
  chunks: number;
}

const STORAGE_PREFIX = 'evaluation://phase-4c/';

export async function loadBaselineCorpus(
  path: string,
): Promise<BaselineCorpus> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as BaselineCorpus;
  if (
    !parsed.name ||
    !Array.isArray(parsed.documents) ||
    parsed.documents.length < 2
  ) {
    throw new Error(
      'Baseline corpus must contain a name and several documents',
    );
  }
  for (const document of parsed.documents) {
    if (!document.id || !document.filename || !document.pages?.length) {
      throw new Error(
        'Every corpus document must have an id, filename, and pages',
      );
    }
  }
  return parsed;
}

export async function seedBaselineCorpus(
  dataSource: DataSource,
  corpus: BaselineCorpus,
): Promise<SeedSummary> {
  let chunkCount = 0;
  await dataSource.transaction(async (manager) => {
    await manager.createQueryBuilder().delete().from(Document).execute();

    for (const source of corpus.documents) {
      const flattenedChunks = source.pages.flatMap((page) =>
        page.chunks.map((chunk) => ({ ...chunk, pageNumber: page.pageNumber })),
      );
      const fileSizeBytes = Buffer.byteLength(
        flattenedChunks.map((chunk) => chunk.content).join('\n'),
      );
      await manager.save(
        manager.create(Document, {
          id: source.id,
          filename: source.filename,
          storagePath: `${STORAGE_PREFIX}${source.filename}`,
          fileSizeBytes,
          status: DocumentStatus.COMPLETED,
          pageCount: source.pages.length,
          chunkCount: flattenedChunks.length,
          errorMessage: null,
        }),
      );
      await manager.save(
        Chunk,
        flattenedChunks.map((chunk, chunkIndex) =>
          manager.create(Chunk, {
            id: chunk.id,
            documentId: source.id,
            content: chunk.content,
            pageNumber: chunk.pageNumber,
            chunkIndex,
            tokenCount: chunk.content.split(/\s+/).length,
            embedding: deterministicEmbedding(chunk.content),
          }),
        ),
      );
      chunkCount += flattenedChunks.length;
    }
  });

  return { documents: corpus.documents.length, chunks: chunkCount };
}
