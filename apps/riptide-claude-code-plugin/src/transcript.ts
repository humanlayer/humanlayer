// Reads a Claude Code session's transcript as it grows: the session's JSONL file, and one file per
// subagent beside it (`<session>/subagents/agent-<id>.jsonl`, with `agent-<id>.meta.json` naming
// the Agent call that ran it). Each file is read from a byte offset to its last whole line; a line
// still being written waits for the next read.

import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import type { Line } from './mapper.ts'

export interface ReadLine {
	line: Line
	/** The byte offset just after this line: where the next read of the file starts. */
	end: number
}

/** The whole lines of a file from offset on. A file that is gone or unreadable has none. */
export async function readLines(path: string, offset: number): Promise<ReadLine[]> {
	const handle = await open(path, 'r').catch(() => undefined)
	if (!handle) return []
	try {
		const { size } = await handle.stat()
		if (size <= offset) return []
		const buffer = Buffer.alloc(size - offset)
		await handle.read(buffer, 0, buffer.length, offset)
		const out: ReadLine[] = []
		let start = 0
		for (let i = 0; i < buffer.length; i++) {
			if (buffer[i] !== 0x0a) continue
			const text = buffer.subarray(start, i).toString('utf8')
			start = i + 1
			if (!text.trim()) continue
			try {
				out.push({ line: JSON.parse(text) as Line, end: offset + start })
			} catch {
				out.push({ line: {}, end: offset + start }) // a broken line is passed over, not read again
			}
		}
		return out
	} finally {
		await handle.close()
	}
}

/** A file's size now, or 0 when it is not there yet. */
export async function fileSize(path: string): Promise<number> {
	return (await stat(path).catch(() => undefined))?.size ?? 0
}

export interface SubagentFile {
	/** The file's name, `agent-<id>.jsonl`: the key its cursor is saved under. */
	name: string
	path: string
	/** The Agent tool call that ran it. */
	toolUseId: string | undefined
}

/** The subagent files beside a session's transcript. */
export async function subagentFiles(transcriptPath: string): Promise<SubagentFile[]> {
	const dir = join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents')
	const names = (await readdir(dir).catch(() => [])).filter((n) => /^agent-.+\.jsonl$/.test(n)).sort()
	return Promise.all(
		names.map(async (name) => {
			const meta = await readFile(join(dir, name.replace(/\.jsonl$/, '.meta.json')), 'utf8')
				.then((text) => JSON.parse(text) as { toolUseId?: unknown })
				.catch(() => undefined)
			return {
				name,
				path: join(dir, name),
				toolUseId: typeof meta?.toolUseId === 'string' ? meta.toolUseId : undefined,
			}
		}),
	)
}

/**
 * Where Claude Code keeps a session's transcript: `<config dir>/projects/<cwd, every character
 * but letters and digits a dash>/<session id>.jsonl`. For when no hook has named it yet (a `-p` run's first prompt).
 */
export function transcriptPathFor(cwd: string, sessionId: string): string {
	const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
	return join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`)
}

/** The cursor key of the session's own file. */
export function mainKey(transcriptPath: string): string {
	return basename(transcriptPath)
}
