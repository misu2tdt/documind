import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EnvironmentVariables } from '../config/environment';
import { EmbeddingService } from '../embedding/embedding.service';
import { DocumentStatus } from '../documents/entities/document.entity';
import { RetrievalResultDto } from './dto/retrieval-result.dto';

interface RetrievalRow extends Omit<RetrievalResultDto, 'similarity'> {
  similarity: number | string;
}

@Injectable()
export class RetrievalService {
  private readonly defaultTopK: number;
  private readonly minimumSimilarity: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly embeddingService: EmbeddingService,
    configService: ConfigService<EnvironmentVariables, true>,
  ) {
    this.defaultTopK = configService.get('RETRIEVAL_TOP_K', { infer: true });
    this.minimumSimilarity = configService.get('RETRIEVAL_MIN_SIMILARITY', {
      infer: true,
    });
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
    const parameters: unknown[] = [
      JSON.stringify(queryEmbedding),
      topK,
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
}
