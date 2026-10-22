import {
	getPrimaryTargetDirectory,
	resolveRepositoryWorkspaceSpec,
	resolveSingleRepositoryWorkspaceSpec,
} from '@humanlayer/db/utils/repository-directory'
import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import { WorkspaceSpecSchema } from '@humanlayer/schemas/zod/workspace'
import z from 'zod/v4'

const ResolveWorkspaceSpecForHostInputSchema = z
	.object({
		workspaceSpec: WorkspaceSpecSchema.nullable(),
		repositoryDirectory: z.string().trim().min(1, 'Repository directory is required').optional(),
	})
	.superRefine((input, context) => {
		if (input.workspaceSpec === null) return
		input.workspaceSpec.repos.forEach((repository, index) => {
			if (isRelativeRepositoryPath(repository.localPath)) return
			context.addIssue({
				code: 'custom',
				message: 'Repository localPath must be relative to the workspace directory',
				path: ['workspaceSpec', 'repos', index, 'localPath'],
			})
		})
	})

export type ResolveWorkspaceSpecForHostInput = z.input<typeof ResolveWorkspaceSpecForHostInputSchema>

function isRelativeRepositoryPath(value: string): boolean {
	const normalized = value.replaceAll('\\', '/')
	return !normalized.startsWith('/') && !normalized.startsWith('~/') && !/^[A-Za-z]:/.test(normalized)
}

/**
 * Resolves task repository paths for one host while preserving worktree targets.
 */
export function resolveWorkspaceSpecForHost(input: ResolveWorkspaceSpecForHostInput): WorkspaceSpec | null {
	const { workspaceSpec, repositoryDirectory } = ResolveWorkspaceSpecForHostInputSchema.parse(input)

	if (workspaceSpec === null) return workspaceSpec
	if (!repositoryDirectory) throw new Error('Repository directory is required for this task and host')
	return WorkspaceSpecSchema.parse(
		workspaceSpec.repos.length === 1
			? resolveSingleRepositoryWorkspaceSpec(workspaceSpec, repositoryDirectory)
			: resolveRepositoryWorkspaceSpec(workspaceSpec, repositoryDirectory),
	)
}

function normalizeWorkspacePath(path: string): string {
	const normalized = posix.normalize(path.trim().replaceAll('\\', '/'))
	return normalized === '/' ? normalized : normalized.replace(/\/+$/, '')
}

function resolvePathWithinWorkspace(requestedPath: string, workspaceBaseDirectory: string): string | null {
	const requested = normalizeWorkspacePath(requestedPath)
	const workspaceBase = normalizeWorkspacePath(workspaceBaseDirectory)
	if (requested === workspaceBase || requested.startsWith(`${workspaceBase}/`)) return requested
	if (!workspaceBase.startsWith('~/')) return null

	const workspaceSuffix = workspaceBase.slice(1)
	const suffixIndex = requested.indexOf(workspaceSuffix)
	if (suffixIndex < 0) return null
	const pathAfterWorkspace = requested.slice(suffixIndex + workspaceSuffix.length)
	if (pathAfterWorkspace !== '' && !pathAfterWorkspace.startsWith('/')) return null
	return `~${workspaceSuffix}${pathAfterWorkspace}`
}

/**
 * Keeps worktree-now sessions inside their resolved workspace while honoring a
 * workspace root, repository, or nested directory selected by the user.
 */
export function resolveWorkspaceSessionWorkingDirectory(
	workspaceSpec: WorkspaceSpec,
	requestedWorkingDirectory: string,
): string {
	const requestedWorkspacePath = resolvePathWithinWorkspace(
		requestedWorkingDirectory,
		workspaceSpec.workspaceBaseDirectory,
	)
	if (requestedWorkspacePath) return requestedWorkspacePath

	const requested = normalizeWorkspacePath(requestedWorkingDirectory)
	const matchingRepository = workspaceSpec.repos.find((repository) => {
		const targetPath = normalizeWorkspacePath(repository.targetPath)
		if (requested === targetPath) return true
		if (!targetPath.startsWith('~/')) return false
		return requested.endsWith(targetPath.slice(1))
	})
	return matchingRepository?.targetPath ?? getPrimaryTargetDirectory(workspaceSpec)
}
import { posix } from 'node:path'
