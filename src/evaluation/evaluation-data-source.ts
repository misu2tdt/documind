import { DataSource } from 'typeorm';
import { Chunk } from '../documents/entities/chunk.entity';
import { Document } from '../documents/entities/document.entity';
import { EnablePgvector20260804201511 } from '../database/migrations/20260804201511-EnablePgvector';
import { CreateDocumentAndChunkSchema1786813200000 } from '../database/migrations/1786813200000-CreateDocumentAndChunkSchema';

export function createEvaluationDataSource(): DataSource {
  const database = process.env.TEST_DB_DATABASE ?? 'documind_integration_test';
  const port = Number(process.env.TEST_DB_PORT ?? 5435);

  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to use non-test database for evaluation: ${database}`,
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 5434) {
    throw new Error(`Unsafe or invalid evaluation database port: ${port}`);
  }

  return new DataSource({
    type: 'postgres',
    host: process.env.TEST_DB_HOST ?? '127.0.0.1',
    port,
    username: process.env.TEST_DB_USERNAME ?? 'postgres',
    password: process.env.TEST_DB_PASSWORD ?? 'postgres',
    database,
    entities: [Document, Chunk],
    migrations: [
      EnablePgvector20260804201511,
      CreateDocumentAndChunkSchema1786813200000,
    ],
    synchronize: false,
    installExtensions: false,
  });
}
