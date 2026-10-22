import { sql } from 'drizzle-orm'
import { bigint, index, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { artifactComments } from './artifact-comments'

export const publicCommentUndoAuthorizations = pgTable(
	'public_comment_undo_authorizations',
	{
		comment_id: uuid('comment_id')
			.primaryKey()
			.references(() => artifactComments.id, { onDelete: 'cascade' }),
		token_digest: text('token_digest').notNull(),
		expires_at: bigint('expires_at', { mode: 'bigint' }).notNull(),
		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`),
	},
	(t) => [index('public_comment_undo_authorizations_expires_at_idx').on(t.expires_at)],
)
