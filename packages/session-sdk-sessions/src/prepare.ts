// What a session-side client tells the cloud when a coding agent's session starts: the
// automation/run/prepare body, and the repository facts from local git that go with it.

import { execFile } from 'node:child_process'
import { basename, dirname } from 'node:path'
import { promisify } from 'node:util'

import { type ApiRequest, cutUtf8, type DaemonRequest } from '@humanlayer/session-sdk-base'

const execFileAsync = promisify(execFile)

type WithoutSession<T> = Omit<T, 'sessionId'>

export type PrepareBody = ApiRequest<'automation/run/prepare'>
export type PrepareSession = Omit<Extract<PrepareBody, { taskMode: 'use' }>, 'taskMode' | 'taskIdOrSlug'>
export type TaskConfig = Extract<PrepareBody, { taskMode: 'ensure' }>['task']
export type WorkspaceRepo = NonNullable<TaskConfig['workspaceState']>['repos'][number]
export type CodingAgent = PrepareBody['codingAgent']
export type RepositoriesReport = WithoutSession<DaemonRequest<'sessions/repositories/report'>>

export interface GitInfo {
	root: string
	/** Absent in a repo with no commits yet. */
	headSha?: string
	/** "" on a detached HEAD. */
	branch: string
	/** origin, with any user:password@ removed. */
	remoteUrl?: string
}

/** Trimmed stdout, or undefined when git fails or exits non-zero. */
export async function git(cwd: string, ...args: string[]): Promise<string | undefined> {
	try {
		return (await execFileAsync('git', args, { cwd, timeout: 5000 })).stdout.trim()
	} catch {
		return undefined
	}
}

/** Local git facts for workspaceState and repositories/report. Undefined outside a repo. */
export async function gitInfo(cwd: string): Promise<GitInfo | undefined> {
	const root = await git(cwd, 'rev-parse', '--show-toplevel')
	if (!root) return undefined
	const [headSha, branch, remoteUrl] = await Promise.all([
		git(root, 'rev-parse', '--verify', '-q', 'HEAD'),
		git(root, 'symbolic-ref', '--short', '-q', 'HEAD'),
		git(root, 'remote', 'get-url', 'origin'),
	])
	const info: GitInfo = { root, branch: branch ?? '' }
	if (headSha) info.headSha = headSha
	if (remoteUrl) info.remoteUrl = stripUserinfo(remoteUrl)
	return info
}

/** Removes user:password@ from URL-style remotes. scp-style "git@host:path" has no secret and stays. */
export function stripUserinfo(url: string): string {
	try {
		const parsed = new URL(url)
		if (!parsed.username && !parsed.password) return url
		parsed.username = ''
		parsed.password = ''
		return parsed.toString()
	} catch {
		return url
	}
}

/** prepare's prompt: the text plus "[image]" per image, cut to 1 MB. Never empty. */
export function promptText(text: string, imageCount: number): string {
	const parts = [text, ...Array.from({ length: imageCount }, () => '[image]')].filter((part) => part.trim())
	return cutUtf8(parts.join('\n'), 1024 * 1024) || '(empty prompt)'
}

/** Ensure a task by slug (made if missing), or use one that exists by id or slug. */
export type PrepareTask = { taskMode: 'ensure'; slug: string } | { taskMode: 'use'; taskIdOrSlug: string }

export interface PrepareFacts {
	pick: PrepareTask
	codingAgent: CodingAgent
	hostId: string
	title: string
	prompt: string
	cwd: string
	model?: { provider: string; id: string }
	git?: GitInfo
}

/** The automation/run/prepare body. provider and model default server-side when absent. */
export function prepareBody(f: PrepareFacts): PrepareBody {
	const session: PrepareSession = {
		hostId: f.hostId,
		sessionName: f.title,
		prompt: f.prompt,
		workingDirectory: f.cwd,
		codingAgent: f.codingAgent,
		permissionsMode: 'bypass',
	}
	if (f.model) {
		session.provider = f.model.provider
		session.model = f.model.id
	}
	if (f.pick.taskMode === 'use') return { ...session, taskMode: 'use', taskIdOrSlug: f.pick.taskIdOrSlug }
	const task: TaskConfig = { name: f.title, workflowType: 'freeform', worktreeTiming: 'never' }
	if (f.git) task.workspaceState = workspaceState(f.git)
	return { ...session, taskMode: 'ensure', slug: f.pick.slug, task }
}

/** For ensure only: the task's workspace is the repo the agent runs in. */
function workspaceState(git: GitInfo): NonNullable<TaskConfig['workspaceState']> {
	const repo: WorkspaceRepo = { path: basename(git.root), sourceRef: 'HEAD', branch: git.branch, primary: true }
	if (git.headSha) repo.sourceCommit = git.headSha
	if (git.remoteUrl) repo.remoteUrl = git.remoteUrl
	return { workspaceBaseDirectory: dirname(git.root), repos: [repo] }
}

/** sessions/repositories/report's body, less sessionId. No branch when HEAD is detached. */
export function repositoriesReport(git: GitInfo): RepositoriesReport {
	const repo: RepositoriesReport['repositories'][number] = { localPath: git.root }
	if (git.remoteUrl) repo.remoteUrl = git.remoteUrl
	if (git.branch) repo.branch = git.branch
	return { repositories: [repo] }
}
