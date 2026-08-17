import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { EnvironmentVariables } from '../config/environment';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    private configService: ConfigService<EnvironmentVariables, true>,
  ) {
    this.client = new OpenAI({
      apiKey: this.configService.get('OPENAI_API_KEY', { infer: true }),
    });
    this.model = this.configService.get('EMBEDDING_MODEL', { infer: true });
  }

  async embedOne(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });

    return response.data.map((item) => item.embedding);
  }
}
