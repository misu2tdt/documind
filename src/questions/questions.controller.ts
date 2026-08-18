import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { QuestionRequestDto } from './dto/question-request.dto';
import { QuestionResponseDto } from './dto/question-response.dto';
import { QuestionsService } from './questions.service';

@ApiTags('Questions')
@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @ApiOperation({
    summary: 'Answer a question from retrieved document context',
  })
  @ApiResponse({ status: 200, type: QuestionResponseDto })
  @Post()
  answer(@Body() request: QuestionRequestDto): Promise<QuestionResponseDto> {
    return this.questionsService.answer(
      request.question,
      request.topK,
      request.documentId,
    );
  }
}
