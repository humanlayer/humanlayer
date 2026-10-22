import { artifactComments as commentRows } from '@humanlayer/db/tables/artifact-comments'
import { and, asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { PostgresDb } from '../postgres/postgres-db.service'
import {
	decodeArtifactCommentInput,
	findTaskArtifactByFilename,
	narrowArtifactCommentDatabaseErrors,
	projectArtifactCommentRows,
	requireTaskReadPermissionForArtifactComment,
	selectVisibleArtifactCommentRowsInThreadOrder,
} from './artifact-comments-persistence'
import { ListArtifactCommentsInput } from './artifact-comments-types'

const listArtifactCommentRows = Effect.fn('artifact_comments.list_rows')(function* (input: ListArtifactCommentsInput) {
	const postgres = yield* PostgresDb
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				yield* requireTaskReadPermissionForArtifactComment(tx, input, 'Task not found')
				const found = yield* findTaskArtifactByFilename(
					tx,
					input.taskId,
					input.artifactFilename,
					input.userInfo.organizationId,
				)
				const rows = yield* tx.query(
					tx.client
						.select()
						.from(commentRows)
						.where(and(eq(commentRows.artifact_id, found.id), eq(commentRows.is_deleted, false)))
						.orderBy(asc(commentRows.created_at)),
				)
				return selectVisibleArtifactCommentRowsInThreadOrder(rows, input.includeResolved)
			}),
		)
		.pipe(narrowArtifactCommentDatabaseErrors)
})

/** Lists readable artifact threads and converts persisted rows into display-ready comments. */
export const listArtifactComments = Effect.fn('artifact_comments.list')(function* (rawInput: unknown) {
	const input = yield* decodeArtifactCommentInput(ListArtifactCommentsInput, rawInput)
	return yield* projectArtifactCommentRows(input.artifactFilename, yield* listArtifactCommentRows(input))
})
