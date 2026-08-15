import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDocumentAndChunkSchema1786813200000 implements MigrationInterface {
  name = 'CreateDocumentAndChunkSchema1786813200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    await queryRunner.query(`
      CREATE TYPE "documents_status_enum" AS ENUM (
        'pending',
        'processing',
        'completed',
        'failed'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "filename" varchar(255) NOT NULL,
        "storagePath" text NOT NULL,
        "fileSizeBytes" integer NOT NULL,
        "status" "documents_status_enum" NOT NULL DEFAULT 'pending',
        "pageCount" integer NOT NULL DEFAULT 0,
        "chunkCount" integer NOT NULL DEFAULT 0,
        "errorMessage" text,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_documents_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "chunks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "document_id" uuid NOT NULL,
        "content" text NOT NULL,
        "pageNumber" integer NOT NULL,
        "chunkIndex" integer NOT NULL,
        "tokenCount" integer NOT NULL,
        "embedding" vector(1536),
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chunks_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chunks_document_id"
          FOREIGN KEY ("document_id")
          REFERENCES "documents"("id")
          ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_chunks_document_id"
        ON "chunks" ("document_id");
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_chunks_document_id_chunk_index"
        ON "chunks" ("document_id", "chunkIndex");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_chunks_embedding_hnsw_cosine"
        ON "chunks"
        USING hnsw ("embedding" vector_cosine_ops);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chunks";`);
    await queryRunner.query(`DROP TABLE "documents";`);
    await queryRunner.query(`DROP TYPE "documents_status_enum";`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS "uuid-ossp";`);
  }
}
