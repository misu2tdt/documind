import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EnvironmentVariables } from '../config/environment';
import { EmbeddingService } from '../embedding/embedding.service';
import { DocumentStatus } from '../documents/entities/document.entity';
import { RetrievalResultDto } from './dto/retrieval-result.dto';
import { RetrievalStrategy } from './retrieval-strategy';

interface RetrievalRow extends Omit<RetrievalResultDto, 'similarity'> {
  similarity: number | string;
}

interface RankedRetrievalRow extends RetrievalRow {
  rank: number | string;
}

const RRF_RANK_CONSTANT = 60;
const MINIMUM_HYBRID_CANDIDATES = 20;
const MAXIMUM_HYBRID_CANDIDATES = 100;

@Injectable()
export class RetrievalService {
  private readonly defaultTopK: number;
  private readonly minimumSimilarity: number;
  private readonly strategy: RetrievalStrategy;

  constructor(
    private readonly dataSource: DataSource,
    private readonly embeddingService: EmbeddingService,
    configService: ConfigService<EnvironmentVariables, true>,
  ) {
    this.defaultTopK = configService.get('RETRIEVAL_TOP_K', { infer: true });
    this.minimumSimilarity = configService.get('RETRIEVAL_MIN_SIMILARITY', {
      infer: true,
    });
    this.strategy = configService.get('RETRIEVAL_STRATEGY', { infer: true });
  }

  async search(
    query: string,
    topK = this.defaultTopK,
    documentId?: string,
  ): Promise<RetrievalResultDto[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      throw new BadRequestException('Query must not be empty');
    }
    if (!Number.isInteger(topK) || topK < 1 || topK > 100) {
      throw new BadRequestException(
        'topK must be an integer between 1 and 100',
      );
    }

    const queryEmbedding =
      await this.embeddingService.embedOne(normalizedQuery);
    if (this.strategy === 'hybrid') {
      return this.hybridSearch(
        normalizedQuery,
        queryEmbedding,
        topK,
        documentId,
      );
    }

    return this.vectorSearch(queryEmbedding, topK, documentId);
  }

  private async vectorSearch(
    queryEmbedding: number[],
    limit: number,
    documentId?: string,
  ): Promise<RetrievalResultDto[]> {
    const parameters: unknown[] = [
      JSON.stringify(queryEmbedding),
      limit,
      this.minimumSimilarity,
      DocumentStatus.COMPLETED,
    ];
    const documentFilter = documentId ? 'AND c.document_id = $5' : '';

    if (documentId) parameters.push(documentId);

    const rows = await this.dataSource.query<RetrievalRow[]>(
      `SELECT
         c.id AS "chunkId",
         c.document_id AS "documentId",
         d.filename AS "filename",
         c."pageNumber" AS "pageNumber",
         c.content AS "content",
         1 - (c.embedding <=> $1::vector) AS "similarity"
       FROM chunks c
       INNER JOIN documents d ON d.id = c.document_id
       WHERE c.embedding IS NOT NULL
         AND d.status = $4
         AND 1 - (c.embedding <=> $1::vector) >= $3
         ${documentFilter}
       ORDER BY c.embedding <=> $1::vector ASC, c.id ASC
       LIMIT $2`,
      parameters,
    );

    return rows.map((row) => ({
      ...row,
      similarity: Number(row.similarity),
    }));
  }

  private async hybridSearch(
    query: string,
    queryEmbedding: number[],
    topK: number,
    documentId?: string,
  ): Promise<RetrievalResultDto[]> {
    const candidateLimit = Math.min(
      Math.max(topK * 4, MINIMUM_HYBRID_CANDIDATES),
      MAXIMUM_HYBRID_CANDIDATES,
    );
    const [vectorRows, lexicalRows] = await Promise.all([
      this.vectorSearch(queryEmbedding, candidateLimit, documentId),
      this.lexicalSearch(query, queryEmbedding, candidateLimit, documentId),
    ]);

    return fuseRankings(vectorRows, lexicalRows).slice(0, topK);
  }

  private async lexicalSearch(
    query: string,
    queryEmbedding: number[],
    limit: number,
    documentId?: string,
  ): Promise<RetrievalResultDto[]> {
    const parameters: unknown[] = [
      query,
      limit,
      DocumentStatus.COMPLETED,
      JSON.stringify(queryEmbedding),
    ];
    const documentFilter = documentId ? 'AND c.document_id = $5' : '';
    if (documentId) parameters.push(documentId);

    const rows = await this.dataSource.query<RankedRetrievalRow[]>(
      `WITH lexical_terms AS (
         SELECT
           array_agg(lexeme ORDER BY lexeme) AS terms,
           string_agg(quote_literal(lexeme), ' | ' ORDER BY lexeme) AS expression
         FROM unnest(
           tsvector_to_array(to_tsvector('english', $1))
         ) AS lexeme
       ), lexical_query AS (
         SELECT
           terms,
           to_tsquery('simple', expression) AS query
         FROM lexical_terms
       )
       SELECT
         c.id AS "chunkId",
         c.document_id AS "documentId",
         d.filename AS "filename",
         c."pageNumber" AS "pageNumber",
         c.content AS "content",
         1 - (c.embedding <=> $4::vector) AS "similarity",
         ts_rank_cd(to_tsvector('english', c.content), lexical_query.query) AS "rank"
       FROM chunks c
       INNER JOIN documents d ON d.id = c.document_id
       CROSS JOIN lexical_query
       WHERE c.embedding IS NOT NULL
         AND d.status = $3
         AND lexical_query.query IS NOT NULL
         AND to_tsvector('english', c.content) @@ lexical_query.query
         AND (
           SELECT count(*)
           FROM unnest(
             tsvector_to_array(to_tsvector('english', c.content))
           ) AS content_lexeme
           WHERE content_lexeme = ANY(lexical_query.terms)
         ) >= LEAST(2, cardinality(lexical_query.terms))
         ${documentFilter}
       ORDER BY "rank" DESC, c.id ASC
       LIMIT $2`,
      parameters,
    );

    return rows.map((row) => ({
      chunkId: row.chunkId,
      documentId: row.documentId,
      filename: row.filename,
      pageNumber: row.pageNumber,
      content: row.content,
      similarity: Number(row.similarity),
    }));
  }
}

export function fuseRankings(
  vectorResults: RetrievalResultDto[],
  lexicalResults: RetrievalResultDto[],
): RetrievalResultDto[] {
  const fused = new Map<
    string,
    {
      result: RetrievalResultDto;
      score: number;
      vectorRank: number;
      lexicalRank: number;
    }
  >();

  const addRanking = (
    results: RetrievalResultDto[],
    ranking: 'vectorRank' | 'lexicalRank',
  ) => {
    results.forEach((result, index) => {
      const current = fused.get(result.chunkId) ?? {
        result,
        score: 0,
        vectorRank: Number.POSITIVE_INFINITY,
        lexicalRank: Number.POSITIVE_INFINITY,
      };
      const rank = index + 1;
      current.score += 1 / (RRF_RANK_CONSTANT + rank);
      current[ranking] = rank;
      if (ranking === 'vectorRank') current.result = result;
      fused.set(result.chunkId, current);
    });
  };

  addRanking(vectorResults, 'vectorRank');
  addRanking(lexicalResults, 'lexicalRank');

  return [...fused.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.lexicalRank - right.lexicalRank ||
        left.vectorRank - right.vectorRank ||
        left.result.chunkId.localeCompare(right.result.chunkId),
    )
    .map(({ result }) => result);
}
