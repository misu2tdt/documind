import { Injectable } from '@nestjs/common';
import { RetrievalResultDto } from '../retrieval/dto/retrieval-result.dto';
import { RetrievalService } from '../retrieval/retrieval.service';
import { QuestionResponseDto } from './dto/question-response.dto';
import { GenerationService } from './generation.service';
import { INSUFFICIENT_CONTEXT_ANSWER } from './questions.constants';

@Injectable()
export class QuestionsService {
  constructor(
    private readonly retrievalService: RetrievalService,
    private readonly generationService: GenerationService,
  ) {}

  async answer(
    question: string,
    topK?: number,
    documentId?: string,
  ): Promise<QuestionResponseDto> {
    const normalizedQuestion = question.trim();
    const retrieved = await this.retrievalService.search(
      normalizedQuestion,
      topK,
      documentId,
    );
    const sources = this.uniqueUsefulSources(retrieved);

    if (sources.length === 0) {
      return { answer: INSUFFICIENT_CONTEXT_ANSWER, citations: [] };
    }

    const answer = await this.generationService.generate(
      normalizedQuestion,
      sources,
    );
    if (answer === INSUFFICIENT_CONTEXT_ANSWER) {
      return { answer, citations: [] };
    }

    return {
      answer,
      citations: sources.map(
        ({ documentId, filename, pageNumber, chunkId }) => ({
          documentId,
          filename,
          pageNumber,
          chunkId,
        }),
      ),
    };
  }

  private uniqueUsefulSources(
    retrieved: RetrievalResultDto[],
  ): RetrievalResultDto[] {
    const unique = new Map<string, RetrievalResultDto>();
    for (const source of retrieved) {
      if (source.content.trim().length > 0 && !unique.has(source.chunkId)) {
        unique.set(source.chunkId, source);
      }
    }
    return [...unique.values()];
  }
}
