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

    const generation = await this.generationService.generate(
      normalizedQuestion,
      sources,
    );
    if (generation.answer === INSUFFICIENT_CONTEXT_ANSWER) {
      return { answer: generation.answer, citations: [] };
    }

    return {
      answer: generation.answer,
      citations: this.citationsFromAnswer(
        generation.answer,
        generation.sources,
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

  private citationsFromAnswer(
    answer: string,
    sources: RetrievalResultDto[],
  ): QuestionResponseDto['citations'] {
    const citations: QuestionResponseDto['citations'] = [];
    const seen = new Set<number>();

    for (const match of answer.matchAll(/\[Source\s+(\d+)\]/g)) {
      const sourceIndex = Number(match[1]) - 1;
      if (
        !Number.isSafeInteger(sourceIndex) ||
        sourceIndex < 0 ||
        sourceIndex >= sources.length ||
        seen.has(sourceIndex)
      ) {
        continue;
      }

      seen.add(sourceIndex);
      const { documentId, filename, pageNumber, chunkId } =
        sources[sourceIndex];
      citations.push({ documentId, filename, pageNumber, chunkId });
    }

    return citations;
  }
}
