import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'

import { afterEach, describe, expect, test } from 'vitest'

const leaseOnlyFixture = join(import.meta.dirname, '..', 'fixtures', 'instance-lock-signal-child.ts')
const SHORT_DEADLINE_MS = 300
const LONG_DEADLINE_MS = 10_000
const LOCK_RELEASE_BUDGET_MS = 1_000

type LockHolder = {
	readonly child: ChildProcessByStdio<null, Readable, Readable>
	readonly lockPath: string
	readonly exited: Promise<number | null>
}

const temporaryDirectories: string[] = []
const children: ChildProcessByStdio<null, Readable, Readable>[] = []

afterEach(async () => {
	for (const child of children.splice(0)) child.kill('SIGKILL')
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	)
})

const parseLockPathLine = (line: string): string | undefined => {
	try {
		const parsed: unknown = JSON.parse(line)
		if (typeof parsed !== 'object' || parsed === null || !('lockPath' in parsed)) return undefined
		return typeof parsed.lockPath === 'string' ? parsed.lockPath : undefined
	} catch {
		return undefined
	}
}

const startLockHolder = async (fixtureArgs: ReadonlyArray<string>, deadlineMs: number): Promise<LockHolder> => {
	const homeDirectory = await mkdtemp(join(tmpdir(), 'instance-lock-signal-'))
	temporaryDirectories.push(homeDirectory)
	const child = spawn('bun', [...fixtureArgs], {
		cwd: homeDirectory,
		env: {
			...process.env,
			HOME: homeDirectory,
			LOG_BASE: join(homeDirectory, 'logs'),
			LOG_LEVEL: '',
			SHUTDOWN_DEADLINE_MS: String(deadlineMs),
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	children.push(child)
	const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
	let stderr = ''
	child.stderr.on('data', (chunk: Buffer) => {
		stderr += chunk.toString()
	})
	const lockPath = await new Promise<string>((resolve, reject) => {
		createInterface({ input: child.stdout }).on('line', (line) => {
			const lockPathLine = parseLockPathLine(line)
			if (lockPathLine !== undefined) resolve(lockPathLine)
		})
		void exited.then((code) => reject(new Error(`Lock holder exited with ${code} before ready: ${stderr}`)))
	})
	expect(existsSync(lockPath)).toBe(true)
	return { child, lockPath, exited }
}

const exitWithin = async (exited: Promise<number | null>, budgetMs: number) => {
	const startedAt = performance.now()
	const code = await Promise.race([
		exited,
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Lock holder did not exit')), budgetMs)),
	])
	return { code, elapsedMs: performance.now() - startedAt }
}

describe('instance lock on signal-driven exit', () => {
	test('a SIGTERM before startup finishes disposes the runtime and releases the lock', async () => {
		const holder = await startLockHolder([leaseOnlyFixture, 'dispose-completes'], LONG_DEADLINE_MS)

		holder.child.kill('SIGTERM')
		const { code } = await exitWithin(holder.exited, LOCK_RELEASE_BUDGET_MS)

		expect(code).toBe(0)
		expect(existsSync(holder.lockPath)).toBe(false)
	})

	test('the forced exit at the shutdown deadline releases the lock when dispose hangs', async () => {
		const holder = await startLockHolder([leaseOnlyFixture, 'dispose-hangs'], SHORT_DEADLINE_MS)

		holder.child.kill('SIGTERM')
		const { code, elapsedMs } = await exitWithin(holder.exited, SHORT_DEADLINE_MS + LOCK_RELEASE_BUDGET_MS)

		expect(code).toBe(1)
		expect(elapsedMs).toBeGreaterThanOrEqual(SHORT_DEADLINE_MS - 50)
		expect(existsSync(holder.lockPath)).toBe(false)
	})

	test('the forced exit on a repeated SIGTERM releases the lock when dispose hangs', async () => {
		const holder = await startLockHolder([leaseOnlyFixture, 'dispose-hangs'], LONG_DEADLINE_MS)

		holder.child.kill('SIGTERM')
		await new Promise((resolve) => setTimeout(resolve, 50))
		holder.child.kill('SIGTERM')
		const { code } = await exitWithin(holder.exited, LOCK_RELEASE_BUDGET_MS)

		expect(code).toBe(1)
		expect(existsSync(holder.lockPath)).toBe(false)
	})
})
