import { repositoryNameFromIdentity } from '@humanlayer/schemas/effect/project-workspace'

export const isSafeTaskWorkspacePathSegment = (value: string): boolean =>
	value.length > 0 &&
	value.length <= 100 &&
	new TextEncoder().encode(value).length <= 255 &&
	value === value.trim() &&
	value !== '.' &&
	value !== '..' &&
	!value.includes('/') &&
	!value.includes('\\') &&
	!value.includes('\0')

/**
 * Where a project-backed task's workspace lives on a host. The `~` is expanded only by
 * that host's daemon; the UI shows the path as-is.
 */
export const taskWorkspaceRoot = (pathSegment: string): string => `~/.humanlayer/workspaces/${pathSegment}`

/** The task slug names the workspace directory when it is a safe path segment; otherwise the workspace id does. */
export const resolveTaskWorkspacePathSegment = (slug: string | null | undefined, workspaceId: string): string =>
	slug != null && isSafeTaskWorkspacePathSegment(slug) ? slug : workspaceId

export const taskWorkspaceRepositoryDirectory = (workspaceRoot: string, repositoryIdentity: string): string =>
	`${workspaceRoot}/${repositoryNameFromIdentity(repositoryIdentity)}`

/**
 * The directory a session launches in: the workspace root for a single-repo workspace,
 * else the default repository's worktree. Server and UI must agree on this.
 */
export const taskWorkspaceSessionDirectory = (
	workspaceRoot: string,
	repositories: ReadonlyArray<{ repositoryIdentity: string; default: boolean }>,
): string => {
	const defaultRepository = repositories.find((repository) => repository.default) ?? repositories[0]
	if (repositories.length === 1 || defaultRepository === undefined) return workspaceRoot
	return taskWorkspaceRepositoryDirectory(workspaceRoot, defaultRepository.repositoryIdentity)
}
