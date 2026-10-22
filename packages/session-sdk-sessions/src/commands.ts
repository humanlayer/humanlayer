// What a change to a session row asks of the host running it. The web app never calls a host:
// it writes the row (a reply sets `prompt` and moves it to `resuming`, a stop moves it to
// `interrupt_requested`), and each host follows its sessions' rows and acts on these changes.

/** The session columns these rules read. */
export interface SessionRow {
	id: string
	status: string
	prompt?: string | null
}

/** A row change as a sync client reports it: the row after the change, and before it for an update. */
export interface SessionRowChange<Row extends SessionRow = SessionRow> {
	type: 'insert' | 'update' | 'delete'
	value: Row
	previousValue?: Partial<Row>
}

/**
 * - `continue`: run `prompt` as the session's next turn. `lost-resume` when the row came back
 *   from `lost`, so the host may replace work the database already declared stale.
 * - `interrupt`: stop the running turn.
 */
export type SessionCommand =
	| { kind: 'continue'; sessionId: string; prompt: string | null; resume: 'ordinary' | 'lost-resume' }
	| { kind: 'interrupt'; sessionId: string }

/**
 * The command a change carries, if any. Only a move into `resuming` or `interrupt_requested`
 * counts; a row already there is old news. An insert already in `resuming` has no prior row, so
 * it is an ordinary continuation.
 */
export function sessionCommand(change: SessionRowChange): SessionCommand | undefined {
	if (change.type === 'delete') return undefined
	const { value, previousValue } = change
	const moved = change.type === 'insert' || previousValue?.status !== value.status
	if (!moved) return undefined
	if (value.status === 'resuming') {
		const resume = change.type === 'update' && previousValue?.status === 'lost' ? 'lost-resume' : 'ordinary'
		return { kind: 'continue', sessionId: value.id, prompt: value.prompt ?? null, resume }
	}
	if (value.status === 'interrupt_requested') return { kind: 'interrupt', sessionId: value.id }
	return undefined
}
