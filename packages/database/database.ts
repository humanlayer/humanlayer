import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('Missing Postgres connection string!')

export const db = drizzle(connectionString, { schema })
