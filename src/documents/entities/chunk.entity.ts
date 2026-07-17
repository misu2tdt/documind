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

@Entity('chunks')
export class Chunk {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Document, (doc) => doc.chunks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document!: Document;

  @Index()
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

  @Column({
    type: 'varchar',
    nullable: true,
    transformer: {
      to: (value: number[] | null) => (value ? `[${value.join(',')}]` : null),
      from: (value: string | null) => (value ? JSON.parse(value) : null),
    },
  })
  embedding!: number[] | null;

  @CreateDateColumn()
  createdAt!: Date;
}