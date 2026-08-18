import { ApiProperty } from '@nestjs/swagger';

export class SourceCitationDto {
  @ApiProperty({ format: 'uuid' })
  documentId!: string;

  @ApiProperty({ example: 'handbook.pdf' })
  filename!: string;

  @ApiProperty({ example: 3 })
  pageNumber!: number;

  @ApiProperty({ format: 'uuid' })
  chunkId!: string;
}

export class QuestionResponseDto {
  @ApiProperty({ example: 'The retention period is seven years. [Source 1]' })
  answer!: string;

  @ApiProperty({ type: SourceCitationDto, isArray: true })
  citations!: SourceCitationDto[];
}
