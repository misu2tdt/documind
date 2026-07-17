import { ApiProperty } from '@nestjs/swagger';
import { DocumentStatus } from '../entities/document.entity';

export class DocumentResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id!: string;

  @ApiProperty({ example: 'handbook.pdf' })
  filename!: string;

  @ApiProperty({ enum: DocumentStatus })
  status!: DocumentStatus;

  @ApiProperty({ example: 0 })
  pageCount!: number;

  @ApiProperty({ example: 0 })
  chunkCount!: number;

  @ApiProperty({ example: null, nullable: true })
  errorMessage!: string | null;

  @ApiProperty()
  createdAt!: Date;
}