import {
	bigint,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'
import { bytea } from '../columns/bytea'

export const thoughtsDocuments = pgTable('thoughts_documents', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => `thd_${uuidv7()}`),
	filePath: text('file_path').notNull(),
	title: text('title').notNull(),
	createdAt: bigint('created_at', { mode: 'number' }).$defaultFn(() =>
		Date.now(),
	),
	organizationId: text('organization_id').notNull(), // NOTE there is no FK here for testing but there should be
})

export const thoughtsDocumentsOperations = pgTable(
	'thoughts_documents_operations',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => `thop_${uuidv7()}`),
		thoughtsDocumentId: text('thoughts_document_id').references(
			() => thoughtsDocuments.id,
			{ onDelete: 'cascade' },
		),
		operation: bytea('op').notNull(),
	},
)

export const ydocAwareness = pgTable(
	'ydoc_awareness',
	{
		clientId: text('client_id'),
		thoughtsDocumentId: text('thoughts_document_id')
			.references(() => thoughtsDocuments.id, { onDelete: 'cascade' })
			.notNull(),
		op: bytea('op').notNull(),
		updatedAt: timestamp('updated_at').defaultNow(), // normally we like integer timestamp but this way the DB calculates instead of the client code
	},
	(t) => [primaryKey({ columns: [t.clientId, t.thoughtsDocumentId] })], // compound primary key
)
