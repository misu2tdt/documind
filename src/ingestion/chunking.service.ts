import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/environment';

export interface TextChunk {
  content: string;
  pageNumber: number;
  chunkIndex: number;
  tokenCount: number;
}

export interface PageText {
  pageNumber: number;
  text: string;
}

@Injectable()
export class ChunkingService {
  private readonly chunkSizeTokens: number;
  private readonly overlapPercent: number;

  constructor(
    private configService: ConfigService<EnvironmentVariables, true>,
  ) {
    this.chunkSizeTokens = this.configService.get('CHUNK_SIZE_TOKENS', {
      infer: true,
    });
    this.overlapPercent = this.configService.get('CHUNK_OVERLAP_PERCENT', {
      infer: true,
    });
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  chunkPages(pages: PageText[]): TextChunk[] {
    const chunks: TextChunk[] = [];
    let globalIndex = 0;

    for (const page of pages) {
      const pageChunks = this.chunkText(page.text);
      for (const content of pageChunks) {
        chunks.push({
          content,
          pageNumber: page.pageNumber,
          chunkIndex: globalIndex++,
          tokenCount: this.estimateTokens(content),
        });
      }
    }

    return chunks;
  }

  private chunkText(text: string): string[] {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];

    const charsPerChunk = this.chunkSizeTokens * 4;
    const overlapChars = Math.floor(
      charsPerChunk * (this.overlapPercent / 100),
    );

    const sentences = cleaned.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if (
        current.length + sentence.length > charsPerChunk &&
        current.length > 0
      ) {
        chunks.push(current.trim());
        const tail = current.slice(-overlapChars);
        current = tail + ' ' + sentence;
      } else {
        current += (current ? ' ' : '') + sentence;
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks;
  }
}
