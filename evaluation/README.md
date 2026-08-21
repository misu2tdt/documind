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

## Configuration benchmark

Benchmark a deterministic grid of topK values and minimum similarity thresholds:

```bash
npm run eval:retrieval:benchmark -- --dataset evaluation/datasets/sample.json --top-k 1,3,5 --thresholds 0.3,0.5,0.7 --output evaluation-results/benchmark.json
```

Questions are embedded once and cached for every configuration in a run. Results
are ranked by Recall@K, MRR@K, Hit Rate@K, then smaller topK and higher threshold
for deterministic quality ties. The benchmark never changes production defaults.

## Phase 4C reproducible baseline

The Phase 4C corpus contains five synthetic policy documents, 20 labeled page
chunks, and 25 questions covering direct lookup, paraphrases, repeated terms,
multi-source answers, and questions with no relevant source. Fixed document and
chunk UUIDs keep source labels stable.

Start the isolated PostgreSQL + pgvector test database, run migrations and seed
the corpus, then benchmark it:

```bash
npm run test:integration:db:up
npm run eval:baseline:setup
npm run eval:baseline:benchmark
```

The setup command refuses databases whose name does not end in `_test` and also
refuses the development port `5434`. Override its isolated defaults with
`TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USERNAME`, `TEST_DB_PASSWORD`, and
`TEST_DB_DATABASE` when needed. Seeding is idempotent and clears documents from
that dedicated test database before inserting the fixed corpus, preventing old
integration fixtures from contaminating benchmark results.

The baseline uses a deterministic evaluation-only hashed bag-of-words embedding
with a small, explicit paraphrase map. It always emits 1536-dimensional vectors.
This mocks the external embedding provider while keeping migrations, vector
persistence, cosine search, filtering, thresholds, and ranking on the real
production retrieval path. It is intentionally a stable architecture baseline,
not a claim about OpenAI embedding quality.

Positive Hit Rate, Recall, and MRR exclude the three no-relevant-source cases;
those are reported separately as no-source accuracy. The JSON report includes
the full ranked grid, best-configuration results, and failure details under
`evaluation-results/phase-4c-baseline.json`.

### Recorded baseline

The Phase 4C run over `topK=1,3,5,8` and thresholds `0,0.1,0.2,0.3` produced:

| Selection             | topK | Threshold | Hit Rate |  Recall |    MRR | No-source accuracy |
| --------------------- | ---: | --------: | -------: | ------: | -----: | -----------------: |
| Positive metrics only |    5 |      0.00 |  100.00% | 100.00% | 0.9432 |              0.00% |
| Balanced baseline     |    3 |      0.20 |   86.36% |  86.36% | 0.8409 |            100.00% |

The balanced selection maximizes the mean of Recall@K and no-source accuracy;
MRR, smaller topK, and higher threshold provide deterministic tie-breaks. Its
three misses were the direct MFA query, the paraphrased proof-of-purchase query,
and the paraphrased two-factor query. All fell below the 0.20 threshold. This
captures the main baseline tradeoff: a permissive threshold recovers all labeled
sources but cannot reject unsupported questions, while the guarded threshold
loses short or paraphrased matches.

Stop and remove the isolated test database after use:

```bash
npm run test:integration:db:down
```

## Phase 4D hybrid retrieval

Hybrid retrieval combines the existing thresholded cosine-similarity ranking
with PostgreSQL English full-text search over chunk content. Lexical candidates
must match at least two distinct query lexemes when the query contains two or
more. The two ranked lists are combined with equal-weight reciprocal rank
fusion (RRF, rank constant 60), followed by stable lexical-rank, vector-rank,
and chunk-ID tie-breaks.

`RETRIEVAL_STRATEGY` accepts `vector` or `hybrid`; its production default
remains `vector`. Evaluation can compare strategies explicitly:

```bash
npm run eval:baseline:benchmark -- --strategies vector,hybrid --output evaluation-results/phase-4d-hybrid.json
```

The Phase 4D run used the same 25 questions, `topK=1,3,5,8`, and thresholds
`0,0.1,0.2,0.3`. The best balanced configuration for each strategy was:

| Strategy | topK | Threshold | Hit Rate | Recall |    MRR | No-source accuracy | Balanced score |
| -------- | ---: | --------: | -------: | -----: | -----: | -----------------: | -------------: |
| Vector   |    3 |      0.20 |   86.36% | 86.36% | 0.8409 |            100.00% |         93.18% |
| Hybrid   |    3 |      0.20 |   90.91% | 90.91% | 0.9091 |            100.00% |         95.45% |

Hybrid retrieval recovered the paraphrased two-factor-authentication case.
The direct MFA question and paraphrased proof-of-purchase question still fell
below the vector threshold and lacked two lexical term matches. This is enough
evidence to retain hybrid as an opt-in strategy, but not to change the
production default based on this small synthetic corpus alone.

## Phase 4E candidate analysis

Candidate diagnostics use the same isolated corpus and production retrieval
path while recording broad vector ranks, similarities, raw and guarded lexical
ranks, query-term overlap, and final hybrid ranks. Run:

```bash
npm run eval:baseline:candidates
```

Across K values 5, 10, and 20, candidate recall was unchanged at every K:

| Strategy | Threshold | Recall@5 | Recall@10 | Recall@20 |
| -------- | --------: | -------: | --------: | --------: |
| Vector   |     -1.00 |  100.00% |   100.00% |   100.00% |
| Vector   |      0.00 |  100.00% |   100.00% |   100.00% |
| Vector   |      0.10 |   90.91% |    90.91% |    90.91% |
| Vector   |      0.20 |   86.36% |    86.36% |    86.36% |
| Hybrid   |     -1.00 |  100.00% |   100.00% |   100.00% |
| Hybrid   |      0.00 |  100.00% |   100.00% |   100.00% |
| Hybrid   |      0.10 |   95.45% |    95.45% |    95.45% |
| Hybrid   |      0.20 |   90.91% |    90.91% |    90.91% |

The remaining topK=3, threshold=0.20 failures are candidate-generation
failures, not ranking failures. Both relevant chunks rank first in the broad
vector list but have similarities below 0.20. The MFA chunk has one of three
lexical query terms and is removed by the two-term guard. The proof-of-purchase
chunk has two of five terms, but the Phase 4E lexical query construction feeds
already-stemmed English lexemes through the English tsquery parser a second
time. That generic double-stemming bug rejects the lexical match before the
guard. Phase 4E records the bug without changing retrieval behavior.

Because relaxed candidate recall is already 100%, a reranker cannot address
the current misses at the selected threshold: the chunks never reach it. Fixing
the generic lexical query construction and evaluating query expansion or
threshold calibration should precede reranking experiments.

## Phase 4F lexical candidate fix

Phase 4F fixes the generic double-stemming bug without changing the lexical
guard, production strategy, or production defaults. Query text is still
normalized once with PostgreSQL's English text-search configuration, but the
resulting lexemes are now assembled with the `simple` tsquery configuration so
they are not stemmed a second time.

The same corpus and benchmark grid produced these best balanced results at
topK=3 and threshold 0.20:

| Measurement | Hit Rate | Recall |    MRR | No-source accuracy | Balanced score | Failures |
| ----------- | -------: | -----: | -----: | -----------------: | -------------: | -------: |
| Before fix  |   90.91% | 90.91% | 0.9091 |            100.00% |         95.45% |        2 |
| After fix   |   95.45% | 95.45% | 0.9545 |            100.00% |         97.73% |        1 |

Proof-of-purchase is now admitted through its two genuine lexical matches. The
remaining direct MFA case has vector similarity 0.1697 and only one of three
lexical query terms, so the threshold and two-term guard still exclude it.

Threshold 0.10 achieves 100% positive recall and MRR, but returns a result for
the unsupported parental-leave question. Its no-source accuracy is 66.67% and
balanced score is 83.33%. Threshold 0.20 therefore remains the best measured
hybrid setting. The vector production default remains unchanged pending broader
evaluation beyond this synthetic corpus.

## Phase 4G live RAG evaluation

The RAG evaluation dataset adds reference answers for all 22 supported cases.
Reference answers are recorded for qualitative review; deterministic scoring
focuses on citations and unsupported-question behavior rather than attempting
to judge semantic answer equivalence automatically.

The live runner uses the existing `RetrievalService`, `QuestionsService`, and
`GenerationService`. Its JSON report keeps retrieval metrics separate from
generation metrics and records every generated answer, reference answer,
expected source, and returned citation.

Start and seed the isolated evaluation database, then explicitly authorize live
Anthropic calls with `--live`:

```bash
npm run test:integration:db:up
npm run eval:baseline:setup
npm run eval:rag:live -- --live --strategy hybrid --top-k 3 --threshold 0.20 --output evaluation-results/phase-4g-rag-live.json
npm run test:integration:db:down
```

The command refuses to run without `--live` or a usable
`ANTHROPIC_API_KEY`. It uses deterministic evaluation embeddings for the fixed
corpus, so Anthropic generation is the only provider call.

Citation precision counts returned citations matching the full expected source
label. Citation recall measures expected labels cited at least once. Source and
page correctness progressively check document identity and page identity for
each returned citation. No-source accuracy requires both the exact
insufficient-context response and zero citations. Unit and integration tests do
not call external providers.
