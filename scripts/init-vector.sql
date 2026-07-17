ALTER TABLE chunks
  ALTER COLUMN embedding TYPE vector(1536)
  USING embedding::vector;

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks
  USING hnsw (embedding vector_cosine_ops);