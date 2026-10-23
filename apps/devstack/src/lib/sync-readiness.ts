export type SyncReadinessOptions = {
	timeoutMs?: number
	intervalMs?: number
	fetch?: typeof fetch
}

async function waitForEndpoint(url: string, service: string, options: SyncReadinessOptions): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 30_000
	const intervalMs = options.intervalMs ?? 500
	const fetchEndpoint = options.fetch ?? fetch
	const startedAt = Date.now()
	let lastErrorMessage: string | undefined

	while (Date.now() - startedAt < timeoutMs) {
		try {
			const response = await fetchEndpoint(url)
			if (response.ok || response.status === 202) return
			lastErrorMessage = `HTTP ${response.status}`
		} catch (error) {
			lastErrorMessage = error instanceof Error ? error.message : String(error)
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs))
	}

	throw new Error(`${service} did not become ready at ${url}: ${lastErrorMessage}`)
}

export function waitForElectric(port: number, options: SyncReadinessOptions = {}): Promise<void> {
	return waitForEndpoint(`http://127.0.0.1:${port}/v1/health`, 'Electric', options)
}

export function waitForElectricProxy(port: number, options: SyncReadinessOptions = {}): Promise<void> {
	return waitForEndpoint(`http://127.0.0.1:${port}/`, 'Electric proxy', options)
}

export function waitForDurableStreams(port: number, options: SyncReadinessOptions = {}): Promise<void> {
	return waitForEndpoint(`http://127.0.0.1:${port}/readyz`, 'Durable streams', options)
}
