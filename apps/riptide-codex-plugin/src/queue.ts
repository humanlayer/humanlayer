// Web messages reach Codex through `codex queue --thread <id> --message <text>`, Codex's own way
// to hand a session a message. A session open in a Codex TUI runs it next: at once when idle,
// after the turn when busy. A closed session keeps it in Codex's queue until it is resumed.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { codexBin } from './config.ts'

const run = promisify(execFile)

/** The Codex binary this server runs under, when it is one: its parent process. */
async function parentCodex(): Promise<string | undefined> {
	try {
		const { stdout } = await run('ps', ['-o', 'comm=', '-p', String(process.ppid)], { timeout: 2000 })
		const path = stdout.trim()
		return /\/codex[^/]*$/.test(path) ? path : undefined
	} catch {
		return undefined
	}
}

let bin: Promise<string> | undefined

/** HUMANLAYER_CODEX_BIN, else CODEX_CLI_PATH, else the parent Codex, else `codex` on PATH. */
function codex(): Promise<string> {
	bin ??= (async () => {
		const set = codexBin()
		if (set !== 'codex') return set
		return (await parentCodex()) ?? 'codex'
	})()
	return bin
}

export type QueueMessage = (threadId: string, text: string) => Promise<void>

/** Queues text as the thread's next user message. Throws with Codex's own error. */
export const queueMessage: QueueMessage = async (threadId, text) => {
	try {
		await run(await codex(), ['queue', '--thread', threadId, '--message', text], {
			timeout: 30_000,
			maxBuffer: 1024 * 1024,
		})
	} catch (err) {
		const e = err as { stderr?: string; message?: string }
		throw new Error((e.stderr?.trim() || e.message || String(err)).split('\n').slice(-1)[0])
	}
}
