import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RetrievalQueryDto } from './dto/retrieval-query.dto';
import { RetrievalResultDto } from './dto/retrieval-result.dto';
import { RetrievalService } from './retrieval.service';

@ApiTags('Retrieval')
@Controller('retrieval')
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @ApiOperation({ summary: 'Find document chunks relevant to a query' })
  @ApiResponse({ status: 200, type: RetrievalResultDto, isArray: true })
  @Post('search')
  search(@Body() request: RetrievalQueryDto): Promise<RetrievalResultDto[]> {
    return this.retrievalService.search(
      request.query,
      request.topK,
      request.documentId,
    );
  }
}
