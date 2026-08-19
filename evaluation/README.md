# Retrieval evaluation

The evaluation CLI runs the production `RetrievalService` against the configured
PostgreSQL + pgvector database. It is not registered in the application API.

Dataset cases contain a question and one or more expected sources. Each source
must identify a document by `filename` or `documentId`; `pageNumber` and
`chunkId` can make the relevance target more specific.

```json
{
  "name": "my-dataset",
  "cases": [
    {
      "id": "retention-policy",
      "question": "How long are records retained?",
      "expectedSources": [{ "filename": "handbook.pdf", "pageNumber": 7 }]
    }
  ]
}
```

Run migrations and ingest the referenced documents before evaluation. The CLI
uses the configured OpenAI embedding model, so reproducibility requires keeping
`EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, the database snapshot, and dataset
fixed. Integration tests replace only the external embedding call with a fixed
1536-dimensional vector while exercising the real pgvector query.

```bash
npm run eval:retrieval -- --dataset evaluation/datasets/sample.json --k 1,3,5 --output evaluation-results/retrieval.json
```

The console prints Hit Rate@K, Recall@K, and MRR@K. The output file contains the
same metrics plus per-case retrieved results as JSON. Generated reports under
`evaluation-results/` are ignored by Git.
