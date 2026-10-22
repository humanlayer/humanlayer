import { createHash, randomBytes } from 'node:crypto'

import type { RiptideClient } from '@humanlayer/riptide-api-contract/types/client'
import { RIPTIDE_CLIENTS } from '@humanlayer/riptide-api-contract/types/client'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

/**
 * Hashed, expiring, single-use OAuth install state for the class-based provider services
 * (Linear and Jira). This is the plain-async port of `slack.persistence.ts`'s Effect
 * version; the shape — 32 random bytes, SHA-256 at rest, one atomic `UPDATE ... RETURNING`
 * guarded on `consumed_at IS NULL AND expires_at > now` — is deliberately identical.
 *
 * Parameterized by table so every provider shares one implementation.
 */

/** Install links are valid for 7 days, matching Slack and GitHub. */
const INSTALL_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** The columns a provider's install-state table must expose for this module to work. */
export type InstallStateTable = PgTable & {
	state_token_hash: PgColumn
	organization_id: PgColumn
	requested_by_user_id: PgColumn
	return_client: PgColumn
	expires_at: PgColumn
	consumed_at: PgColumn
}

export type InstallStateDb = PostgresJsDatabase

export type InstallClaim = {
	organizationId: string
	requestedByUserId: string
	returnClient: RiptideClient
}

const hashState = (state: string): string => createHash('sha256').update(state).digest('hex')

/**
 * Falls back to `'cloud'` for an unrecognized value rather than failing the redirect,
 * following the billing checkout-completion parse.
 */
export function parseReturnClient(value: unknown): RiptideClient {
	return RIPTIDE_CLIENTS.includes(value as RiptideClient) ? (value as RiptideClient) : 'cloud'
}

/**
 * Mints a raw state token, stores only its SHA-256 hash, and returns the raw value for the
 * authorize URL. The row — not the browser's session — authorizes the later exchange.
 */
export async function createInstallState(
	db: InstallStateDb,
	table: InstallStateTable,
	input: { organizationId: string; requestedByUserId: string; returnClient: RiptideClient },
): Promise<{ state: string; expiresAt: number }> {
	const state = randomBytes(32).toString('base64url')
	const expiresAt = Date.now() + INSTALL_STATE_TTL_MS

	await db.insert(table).values({
		state_token_hash: hashState(state),
		organization_id: input.organizationId,
		requested_by_user_id: input.requestedByUserId,
		return_client: input.returnClient,
		expires_at: BigInt(expiresAt),
	} as never)

	return { state, expiresAt }
}

/**
 * Claims the state row in a single atomic statement. Returns `null` when the state is
 * unknown, already consumed, or expired — so a replayed callback is rejected before the
 * provider is ever called.
 */
export async function consumeInstallState(
	db: InstallStateDb,
	table: InstallStateTable,
	state: string,
): Promise<InstallClaim | null> {
	const now = BigInt(Date.now())
	const [claim] = (await db
		.update(table)
		.set({ consumed_at: now } as never)
		.where(and(eq(table.state_token_hash, hashState(state)), isNull(table.consumed_at), gt(table.expires_at, now)))
		.returning()) as {
		organization_id: string
		requested_by_user_id: string
		return_client: string
	}[]

	if (!claim) return null

	return {
		organizationId: claim.organization_id,
		requestedByUserId: claim.requested_by_user_id,
		returnClient: parseReturnClient(claim.return_client),
	}
}
