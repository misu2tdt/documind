import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChunkContentSearchIndex1787248800000 implements MigrationInterface {
  name = 'AddChunkContentSearchIndex1787248800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_chunks_content_fts"
        ON "chunks"
        USING gin (to_tsvector('english', "content"));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_chunks_content_fts";`);
  }
}
