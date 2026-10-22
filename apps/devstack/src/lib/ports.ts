import { createServer } from 'node:net'

const ALL_IPV4_INTERFACES = '0.0.0.0'

export const STACK_PORT_NAMES = [
	'ui',
	'cloud',
	'api',
	'electricProxy',
	'docs',
	'adminApi',
	'adminUi',
	'postgres',
	'electric',
	'rivetEngine',
	'rivetServices',
	'minioApi',
	'minioConsole',
	'tanstackDevtools',
	'testPostgres',
	'testElectric',
	'testRivetEngine',
	'testRivetServices',
] as const

export type StackPortName = (typeof STACK_PORT_NAMES)[number]
export type StackPorts = Record<StackPortName, number>

export async function isPortAvailable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer()
		server.unref()
		server.once('error', () => resolve(false))
		server.listen(port, ALL_IPV4_INTERFACES, () => server.close(() => resolve(true)))
	})
}

async function allocateAvailablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer()
		server.unref()
		server.once('error', reject)
		server.listen(0, ALL_IPV4_INTERFACES, () => {
			const address = server.address()
			if (!address || typeof address === 'string') {
				server.close(() => reject(new Error('Unable to allocate a local TCP port')))
				return
			}
			server.close((error) => (error ? reject(error) : resolve(address.port)))
		})
	})
}

async function isRangeAvailable(start: number, count: number, reservedPorts: ReadonlySet<number>): Promise<boolean> {
	for (let offset = 0; offset < count; offset += 1) {
		const port = start + offset
		if (reservedPorts.has(port) || !(await isPortAvailable(port))) return false
	}
	return true
}

export async function ensureContiguousPortRange(
	existing: readonly number[] | undefined,
	reservedPorts: ReadonlySet<number>,
	count = 6,
): Promise<number[]> {
	const first = existing?.[0]
	if (
		existing?.length === count &&
		existing.every((port, index) => index === 0 || port === (first ?? 0) + index) &&
		existing.every((port) => !reservedPorts.has(port))
	) {
		return [...existing]
	}

	for (let attempt = 0; attempt < 200; attempt += 1) {
		const candidate = 20_000 + Math.floor(Math.random() * 30_000)
		if (candidate + count > 65_535) continue
		if (await isRangeAvailable(candidate, count, reservedPorts)) {
			return Array.from({ length: count }, (_, index) => candidate + index)
		}
	}
	throw new Error(`Unable to allocate a contiguous range of ${count} local TCP ports`)
}

export async function ensureAvailablePort(
	existing: number | undefined,
	reservedPorts: ReadonlySet<number>,
): Promise<number> {
	if (existing && !reservedPorts.has(existing) && (await isPortAvailable(existing))) return existing
	let port = await allocateAvailablePort()
	while (reservedPorts.has(port)) port = await allocateAvailablePort()
	return port
}

export async function ensureStackPorts(
	existing: Partial<StackPorts> | undefined,
	reservedPorts: ReadonlySet<number>,
): Promise<StackPorts> {
	const result: Partial<StackPorts> = {}
	const allocated = new Set<number>()

	for (const name of STACK_PORT_NAMES) {
		const saved = existing?.[name]
		if (saved && !reservedPorts.has(saved) && !allocated.has(saved)) {
			result[name] = saved
			allocated.add(saved)
			continue
		}

		let port = await allocateAvailablePort()
		while (reservedPorts.has(port) || allocated.has(port)) port = await allocateAvailablePort()
		result[name] = port
		allocated.add(port)
	}

	return result as StackPorts
}
