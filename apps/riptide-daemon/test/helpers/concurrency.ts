import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDirLocks = new Set<string>()

export async function createUniqueTempDir(prefix: string): Promise<string> {
	return mkdtemp(join(tmpdir(), `${prefix}-`))
}

export function allocateTempDir(prefix: string): string {
	for (let attempt = 0; attempt < 1000; attempt++) {
		const candidate = join(tmpdir(), `${prefix}-${crypto.randomUUID().slice(0, 6)}`)
		if (!tempDirLocks.has(candidate)) {
			tempDirLocks.add(candidate)
			return candidate
		}
	}

	throw new Error(`Unable to allocate temp dir for prefix: ${prefix}`)
}

export function releaseTempDir(path: string): void {
	tempDirLocks.delete(path)
}

export function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
	const previous = new Map<string, string | undefined>()

	for (const [key, value] of Object.entries(overrides)) {
		previous.set(key, process.env[key])
		if (value === undefined) {
			delete process.env[key]
		} else {
			process.env[key] = value
		}
	}

	const restore = () => {
		for (const [key, value] of previous) {
			if (value === undefined) {
				delete process.env[key]
			} else {
				process.env[key] = value
			}
		}
	}

	return Promise.resolve().then(fn).finally(restore)
}
