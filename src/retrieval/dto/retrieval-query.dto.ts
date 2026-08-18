import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RetrievalQueryDto {
  @ApiProperty({ example: 'How does document ingestion work?' })
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  topK?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Restrict results to one document',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;
}
