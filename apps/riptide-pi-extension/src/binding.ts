// A binding links one pi session to one cloud session (plan.md §4). This module picks the task,
// reads local git facts, builds the prepare body, and loads/saves the binding file at
// bindingsDir(channel)/<piSessionId>.json. No network calls here.

import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

import type { LedgerEntry } from '@humanlayer/session-sdk-artifacts'
import {
	type GitInfo,
	type PrepareFacts as SharedPrepareFacts,
	newTask as sharedNewTask,
	pickTask as sharedPickTask,
	prepareBody as sharedPrepareBody,
	recordLink as sharedRecordLink,
	type TaskPick,
} from '@humanlayer/session-sdk-sessions'

import type { PrepareBody } from './api.ts'
import { hostId, type Identity } from './auth.ts'
import { bindingsDir, type Channel, codingAgent, configFilePath, taskFromEnv } from './config.ts'
import { readJsonFile, writeJsonFileAtomic } from './util.ts'

export {
	git,
	type GitInfo,
	gitInfo,
	promptText,
	repositoriesReport,
	stripUserinfo,
	type TaskPick,
} from '@humanlayer/session-sdk-sessions'

/** Entries before index n are done. lastId is entry n-1's id, to notice a shifted entry list. */
export interface Cursor {
	n: number
	lastId: string | null
	/** The next user entry is the first prompt, which prepare already wrote. */
	skipFirstUser?: boolean
}

export interface Binding {
	version: 1
	channel: Channel
	piSessionId: string
	cwd: string
	createdAt: string
	taskMode: 'ensure' | 'use'
	/** Absent after an attach by uuid: no route reads a task by id. */
	taskSlug?: string
	hostId: string
	/** Acked: moves only when the outbox reaches a cursor marker. */
	cursor: Cursor
	/** Git facts at bind time; the task diff is against headSha. */
	git?: GitInfo
	off?: boolean
	// Set when prepare succeeds. A binding with no cloudSessionId is pending and never saved.
	cloudSessionId?: string
	taskId?: string
	userId?: string
	orgId?: string
	sessionUrl?: string
	/** Task files sent so far (artifacts.ts), by subpath. Written only after the cloud took them. */
	artifactLedger?: Record<string, LedgerEntry>
	/** Task diff rows sent so far (diffs.ts), by path. Written only after the streams took them. */
	diffPublished?: Record<string, { patchHash?: string; rowHash: string }>
}

/** plan.md §4 "Which task": attach, the flag, HUMANLAYER_TASK, the worktree's task link, else create. */
export function pickTask(piSessionId: string, cwd: string, attach?: string, flag?: string): Promise<TaskPick> {
	return sharedPickTask({
		prefix: 'pi',
		sessionId: piSessionId,
		cwd,
		linksPath: linksPath(),
		attach,
		chosen: flag?.trim() || taskFromEnv(),
		freshId: randomUUID,
	})
}

/** Stable for first binds, flags and failed auto-attach fallback; explicit attach new passes a fresh id. */
export function newTask(piSessionId: string): Extract<TaskPick, { taskMode: 'ensure' }> {
	return sharedNewTask('pi', piSessionId)
}

/** Every task link this extension made, as JSON [path, taskId] lines. Only appended to: bindings change, this must not. */
function linksPath(): string {
	return join(dirname(configFilePath()), 'task-links.jsonl')
}

/** Notes a link before it exists, so worktree detection never counts it. */
export function recordLink(path: string, taskId: string): Promise<void> {
	return sharedRecordLink(linksPath(), path, taskId)
}

/** Task name and sessionName: the pi session name, else the prompt's first line cut to 80 characters. */
export function sessionTitle(sessionName: string | undefined, prompt: string): string {
	const line = prompt.split('\n').find((l) => l.trim()) ?? ''
	return sessionName?.trim() || Array.from(line.trim()).slice(0, 80).join('').trim() || 'pi session'
}

export type PrepareFacts = Omit<SharedPrepareFacts, 'codingAgent' | 'pick'> & { pick: TaskPick }

/** The automation/run/prepare body, for pi's coding agent. */
export function prepareBody(f: PrepareFacts): PrepareBody {
	return sharedPrepareBody({ ...f, codingAgent: codingAgent() })
}

/** A new, still pending binding: it has no cloud session until prepare succeeds. */
export function newBinding(o: {
	channel: Channel
	piSessionId: string
	cwd: string
	pick: TaskPick
	hostId: string
	cursor: Cursor
	git: GitInfo | undefined
}): Binding {
	const b: Binding = {
		version: 1,
		channel: o.channel,
		piSessionId: o.piSessionId,
		cwd: o.cwd,
		createdAt: new Date().toISOString(),
		taskMode: o.pick.taskMode,
		hostId: o.hostId,
		cursor: o.cursor,
	}
	const slug = o.pick.taskMode === 'ensure' ? o.pick.slug : o.pick.taskSlug
	if (slug) b.taskSlug = slug
	else if (o.pick.taskMode === 'use') b.taskId = o.pick.taskIdOrSlug
	if (o.git) b.git = o.git
	return b
}

function bindingPath(channel: Channel, piSessionId: string): string {
	return join(bindingsDir(channel), `${piSessionId}.json`)
}

/** The saved binding, unless it belongs to another channel or host, or (device login) another user or org. */
export async function loadBinding(
	channel: Channel,
	piSessionId: string,
	who: Identity | null,
): Promise<Binding | undefined> {
	const b = await readJsonFile<Binding>(bindingPath(channel, piSessionId))
	if (b?.version !== 1 || !b.cloudSessionId || b.channel !== channel || b.hostId !== (await hostId(channel)))
		return undefined
	if (who?.source === 'device' && (b.userId !== who.userId || b.orgId !== who.orgId)) return undefined
	return b
}

export async function saveBinding(b: Binding): Promise<void> {
	await writeJsonFileAtomic(bindingPath(b.channel, b.piSessionId), b)
}
