const DEFAULT_MAX_RETRIES = 3

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
	if (error && typeof error === 'object') {
		const { code, status } = error as { code?: unknown; status?: unknown }
		if (code === 'NOT_FOUND' || status === 404) return false
	}

	return failureCount < DEFAULT_MAX_RETRIES
}
