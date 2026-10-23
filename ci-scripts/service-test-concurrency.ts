// Keep the production default at 3: higher concurrency has caused Bun segfaults.
export function serviceTestConcurrency(value: string | undefined): number {
	if (value === undefined) return 3
	if (!/^[1-6]$/.test(value)) {
		throw new Error('SERVICE_TEST_CONCURRENCY must be an integer from 1 to 6')
	}
	return Number(value)
}
