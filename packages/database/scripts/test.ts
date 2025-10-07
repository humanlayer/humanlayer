import { db } from '../database'
import * as schema from '../schema'

const result = await db.select().from(schema.scores)
console.log('result:', result)
