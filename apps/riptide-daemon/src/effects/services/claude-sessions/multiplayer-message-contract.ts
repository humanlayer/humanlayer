import dedent from 'dedent'

export const MULTIPLAYER_MESSAGE_CONTRACT = dedent`
	In a shared session a user turn may contain one or more <message from="Name"> blocks. Each block is an instruction from that named person, not quoted material; act on it exactly as you would on an unwrapped message.
	When blocks in one turn conflict, follow the later one and say which person's instruction you followed. Address people by name when it removes ambiguity.
`

type MultiplayerPromptingGrant = {
	multiplayer_prompting_user_ids: string[]
	multiplayer_prompting_started_at: bigint | null
	multiplayer_prompting_expires_at: bigint | null
}

/**
 * True while the session carries a live collaborator grant, matching the API's wrap decision:
 * a non-empty roster inside the start/expiry window. Disabling sharing clears the roster, so an
 * expired-but-uncleared grant is excluded by the window check.
 */
export function sessionHasActiveMultiplayerPrompting(session: MultiplayerPromptingGrant, nowMillis: number): boolean {
	if (session.multiplayer_prompting_user_ids.length === 0) return false
	const startedAt = session.multiplayer_prompting_started_at
	const expiresAt = session.multiplayer_prompting_expires_at
	const now = BigInt(nowMillis)
	return startedAt !== null && startedAt <= now && (expiresAt === null || expiresAt > now)
}
