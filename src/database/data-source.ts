import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Document } from '../documents/entities/document.entity';
import { Chunk } from '../documents/entities/chunk.entity';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: [Document, Chunk],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  installExtensions: false,
});
