// Which task a session binds to: an attach target, a chosen id or slug (a flag or
// HUMANLAYER_TASK), the worktree's own task link, else a new task. No network calls here: a
// caller that gets a 403 or 404 for a worktree's task falls back to newTask itself.

import { appendFile, mkdir, readdir, readFile, readlink, realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
	return UUID.test(value)
}

export type TaskPick =
	| { taskMode: 'ensure'; slug: string }
	| { taskMode: 'use'; taskIdOrSlug: string; taskSlug?: string; auto?: boolean }

export interface PickTaskOptions {
	/** Names new tasks: `<prefix>-<last 12 letters and digits of sessionId>`. */
	prefix: string
	/** The agent's session id, which gives a new task a slug that stays the same across retries. */
	sessionId: string
	cwd: string
	/** The file that records the links this agent made (recordLink), which never count as the worktree's task. */
	linksPath: string
	/** An explicit attach: a task id or slug, or `new` for a new task with a fresh slug. */
	attach?: string
	/** A task id or slug from a flag or HUMANLAYER_TASK, or `new`. */
	chosen?: string
	/** A fresh id for `attach new`. */
	freshId?: () => string
}

export async function pickTask(o: PickTaskOptions): Promise<TaskPick> {
	// The session's own slug may be an earlier bind's task: `attach new` needs one of its own.
	if (o.attach === 'new') return newTask(o.prefix, o.freshId?.() ?? `${Date.now()}`)
	const chosen = o.attach || o.chosen?.trim()
	if (chosen === 'new') return newTask(o.prefix, o.sessionId)
	if (chosen) return { taskMode: 'use', taskIdOrSlug: chosen, taskSlug: isUuid(chosen) ? undefined : chosen }
	const link = await taskLink(o.cwd, o.linksPath)
	if (link) return { taskMode: 'use', taskIdOrSlug: link.taskId, taskSlug: link.slug, auto: true }
	return newTask(o.prefix, o.sessionId)
}

/** A new task whose slug stays the same for the same session id. */
export function newTask(prefix: string, sessionId: string): Extract<TaskPick, { taskMode: 'ensure' }> {
	const tail = sessionId
		.replace(/[^a-z0-9]/gi, '')
		.slice(-12)
		.toLowerCase()
	return { taskMode: 'ensure', slug: `${prefix}-${tail}` }
}

/**
 * A HumanLayer worktree's own task: exactly one `.humanlayer/tasks/<slug>` symlink to
 * `.../artifacts/<uuid>`. Links this agent made (recordLink) don't count, or a later session in
 * the same cwd would join an earlier session's task.
 */
async function taskLink(cwd: string, linksPath: string): Promise<{ taskId: string; slug: string } | undefined> {
	const dir = await realpath(join(cwd, '.humanlayer', 'tasks')).catch(() => '')
	let links: { taskId: string; slug: string }[] = []
	for (const name of await readdir(dir).catch(() => [])) {
		const target = await readlink(join(dir, name)).catch(() => '')
		const taskId = /\/artifacts\/([^/]+)\/?$/.exec(target)?.[1]
		if (taskId && UUID.test(taskId)) links.push({ taskId, slug: name })
	}
	if (links.length > 0) {
		const own = new Set((await readFile(linksPath, 'utf8').catch(() => '')).split('\n'))
		links = links.filter((link) => !own.has(linkKey(join(dir, link.slug), link.taskId)))
	}
	return links.length === 1 ? links[0] : undefined
}

function linkKey(path: string, taskId: string): string {
	return JSON.stringify([path, taskId])
}

/** Notes a link before it exists, using its real parent so cwd aliases share the record. Only ever appended to. */
export async function recordLink(linksPath: string, path: string, taskId: string): Promise<void> {
	const key = linkKey(join(await realpath(dirname(path)), basename(path)), taskId)
	await mkdir(dirname(linksPath), { recursive: true, mode: 0o700 })
	// A leading newline keeps a partial last write from swallowing the next complete record.
	await appendFile(linksPath, `\n${key}\n`, { mode: 0o600 })
}
