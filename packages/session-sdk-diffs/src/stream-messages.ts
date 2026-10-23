// Messages for a task's durable diff streams, and how they are cut into request bodies.

export type DiffStreamType = 'task-diff-file' | 'task-diff-patch'
export type DiffOperation = 'upsert' | 'insert' | 'update' | 'delete'

/**
 * One durable-streams state message. A delete has no value; readers set value.id from the key.
 * `from` names the writer, e.g. 'riptide-daemon'.
 */
export function diffStreamMessage(
	type: DiffStreamType,
	key: string,
	operation: DiffOperation,
	timestamp: string,
	from: string,
	value?: unknown,
): string {
	const message: { type: DiffStreamType; key: string; value?: unknown; headers: object } = {
		type,
		key,
		headers: { operation, timestamp, from },
	}
	if (value !== undefined) message.value = value
	return JSON.stringify(message)
}

/** JSON array bodies of at most maxBytes each. A single larger message goes alone. */
export function messageBatches(messages: string[], maxBytes: number): string[] {
	const bodies: string[] = []
	let batch: string[] = []
	let bytes = 1 // "[" and "]", less the comma the first message doesn't need
	for (const msg of messages) {
		const size = Buffer.byteLength(msg) + 1
		if (batch.length > 0 && bytes + size > maxBytes) {
			bodies.push(`[${batch.join(',')}]`)
			batch = []
			bytes = 1
		}
		batch.push(msg)
		bytes += size
	}
	if (batch.length > 0) bodies.push(`[${batch.join(',')}]`)
	return bodies
}
