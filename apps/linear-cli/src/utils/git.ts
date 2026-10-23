import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import inquirer from 'inquirer'

const execFileAsync = promisify(execFile)

async function git(args: string[], cwd?: string): Promise<{ exitCode: number; stdout: string }> {
	try {
		const { stdout } = await execFileAsync('git', args, { cwd })
		return { exitCode: 0, stdout }
	} catch (error) {
		const err = error as { code?: number; stdout?: string }
		return { exitCode: err.code ?? 1, stdout: err.stdout ?? '' }
	}
}

/**
 * Get the current git branch name
 */
export async function getGitBranch(): Promise<string> {
	try {
		const result = await git(['branch', '--show-current'])
		return result.stdout.trim()
	} catch {
		return ''
	}
}

/**
 * Extract Linear issue ID from a git branch name
 */
export function extractIssueId(branchName: string): string | null {
	// Match patterns like ENG-123, eng-123, B2BPROD-206, etc.
	const match = branchName.match(/[A-Za-z0-9]+-\d+/)
	return match ? match[0].toUpperCase() : null
}

/**
 * Prompt user for issue ID interactively
 */
export async function getIssueIdInteractively(defaultId: string | null = null): Promise<string> {
	const { issueId } = await inquirer.prompt({
		type: 'input',
		name: 'issueId',
		message: 'Enter Linear issue ID (e.g. ENG-123, B2BPROD-206):',
		default: defaultId,
		validate: (input) => {
			return /^[A-Za-z0-9]+-\d+$/i.test(input)
				? true
				: 'Please enter a valid issue ID (e.g. ENG-123, B2BPROD-206)'
		},
	})

	return issueId.toUpperCase()
}

/**
 * Resolve issue ID from provided value, git branch, or interactive prompt
 */
export async function resolveIssueId(providedId?: string): Promise<string> {
	// If ID is provided as argument, use it
	if (providedId && /^[A-Za-z0-9]+-\d+$/i.test(providedId)) {
		return providedId.toUpperCase()
	}

	// Try to extract from git branch
	const gitBranch = await getGitBranch()
	const idFromBranch = gitBranch ? extractIssueId(gitBranch) : null

	// If found in branch, use it
	if (idFromBranch) {
		return idFromBranch
	}

	// Otherwise, prompt user
	return getIssueIdInteractively(providedId || null)
}

/**
 * Get list of staged files that match the tasks directory pattern.
 * Uses `git diff --cached --name-only` to get files staged for commit.
 *
 * @param repoPath - Path to the git repository
 * @param tasksDirPrefix - Prefix to filter for task files (e.g., "repos/" for thoughts repo)
 * @returns Array of staged file paths matching tasks/*
 */
export async function getStagedTaskFiles(repoPath: string, tasksDirPrefix: string = ''): Promise<string[]> {
	try {
		const result = await git(['diff', '--cached', '--name-only'], repoPath)
		if (result.exitCode !== 0) return []

		const output = result.stdout
		const files = output
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0)

		// Filter to only files in tasks directories
		// Pattern: {prefix}tasks/{issue-id}-.../
		// e.g., repos/humanlayer/tasks/ll-24-something/file.md
		const taskPattern = tasksDirPrefix
			? new RegExp(`^${tasksDirPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}tasks/`)
			: /^tasks\//

		return files.filter((file) => taskPattern.test(file))
	} catch {
		return []
	}
}
