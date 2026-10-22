/**
 * Epoch milliseconds for a `{ mode: 'bigint' }` timestamp column, which is how every table in this
 * package stores a moment. Absent input becomes null, so a nullable column reads as "no such
 * moment"; passing it to a NOT NULL column fails to typecheck rather than writing a placeholder.
 */
export function toEpochMs(millis: number): bigint
export function toEpochMs(millis: number | null | undefined): bigint | null
export function toEpochMs(millis: number | null | undefined): bigint | null {
	return millis == null ? null : BigInt(millis)
}
