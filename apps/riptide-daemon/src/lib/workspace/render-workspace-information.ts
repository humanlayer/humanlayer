import { homedir } from 'node:os'
import { join, normalize, relative, resolve, sep } from 'node:path'

import type { WorkspaceView, WorkspaceViewRepo } from '@humanlayer/db/utils/workspace-view'
import type { WorkspaceSetupError, WorkspaceSetupState, WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'

/**
 * Expand a leading `~` against the daemon's local $HOME.
 * The snapshot stores workspaceBaseDirectory non-expanded (`~/...`) so it is
 * portable across machines; expansion always happens per-consumer at launch.
 */
function expandTilde(path: string): string {
	return path.startsWith('~') ? join(homedir(), path.slice(1)) : path
}

/** Tilde-expanded, normalized workspace root for this machine. */
export function expandedWorkspaceBaseDirectory(state: WorkspaceView): string {
	return normalize(expandTilde(state.workspaceBaseDirectory))
}

/**
 * Expanded absolute directories for every workspace repo except the one the
 * session is launched in (the cwd repo is the session's own directory, not an
 * additional directory). Order follows the snapshot's config-declared order.
 */
export function workspaceRepoDirectories(state: WorkspaceView, sessionCwd: string): string[] {
	const cwd = resolve(sessionCwd)
	return state.repos.map((repo) => normalize(expandTilde(repo.targetPath))).filter((dir) => resolve(dir) !== cwd)
}

/** Current-host repo directories whose worktrees are known to exist. */
export function materializedWorkspaceRepoDirectories(state: WorkspaceView, sessionCwd: string): string[] {
	const cwd = resolve(sessionCwd)
	return state.repos
		.filter((repo) => repo.materialized)
		.map((repo) => normalize(expandTilde(repo.targetPath)))
		.filter((dir) => resolve(dir) !== cwd)
}

const PRIMARY_LABEL = 'primary/default launch repo'

/** Render a path relative to `from`, with an explicit `./` prefix for non-ascending paths. */
function relativeDisplayPath(from: string, to: string): string {
	const rel = relative(from, to) || '.'
	const display = sep === '/' ? rel : rel.split(sep).join('/')
	return display.startsWith('.') ? display : `./${display}`
}

type RepoLine = {
	displayPath: string
	description?: string
	primary: boolean
}

/**
 * One line per repo: cwd-relative path, then the user-provided description only
 * when present (never fabricated), with the primary repo labeled.
 */
function renderRepoLines(lines: RepoLine[]): string {
	if (lines.length === 0) return ''
	const width = Math.max(...lines.map((line) => line.displayPath.length))
	return lines
		.map((line) => {
			const labelParts: string[] = []
			if (line.description) labelParts.push(line.description)
			if (line.primary) labelParts.push(PRIMARY_LABEL)
			const label = labelParts.join(' · ')
			if (!label) return `  ${line.displayPath}`
			return `  ${line.displayPath.padEnd(width + 4)}${label}`
		})
		.join('\n')
}

function repoLinesFor(repos: readonly WorkspaceViewRepo[], cwd: string): RepoLine[] {
	return repos.map((repo) => ({
		displayPath: relativeDisplayPath(cwd, expandTilde(repo.targetPath)),
		description: repo.description,
		primary: repo.primary,
	}))
}

/**
 * Render the `<workspace_information>` system-prompt block for a multi-repo
 * task. Paths are remapped relative to the session's working directory:
 * `./repo` when launched at the workspace root, `../repo` inside a sibling,
 * and the cwd repo is called out as the current directory rather than listed.
 *
 * Single-repo tasks never get this block — callers gate on `repos.length > 1`.
 */
export function renderWorkspaceInformation(state: WorkspaceView, sessionCwd: string, expandedBaseDir: string): string {
	const cwd = resolve(sessionCwd)
	const base = resolve(expandedBaseDir)
	const baseDisplay = state.workspaceBaseDirectory.endsWith('/')
		? state.workspaceBaseDirectory
		: `${state.workspaceBaseDirectory}/`

	const cwdRepo = state.repos.find((repo) => resolve(expandTilde(repo.targetPath)) === cwd)

	if (cwd === base) {
		return [
			'<workspace_information>',
			'You are working in a multi-repo workspace rooted at',
			baseDisplay,
			'',
			'Your working directory is the workspace root. It is NOT itself a git',
			'repository — each repository below is checked out in its own',
			'subdirectory. Run git, gh, build, and test commands from inside the',
			'relevant repository directory, not from the workspace root.',
			'',
			'The following repositories are available to you:',
			'',
			renderRepoLines(repoLinesFor(state.repos, cwd)),
			'',
			'Skills and instruction files (CLAUDE.md / AGENTS.md) from every repo',
			'above are loaded and available.',
			'Repo-local Claude settings and MCP-style configuration are governed by',
			'the session launch directory, not universally by additional directories.',
			'</workspace_information>',
		].join('\n')
	}

	if (cwdRepo) {
		const siblings = state.repos.filter((repo) => repo !== cwdRepo)
		const cwdDescription = cwdRepo.description ? ` (${cwdRepo.description})` : ''
		const cwdSentence = cwdRepo.primary
			? `Your working directory is ./${cwdRepo.relativePath}${cwdDescription},\nthe ${PRIMARY_LABEL} for this workspace.`
			: `Your working directory is ./${cwdRepo.relativePath}${cwdDescription}.`

		return [
			'<workspace_information>',
			'You are working inside one repository of a multi-repo workspace rooted at',
			baseDisplay,
			'',
			cwdSentence,
			'The other repositories in this workspace are available to you as',
			'sibling directories:',
			'',
			renderRepoLines(repoLinesFor(siblings, cwd)),
			'',
			'Run git, gh, build, and test commands from inside the',
			'relevant repository directory.',
			'',
			'Skills and instruction files (CLAUDE.md / AGENTS.md) from every repo',
			'in the workspace are loaded and available.',
			'Claude settings and MCP-style configuration are loaded according to the',
			'current launch directory.',
			'</workspace_information>',
		].join('\n')
	}

	// Session launched somewhere else entirely (arbitrary path override):
	// still list every repo, remapped relative to the actual cwd.
	return [
		'<workspace_information>',
		'You are working in a session that belongs to a multi-repo workspace rooted at',
		baseDisplay,
		'',
		'The repositories in this workspace are available to you at the following',
		'paths (relative to your working directory):',
		'',
		renderRepoLines(repoLinesFor(state.repos, cwd)),
		'',
		'Run git, gh, build, and test commands from inside the',
		'relevant repository directory.',
		'',
		'Skills and instruction files (CLAUDE.md / AGENTS.md) from every repo',
		'in the workspace are loaded and available.',
		'Repo-local Claude settings and MCP-style configuration are governed by',
		'the session launch directory, not universally by additional directories.',
		'</workspace_information>',
	].join('\n')
}

export interface WorkspaceSetupStatusLine {
	/** Repository shown to the agent, relative to the workspace root. */
	readonly displayPath: string
	/** The stage name or, when the stage runs a configured command, that command. */
	readonly action: string
	readonly outcome: 'RUNNING' | 'FAILED' | 'SKIPPED BY USER'
}

/**
 * Render the `<workspace_setup_status>` prompt block from stage lines. Both the legacy task
 * ledger and project-workspace repository rows feed this one renderer so agents read the same
 * block whichever system set the workspace up. The error is the
 * `message`/`stderr` slice shared by the legacy `WorkspaceSetupError` and the project-workspace
 * `WorkspaceRepositorySetupError` schemas. Returns null when nothing is worth reporting.
 */
export function renderWorkspaceSetupStatusBlock(
	lines: readonly WorkspaceSetupStatusLine[],
	error: Pick<WorkspaceSetupError, 'message' | 'stderr'> | null,
): string | null {
	if (lines.length === 0 && error === null) return null
	const errorDetails: string[] = []
	if (error !== null) {
		errorDetails.push('', `Current setup error: ${error.message}`)
		if (error.stderr) errorDetails.push(`stderr: ${error.stderr}`)
	}
	return [
		'<workspace_setup_status>',
		'Note that the following setup steps may still be running, but you can start working while they are running.',
		'',
		...lines.map((line) => `${line.displayPath} - ${line.action} - ${line.outcome}`),
		...errorDetails,
		'</workspace_setup_status>',
	].join('\n')
}

/** Render durable setup progress so an agent can work safely while convergence continues. */
export function renderWorkspaceSetupProgress(
	state: WorkspaceSetupState,
	error: WorkspaceSetupError | null,
	spec: WorkspaceSpec,
): string | null {
	const unfinished = state.repos.filter((repo) => repo.status !== 'done')
	const acceptedSkips = state.acceptedSkips ?? []

	const specRepos = new Map(spec.repos.map((repo) => [repo.localPath, repo]))
	const lines: WorkspaceSetupStatusLine[] = unfinished.map((repo) => {
		const configuredCommand = specRepos.get(repo.localPath)?.setupCommand
		const action = repo.status === 'setup_command' && configuredCommand ? configuredCommand : repo.status
		const failed = error?.localPath === repo.localPath && error.stage === repo.status
		const displayPath = repo.localPath === '.' ? './' : repo.localPath
		return { displayPath, action, outcome: failed ? 'FAILED' : 'RUNNING' }
	})
	for (const skip of acceptedSkips) {
		lines.push({ displayPath: skip.localPath, action: skip.command ?? skip.stage, outcome: 'SKIPPED BY USER' })
	}
	return renderWorkspaceSetupStatusBlock(lines, error)
}
