import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Document } from '../documents/entities/document.entity';
import { Chunk } from '../documents/entities/chunk.entity';
import { validateDatabaseEnvironment } from '../config/environment';

const environment = validateDatabaseEnvironment(process.env);

export default new DataSource({
  type: 'postgres',
  host: environment.DB_HOST,
  port: environment.DB_PORT,
  username: environment.DB_USERNAME,
  password: environment.DB_PASSWORD,
  database: environment.DB_DATABASE,
  entities: [Document, Chunk],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  installExtensions: false,
});
