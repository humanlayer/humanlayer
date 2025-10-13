import { decimal, pgTable, serial, text } from 'drizzle-orm/pg-core'

export const scores = pgTable('scores', {
	id: serial('id').primaryKey(),
	name: text('name'),
	value: decimal('value'),
})
