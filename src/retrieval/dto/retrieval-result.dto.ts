import { ApiProperty } from '@nestjs/swagger';

export class RetrievalResultDto {
  @ApiProperty({ format: 'uuid' })
  chunkId!: string;

  @ApiProperty({ format: 'uuid' })
  documentId!: string;

  @ApiProperty({ example: 'handbook.pdf' })
  filename!: string;

  @ApiProperty({ example: 3 })
  pageNumber!: number;

  @ApiProperty({ example: 'Relevant document text' })
  content!: string;

  @ApiProperty({ example: 0.91 })
  similarity!: number;
}
