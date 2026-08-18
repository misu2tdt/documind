import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module';
import { RetrievalController } from './retrieval.controller';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [EmbeddingModule],
  controllers: [RetrievalController],
  providers: [RetrievalService],
})
export class RetrievalModule {}
