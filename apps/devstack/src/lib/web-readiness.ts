const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_INTERVAL_MS = 250

export async function waitForWebRoute(
	url: string,
	options: { timeoutMs?: number; intervalMs?: number; fetch?: typeof fetch } = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
	const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
	const fetchRoute = options.fetch ?? fetch
	const startedAt = Date.now()
	let lastErrorMessage: string | undefined

	while (Date.now() - startedAt < timeoutMs) {
		try {
			const response = await fetchRoute(url)
			if (response.ok) return
			lastErrorMessage = `HTTP ${response.status}`
		} catch (error) {
			lastErrorMessage = error instanceof Error ? error.message : undefined
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs))
	}

	const detail = lastErrorMessage === undefined ? '' : `: ${lastErrorMessage}`
	throw new Error(`Timed out waiting for browser route ${url}${detail}`)
}
