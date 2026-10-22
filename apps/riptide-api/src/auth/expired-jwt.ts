/**
 * True when `error` is jose's `JWTExpired` — the token's "exp" claim is in the past.
 *
 * These are expected and benign: tokens are meant to expire, and clients then
 * re-authenticate or refresh. We never want them in Sentry (they otherwise dominate
 * the project's error volume, e.g. RIPTIDE-API-D9), so the auth verifiers use this
 * to skip capture, and `instrument`'s `beforeSend` uses the same signal as a net.
 *
 * jose sets a stable `err.code = 'ERR_JWT_EXPIRED'` — a string literal that survives
 * bundling/minification (unlike the class name, which is why the same error fragments
 * into many Sentry issues per release). The message check is a defensive fallback.
 */
export function isExpiredJwtError(error: unknown): boolean {
	if (error !== null && typeof error === 'object') {
		const { code, message } = error as { code?: unknown; message?: unknown }
		if (code === 'ERR_JWT_EXPIRED') return true
		if (typeof message === 'string' && message.includes('"exp" claim timestamp check failed')) return true
	}
	return false
}
