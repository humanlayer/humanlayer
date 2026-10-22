import * as z from 'zod'

/**
 * The ONE definition of what counts as a session id, for every module in this package.
 *
 * Session ids are UUIDs, and the recordObserved contract validates them with z.uuid() — so that
 * schema IS the definition here, same lib, no hand-rolled regex to drift out of sync. The gate
 * must never be looser than the contract: one bad id reaching the server rejects the ENTIRE
 * recordObserved batch at input validation — before the server's downgrade path can run — and
 * wedges that repo's watermark loop forever (the failure class the 2026-07-10 incident fix
 * closes). It must not be tighter either, or real sessions silently lose attribution.
 *
 * A UUID is also inherently a safe single path segment, which is what the authorship journal
 * needs before a session id may name a file on disk.
 */
const UUID_SCHEMA = z.uuid()

export function isSessionId(value: string): boolean {
	return UUID_SCHEMA.safeParse(value).success
}
