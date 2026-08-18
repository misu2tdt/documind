import { Module } from '@nestjs/common';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { GenerationService } from './generation.service';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';

@Module({
  imports: [RetrievalModule],
  controllers: [QuestionsController],
  providers: [GenerationService, QuestionsService],
})
export class QuestionsModule {}
