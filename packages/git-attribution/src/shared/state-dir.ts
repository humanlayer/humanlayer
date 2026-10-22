import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The machine-local HumanLayer state directory (`~/.humanlayer/riptide` unless RIPTIDE_STATE_DIR
 * overrides it, which tests and relocated installs do).
 *
 * Deliberately a LEAF module (node builtins only): it is read by BOTH the daemon (long-lived
 * process) and the CLI hook processes that Claude Code spawns per tool call, and those two must
 * agree on the path or the cross-process authorship journal (./git/authorship-journal) silently
 * splits into two stores that never meet.
 */
export function riptideStateDir(): string {
	return process.env.RIPTIDE_STATE_DIR || join(homedir(), '.humanlayer', 'riptide')
}

/**
 * Best-effort, last-writer-wins JSON breadcrumb in the state dir (atomic tmp+rename so readers
 * never see a torn file; every failure swallowed — a breadcrumb must never affect the work it
 * reports on). Shared by the capability cache and the attribution health/expired files.
 */
export async function writeStateBreadcrumb(fileName: string, payload: Record<string, unknown>): Promise<void> {
	try {
		const dir = riptideStateDir()
		await mkdir(dir, { recursive: true })
		const path = join(dir, fileName)
		const tmp = `${path}.write.${process.pid}`
		await writeFile(tmp, `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`)
		await rename(tmp, path)
	} catch {
		// best effort by contract
	}
}
