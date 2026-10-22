import { Schema } from 'effect'

const TASK_DIFF_EVENT_TYPES = ['task-diff-file', 'task-diff-file-baseline', 'task-diff-file-version'] as const
type TaskDiffEventType = (typeof TASK_DIFF_EVENT_TYPES)[number]

export const TaskDiffChangeEnvelope = Schema.Struct({
	type: Schema.Literals(TASK_DIFF_EVENT_TYPES),
	key: Schema.String,
	value: Schema.optional(Schema.Unknown),
	headers: Schema.Struct({
		operation: Schema.Literals(['upsert', 'insert', 'update', 'delete']),
		timestamp: Schema.String,
		from: Schema.Literal('riptide-daemon'),
	}),
})

export const encodeDiffEnvelope = (
	type: TaskDiffEventType,
	key: string,
	operation: 'upsert' | 'insert' | 'update' | 'delete',
	timestamp: string,
	value?: unknown,
): string => {
	const envelope: {
		type: TaskDiffEventType
		key: string
		value?: unknown
		headers: {
			operation: 'upsert' | 'insert' | 'update' | 'delete'
			timestamp: string
			from: 'riptide-daemon'
		}
	} = {
		type,
		key,
		headers: { operation, timestamp, from: 'riptide-daemon' },
	}
	if (value !== undefined) envelope.value = value
	return JSON.stringify(Schema.decodeUnknownSync(TaskDiffChangeEnvelope)(envelope))
}
