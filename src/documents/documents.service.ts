import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Document, DocumentStatus } from './entities/document.entity';
import { DocumentResponseDto } from './dto/document-response.dto';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    private configService: ConfigService,
  ) {}

  async uploadDocument(file: Express.Multer.File): Promise<DocumentResponseDto> {
    if (!file) {
      throw new BadRequestException('Không có file nào được gửi lên.');
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Chỉ chấp nhận file PDF.');
    }

    const uploadDir =
      this.configService.get<string>('UPLOAD_DIR') ?? './uploads';
    await fs.mkdir(uploadDir, { recursive: true });

    const storedName = `${randomUUID()}.pdf`;
    const storagePath = join(uploadDir, storedName);
    await fs.writeFile(storagePath, file.buffer);

    const document = this.documentRepository.create({
      filename: file.originalname,
      storagePath,
      fileSizeBytes: file.size,
      status: DocumentStatus.PENDING,
    });
    await this.documentRepository.save(document);

    return this.toResponseDto(document);
  }

  async getDocument(id: string): Promise<DocumentResponseDto> {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException('Không tìm thấy tài liệu này.');
    }
    return this.toResponseDto(document);
  }

  async listDocuments(page = 1, limit = 10) {
    const [documents, total] = await this.documentRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data: documents.map((doc) => this.toResponseDto(doc)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async deleteDocument(id: string): Promise<{ message: string }> {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException('Không tìm thấy tài liệu này.');
    }
    await fs.unlink(document.storagePath).catch(() => undefined);
    await this.documentRepository.remove(document);
    return { message: 'Đã xóa tài liệu và toàn bộ chunks liên quan.' };
  }

  private toResponseDto(document: Document): DocumentResponseDto {
    return {
      id: document.id,
      filename: document.filename,
      status: document.status,
      pageCount: document.pageCount,
      chunkCount: document.chunkCount,
      errorMessage: document.errorMessage,
      createdAt: document.createdAt,
    };
  }
}