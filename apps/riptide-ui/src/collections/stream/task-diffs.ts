import { DurableStream } from '@durable-streams/client'
import { createStateSchema, createStreamDB } from '@durable-streams/state/db'
import { DURABLE_STREAM_READ_BACKOFF_OPTIONS, STREAM_CONFIG } from '@humanlayer/streams/config'
import {
	TaskDiffFileBaselineRowStandardSchema,
	TaskDiffFileRowStandardSchema,
	TaskDiffFileVersionRowStandardSchema,
} from '@humanlayer/streams/diff'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'

export const taskDiffFilesStateSchema = createStateSchema({
	files: {
		schema: TaskDiffFileRowStandardSchema,
		type: 'task-diff-file',
		primaryKey: 'id',
	},
})

export type TaskDiffFilesStateSchema = typeof taskDiffFilesStateSchema
export type TaskDiffFilesStreamDB = ReturnType<typeof createStreamDB<TaskDiffFilesStateSchema>>

/** One `diff-file-versions` stream carries both row types in publication order. */
export const taskDiffVersionsStateSchema = createStateSchema({
	baselines: {
		schema: TaskDiffFileBaselineRowStandardSchema,
		type: 'task-diff-file-baseline',
		primaryKey: 'id',
	},
	versions: {
		schema: TaskDiffFileVersionRowStandardSchema,
		type: 'task-diff-file-version',
		primaryKey: 'id',
	},
})

export type TaskDiffVersionsStateSchema = typeof taskDiffVersionsStateSchema
export type TaskDiffVersionsStreamDB = ReturnType<typeof createStreamDB<TaskDiffVersionsStateSchema>>

export interface TaskDiffDatabases {
	files: TaskDiffFilesStreamDB | null
	/** Opened only once the probe finds the `diff-file-versions` stream. */
	versions: TaskDiffVersionsStreamDB | null
}

/**
 * Which payload generation the task's daemon writes.
 * - `versions`: complete bodies in `diff-file-versions`.
 * - `update-required`: only the retired `diff-patches` stream exists; the daemon must update.
 * - `none`: no capture yet.
 */
export type TaskDiffProtocol = 'versions' | 'update-required' | 'none'

type TaskDiffStreamName = 'diff-files' | 'diff-patches' | 'diff-file-versions'

interface TaskDiffStreamLocation {
	taskId: string
	organizationId: string
	getAccessToken: () => Promise<string | null>
}

function streamOptions({ taskId, organizationId, getAccessToken }: TaskDiffStreamLocation, stream: TaskDiffStreamName) {
	return {
		url: `${VITE_PUBLIC_SYNC_ORIGIN}/v2/streams/organizations/${organizationId}/tasks/${taskId}/${stream}`,
		contentType: STREAM_CONFIG.contentType,
		backoffOptions: DURABLE_STREAM_READ_BACKOFF_OPTIONS,
		headers: {
			Authorization: async () => `Bearer ${await getAccessToken()}`,
		},
	}
}

export function createTaskDiffFilesDatabase(location: TaskDiffStreamLocation): TaskDiffFilesStreamDB {
	return createStreamDB({
		streamOptions: streamOptions(location, 'diff-files'),
		live: 'sse',
		state: taskDiffFilesStateSchema,
	})
}

export function createTaskDiffVersionsDatabase(location: TaskDiffStreamLocation): TaskDiffVersionsStreamDB {
	return createStreamDB({
		streamOptions: streamOptions(location, 'diff-file-versions'),
		live: 'sse',
		state: taskDiffVersionsStateSchema,
	})
}

/**
 * HEADs both payload streams. The new stream wins when both exist; the old one alone means the
 * daemon predates complete file versions. A failed request rejects rather than guessing.
 */
export async function probeTaskDiffProtocol(location: TaskDiffStreamLocation): Promise<TaskDiffProtocol> {
	const [versions, patches] = await Promise.all([
		DurableStream.head(streamOptions(location, 'diff-file-versions')),
		DurableStream.head(streamOptions(location, 'diff-patches')),
	])
	if (versions.exists) return 'versions'
	return patches.exists ? 'update-required' : 'none'
}
