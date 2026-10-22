import { createStateSchema, createStreamDB } from '@durable-streams/state/db'
import { DURABLE_STREAM_READ_BACKOFF_OPTIONS, STREAM_CONFIG } from '@humanlayer/streams/config'
import {
	CheckRowStandardSchema,
	PR_STATUS_CHECK_TYPE,
	PR_STATUS_META_TYPE,
	PullRequestRowStandardSchema,
} from '@humanlayer/streams/pr-status'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'

export const prStatusStateSchema = createStateSchema({
	pullRequest: {
		schema: PullRequestRowStandardSchema,
		type: PR_STATUS_META_TYPE,
		primaryKey: 'id',
	},
	checks: {
		schema: CheckRowStandardSchema,
		type: PR_STATUS_CHECK_TYPE,
		primaryKey: 'id',
	},
})

export type PrStatusStateSchema = typeof prStatusStateSchema
export type PrStatusStreamDB = ReturnType<typeof createStreamDB<PrStatusStateSchema>>

export function createPrStatusStreamDB(input: {
	streamPath: string
	getAccessToken: () => Promise<string | null>
}): PrStatusStreamDB {
	return createStreamDB({
		streamOptions: {
			url: `${VITE_PUBLIC_SYNC_ORIGIN}/v2/streams${input.streamPath}`,
			contentType: STREAM_CONFIG.contentType,
			headers: {
				Authorization: async () => `Bearer ${await input.getAccessToken()}`,
			},
			backoffOptions: DURABLE_STREAM_READ_BACKOFF_OPTIONS,
		},
		live: 'sse',
		state: prStatusStateSchema,
	})
}
