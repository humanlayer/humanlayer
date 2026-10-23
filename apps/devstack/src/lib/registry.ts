import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type {
	ApiManifest,
	RivetManifest,
	ElectricManifest,
	MinioManifest,
	OrganizationSeedDefaults,
	PostgresManifest,
	RedisManifest,
	TestServicesManifest,
	WorkOSResourceState,
} from './manifest'
import type { StackPorts } from './ports'
import type { StackRoutes } from './routes'

export const REGISTRY_VERSION = 1

export type StackRecord = {
	id: string
	displayName: string
	worktreePath: string
	composeProject: string
	tauriSuffix: string
	nativeIcon?: string
	tabColor?: string
	ports: StackPorts
	routes: StackRoutes
	createdAt: string
	updatedAt: string
	workos?: WorkOSResourceState
	postgres: PostgresManifest
	api: ApiManifest
	electric: ElectricManifest
	rivet?: RivetManifest
	minio?: MinioManifest
	redis?: RedisManifest
	testServices?: TestServicesManifest
}

export type DevstackRegistry = {
	version: typeof REGISTRY_VERSION
	stacks: Record<string, StackRecord>
	defaults?: { organization?: OrganizationSeedDefaults }
}

export function deleteStack(
	registry: DevstackRegistry,
	stackId: string,
	options: { force?: boolean } = {},
): { registry: DevstackRegistry; removed: StackRecord | null } {
	const removed = registry.stacks[stackId]
	if (!removed) {
		if (options.force) return { registry, removed: null }
		throw new Error(`Stack "${stackId}" is not registered in this devstack registry`)
	}
	const { [stackId]: _removed, ...stacks } = registry.stacks
	return { registry: { ...registry, stacks }, removed }
}

export function fallbackStackForWorktree(registry: DevstackRegistry, worktreePath: string): StackRecord | null {
	return (
		Object.values(registry.stacks)
			.filter((stack) => stack.worktreePath === worktreePath)
			.sort(
				(left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
			)[0] ?? null
	)
}

export function emptyRegistry(): DevstackRegistry {
	return { version: REGISTRY_VERSION, stacks: {} }
}

export async function readRegistry(path: string): Promise<DevstackRegistry> {
	let contents: string
	try {
		contents = await readFile(path, 'utf8')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyRegistry()
		throw error
	}

	const value: unknown = JSON.parse(contents)
	if (!value || typeof value !== 'object') throw new Error(`Invalid devstack registry at ${path}`)
	const registry = value as Partial<DevstackRegistry>
	if (registry.version !== REGISTRY_VERSION || !registry.stacks || typeof registry.stacks !== 'object') {
		throw new Error(`Unsupported or malformed devstack registry at ${path}`)
	}
	return {
		version: REGISTRY_VERSION,
		stacks: registry.stacks,
		defaults: registry.defaults,
	}
}

export async function writeRegistry(path: string, registry: DevstackRegistry): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
	await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 })
	await rename(temporaryPath, path)
}

export type RegistryLockOptions = { timeoutMs?: number; retryMs?: number; staleMs?: number }

const inProcessRegistryLocks = new Map<string, Promise<void>>()

export async function withRegistryLock<T>(
	registryPath: string,
	operation: () => Promise<T>,
	options: RegistryLockOptions = {},
): Promise<T> {
	const previous = inProcessRegistryLocks.get(registryPath) ?? Promise.resolve()
	let release!: () => void
	const current = new Promise<void>((resolve) => {
		release = resolve
	})
	inProcessRegistryLocks.set(registryPath, current)
	await previous
	try {
		return await withFileRegistryLock(registryPath, operation, options)
	} finally {
		release()
		if (inProcessRegistryLocks.get(registryPath) === current) inProcessRegistryLocks.delete(registryPath)
	}
}

async function withFileRegistryLock<T>(
	registryPath: string,
	operation: () => Promise<T>,
	options: RegistryLockOptions,
): Promise<T> {
	const lockPath = `${registryPath}.lock`
	const timeoutMs = options.timeoutMs ?? 10_000
	const retryMs = options.retryMs ?? 25
	const staleMs = options.staleMs ?? 30_000
	const startedAt = Date.now()
	await mkdir(dirname(registryPath), { recursive: true })

	while (true) {
		try {
			const handle = await open(lockPath, 'wx', 0o600)
			await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
			await handle.close()
			break
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
			try {
				const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { createdAt?: string }
				if (lock.createdAt && Date.now() - Date.parse(lock.createdAt) > staleMs) {
					await rm(lockPath, { force: true })
					continue
				}
			} catch {
				// Another process may still be finishing the lock file write.
			}
			if (Date.now() - startedAt >= timeoutMs) throw new Error(`Timed out waiting for registry lock ${lockPath}`)
			await new Promise((resolve) => setTimeout(resolve, retryMs))
		}
	}

	try {
		return await operation()
	} finally {
		await rm(lockPath, { force: true })
	}
}
