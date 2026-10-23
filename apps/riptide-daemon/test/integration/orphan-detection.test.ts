import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'

import { describe, expect, test } from 'vitest'

import { ORPHAN_CHECK_INTERVAL_MS } from '../../src/lib/orphan-detection'

const CI = !!process.env.CI
const ORPHAN_TIMEOUT_MS = ORPHAN_CHECK_INTERVAL_MS + 3000

async function readFirstLine(stream: NodeJS.ReadableStream): Promise<string> {
	return new Promise((resolve) => {
		let output = ''
		stream.setEncoding('utf-8')
		stream.on('data', (chunk) => {
			output += chunk
			if (output.includes('\n')) resolve(output.split('\n')[0] ?? '')
		})
		stream.on('end', () => resolve(output.split('\n')[0] ?? ''))
	})
}

async function waitForFileContent(filePath: string, expected: string, timeoutMs: number) {
	const startedAt = Date.now()

	while (Date.now() - startedAt < timeoutMs) {
		const contents = await readFile(filePath, 'utf8').catch(() => '')
		if (contents === expected) {
			return
		}

		await setTimeout(100)
	}

	const contents = await readFile(filePath, 'utf8').catch(() => '')
	expect(contents).toBe(expected)
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
	const startedAt = Date.now()

	while (Date.now() - startedAt < timeoutMs) {
		try {
			process.kill(pid, 0)
		} catch {
			return true
		}

		await setTimeout(100)
	}

	return false
}

async function killIfRunning(pid: number) {
	try {
		process.kill(pid, 'SIGKILL')
	} catch {
		return
	}

	await waitForProcessExit(pid, 1000)
}

async function spawnChildThroughParent(options: { orphanDetectionEnabled: boolean }) {
	const dir = await mkdtemp(join(tmpdir(), 'riptide-orphan-'))
	const readyMarker = join(dir, 'ready.txt')
	const orphanedMarker = join(dir, 'orphaned.txt')
	const escapedReadyMarker = JSON.stringify(readyMarker)
	const escapedOrphanedMarker = JSON.stringify(orphanedMarker)
	const childScript = `
		import { writeFileSync } from 'node:fs'
		import { startOrphanDetection } from './src/lib/orphan-detection'

		if (process.env.RIPTIDE_DAEMON_USE_ORPHAN_DETECTION === '1') {
			startOrphanDetection(() => {
				writeFileSync(${escapedOrphanedMarker}, 'orphaned')
				process.exit(0)
			})
		}

		writeFileSync(${escapedReadyMarker}, 'ready')
		setInterval(() => {}, 1000)
	`
	const parentScript = `
		const { spawn } = await import('node:child_process')
		const child = spawn('bun', ['--eval', ${JSON.stringify(childScript)}], {
			cwd: ${JSON.stringify(process.cwd())},
			stdio: ['ignore', 'ignore', 'ignore'],
			env: {
				...process.env,
				RIPTIDE_DAEMON_USE_ORPHAN_DETECTION: ${JSON.stringify(options.orphanDetectionEnabled ? '1' : undefined)},
			},
		})

		console.log(child.pid)
		setInterval(() => {}, 1000)
	`

	const parent = spawn('bun', ['--eval', parentScript])
	const childPidText = await readFirstLine(parent.stdout)
	const childPid = Number(childPidText.trim())
	expect(childPidText.trim()).toMatch(/^\d+$/)
	await waitForFileContent(readyMarker, 'ready', 3000)

	return { childPid, orphanedMarker, parent }
}

async function waitForChildProcessExit(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return
	await new Promise<void>((resolve) => child.once('close', () => resolve()))
}

describe('orphan detection integration', () => {
	test.skipIf(CI)(
		'opted-in child exits when parent process dies',
		async () => {
			const { orphanedMarker, parent } = await spawnChildThroughParent({ orphanDetectionEnabled: true })

			parent.kill('SIGKILL')
			await waitForChildProcessExit(parent)

			await waitForFileContent(orphanedMarker, 'orphaned', ORPHAN_TIMEOUT_MS)
		},
		ORPHAN_CHECK_INTERVAL_MS + 5000,
	)

	test(
		'non-opted-in child stays alive when parent process dies',
		async () => {
			const { childPid, orphanedMarker, parent } = await spawnChildThroughParent({
				orphanDetectionEnabled: false,
			})

			try {
				parent.kill('SIGKILL')
				await waitForChildProcessExit(parent)

				await setTimeout(ORPHAN_TIMEOUT_MS)
				expect(await readFile(orphanedMarker, 'utf8').catch(() => '')).toBe('')
				expect(await waitForProcessExit(childPid, 100)).toBe(false)
			} finally {
				await killIfRunning(childPid)
			}
		},
		ORPHAN_CHECK_INTERVAL_MS + 5000,
	)
})
