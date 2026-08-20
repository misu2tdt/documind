import 'dotenv/config';
import { resolve } from 'node:path';
import { loadBaselineCorpus, seedBaselineCorpus } from './baseline-corpus';
import { createEvaluationDataSource } from './evaluation-data-source';

async function main(): Promise<void> {
  const corpusPath = resolve(
    process.argv[2] ?? 'evaluation/corpus/phase-4c-corpus.json',
  );
  const dataSource = createEvaluationDataSource();

  try {
    await dataSource.initialize();
    await dataSource.runMigrations();
    const corpus = await loadBaselineCorpus(corpusPath);
    const summary = await seedBaselineCorpus(dataSource, corpus);
    console.log(
      `Seeded ${summary.documents} documents and ${summary.chunks} chunks from ${corpus.name}.`,
    );
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Baseline setup failed: ${message}`);
  process.exitCode = 1;
});
