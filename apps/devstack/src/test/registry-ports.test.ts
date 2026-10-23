import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureStackPorts, isPortAvailable, STACK_PORT_NAMES } from '../lib/ports'
import { emptyRegistry, readRegistry, withRegistryLock, writeRegistry } from '../lib/registry'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(Boolean(process.env.CI))('port allocation', () => {
	it('allocates every named service and persists available saved ports', async () => {
		const first = await ensureStackPorts(undefined, new Set())
		expect(Object.keys(first)).toEqual(STACK_PORT_NAMES)
		expect(new Set(Object.values(first)).size).toBe(STACK_PORT_NAMES.length)
		await expect(ensureStackPorts(first, new Set())).resolves.toEqual(first)
	})

	it('does not allocate ports reserved by another registered stack', async () => {
		const first = await ensureStackPorts(undefined, new Set())
		const second = await ensureStackPorts(undefined, new Set(Object.values(first)))
		expect(Object.values(second).some((port) => Object.values(first).includes(port))).toBe(false)
	})

	it('keeps persisted ports while the owning stack is running', async () => {
		const first = await ensureStackPorts(undefined, new Set())
		const server = createServer()
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject)
			server.listen(first.postgres, '0.0.0.0', resolve)
		})
		try {
			await expect(ensureStackPorts(first, new Set())).resolves.toEqual(first)
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()))
			})
		}
	})

	it('rejects ports occupied on the host-wide Docker bind interface', async () => {
		const server = createServer()
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject)
			server.listen(0, '0.0.0.0', resolve)
		})
		try {
			const address = server.address()
			if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port')
			await expect(isPortAvailable(address.port)).resolves.toBe(false)
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()))
			})
		}
	})
})

describe.skipIf(Boolean(process.env.CI))('registry locking', () => {
	it('drops the obsolete selectedStackId field when reading legacy registry state', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'devstack-registry-legacy-test-'))
		temporaryDirectories.push(directory)
		const registryPath = join(directory, 'registry.json')
		await writeFile(registryPath, JSON.stringify({ version: 1, selectedStackId: 'legacy', stacks: {} }))

		await expect(readRegistry(registryPath)).resolves.toEqual(emptyRegistry())
	})

	it('serializes concurrent registry updates and writes valid JSON atomically', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'devstack-registry-test-'))
		temporaryDirectories.push(directory)
		const registryPath = join(directory, 'registry.json')
		await writeRegistry(registryPath, emptyRegistry())
		const order: string[] = []

		await Promise.all([
			withRegistryLock(registryPath, async () => {
				order.push('first-start')
				await new Promise((resolve) => setTimeout(resolve, 50))
				order.push('first-end')
			}),
			withRegistryLock(registryPath, async () => {
				order.push('second')
			}),
		])

		expect(order).toEqual(['first-start', 'first-end', 'second'])
		await expect(readRegistry(registryPath)).resolves.toEqual(emptyRegistry())
	})
})
