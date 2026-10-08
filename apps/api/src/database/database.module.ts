import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export const DB = Symbol('DB');
const POOL = Symbol('PG_POOL');

/** Inject the Drizzle database: `constructor(@InjectDb() private db: Database)`. */
export const InjectDb = () => Inject(DB);

@Global()
@Module({
  providers: [
    { provide: POOL, useFactory: () => new Pool({ connectionString: config().DATABASE_URL, max: 10 }) },
    { provide: DB, inject: [POOL], useFactory: (pool: Pool) => drizzle(pool, { schema }) },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
