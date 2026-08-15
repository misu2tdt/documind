import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Document } from './document.entity';

@Index('UQ_chunks_document_id_chunk_index', ['documentId', 'chunkIndex'], {
  unique: true,
})
@Index('IDX_chunks_embedding_hnsw_cosine', { synchronize: false })
@Entity('chunks')
export class Chunk {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Document, (doc) => doc.chunks, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'document_id',
    foreignKeyConstraintName: 'FK_chunks_document_id',
  })
  document!: Document;

  @Index('IDX_chunks_document_id')
  @Column({ name: 'document_id' })
  documentId!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'int' })
  pageNumber!: number;

  @Column({ type: 'int' })
  chunkIndex!: number;

  @Column({ type: 'int' })
  tokenCount!: number;

  @Column({ type: 'vector', length: 1536, nullable: true })
  embedding!: number[] | null;

  @CreateDateColumn()
  createdAt!: Date;
}
