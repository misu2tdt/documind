import { Transform, Type } from 'class-transformer';
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

export class QuestionRequestDto {
  @ApiProperty({ example: 'What is the document retention policy?' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  question!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  topK?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Restrict context to one document',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;
}
