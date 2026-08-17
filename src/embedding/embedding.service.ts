import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { EnvironmentVariables } from '../config/environment';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(
    private configService: ConfigService<EnvironmentVariables, true>,
  ) {
    this.client = new OpenAI({
      apiKey: this.configService.get('OPENAI_API_KEY', { infer: true }),
    });
    this.model = this.configService.get('EMBEDDING_MODEL', { infer: true });
    this.dimensions = this.configService.get('EMBEDDING_DIMENSIONS', {
      infer: true,
    });
  }

  async embedOne(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    let response: Awaited<ReturnType<OpenAI['embeddings']['create']>>;

    try {
      response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
        ...(this.supportsCustomDimensions() && {
          dimensions: this.dimensions,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Embedding provider failed for ${texts.length} inputs using ${this.model}: ${message}`,
      );
      throw new Error(`Embedding provider request failed: ${message}`, {
        cause: error,
      });
    }

    if (response.data.length !== texts.length) {
      throw this.invalidResponse(
        `returned ${response.data.length} vectors for ${texts.length} inputs`,
      );
    }

    const vectors = response.data.map((item) => item.embedding);
    vectors.forEach((vector, index) => {
      if (vector.length !== this.dimensions) {
        throw this.invalidResponse(
          `vector ${index} has ${vector.length} dimensions; expected ${this.dimensions}`,
        );
      }
    });

    return vectors;
  }

  private supportsCustomDimensions(): boolean {
    return this.model.startsWith('text-embedding-3');
  }

  private invalidResponse(details: string): Error {
    const message = `Invalid embedding provider response: ${details}`;
    this.logger.error(message);
    return new Error(message);
  }
}
