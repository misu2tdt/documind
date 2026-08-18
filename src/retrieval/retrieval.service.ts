import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EnvironmentVariables } from '../config/environment';
import { EmbeddingService } from '../embedding/embedding.service';
import { RetrievalResultDto } from './dto/retrieval-result.dto';

interface RetrievalRow extends Omit<RetrievalResultDto, 'similarity'> {
  similarity: number | string;
}

@Injectable()
export class RetrievalService {
  private readonly defaultTopK: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly embeddingService: EmbeddingService,
    configService: ConfigService<EnvironmentVariables, true>,
  ) {
    this.defaultTopK = configService.get('RETRIEVAL_TOP_K', { infer: true });
  }

  async search(
    query: string,
    topK = this.defaultTopK,
    documentId?: string,
  ): Promise<RetrievalResultDto[]> {
    const queryEmbedding = await this.embeddingService.embedOne(query);
    const parameters: unknown[] = [JSON.stringify(queryEmbedding), topK];
    const documentFilter = documentId ? 'AND c.document_id = $3' : '';

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
