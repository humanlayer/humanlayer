import type { WorkspaceRepositorySetupStage } from '@humanlayer/schemas/effect/project-workspace'
import type {
	RepoWorkspaceSetupProgress,
	WorkspaceSetupStage,
	WorkspaceSpec,
	WorkspaceSpecRepo,
	WorkspaceState,
} from '@humanlayer/schemas/effect/workspace'

type WorkspaceSpecInput = Pick<WorkspaceSpec, 'workspaceBaseDirectory' | 'setupBlocksFirstSession'> & {
	readonly repos: readonly Pick<WorkspaceSpecRepo, 'localPath' | 'targetPath' | 'sourceRef' | 'branch' | 'primary'>[]
}

type WorkspaceSetupStateInput = {
	readonly repos: readonly Pick<RepoWorkspaceSetupProgress, 'localPath' | 'status' | 'preflight' | 'worktree'>[]
}

export interface WorkspaceViewRepo {
	/** Repository path from the workspace spec, stable across host materialization. */
	readonly localPath: string
	/** Path shown relative to workspaceBaseDirectory. */
	readonly relativePath: string
	/** Desired target path until materialized, then the host-specific worktree path. */
	readonly targetPath: string
	/** True when host setup has created or resolved the worktree target. */
	readonly materialized: boolean
	/** Legacy ledger stages, or project-workspace repository stages for a `project_workspace` view. */
	readonly status?: WorkspaceSetupStage | WorkspaceRepositorySetupStage
	readonly description?: string
	readonly remoteUrl?: string
	readonly sourceRef: string
	readonly sourceCommit?: string
	readonly branch: string
	readonly primary: boolean
}

export interface WorkspaceView {
	/**
	 * Where the view came from: task-owned workspace_spec JSONB, deprecated task-level
	 * workspace_state, or a project workspace snapshot joined with one user/host materialization.
	 */
	readonly source: 'workspace_spec' | 'legacy_workspace_state' | 'project_workspace'
	readonly workspaceBaseDirectory: string
	readonly setupBlocksFirstSession: boolean
	readonly repos: readonly WorkspaceViewRepo[]
}

type MutableWorkspaceViewRepo = { -readonly [Key in keyof WorkspaceViewRepo]: WorkspaceViewRepo[Key] }

export interface DeriveWorkspaceViewInput {
	/** Parsed WorkspaceSpecSchema JSONB; when present, it is the canonical workspace shape. */
	readonly workspaceSpec: WorkspaceSpecInput | null | undefined
	/** Parsed WorkspaceSetupStateSchema JSONB for host-specific setup/materialization details. */
	readonly workspaceSetupState?: WorkspaceSetupStateInput | null
	/** Parsed legacy WorkspaceState JSONB, used only when workspaceSpec is absent. */
	readonly legacyWorkspaceState?: WorkspaceState | null
}

const normalizeSeparators = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')

const joinWorkspacePath = (base: string, relativePath: string): string => {
	const normalizedBase = normalizeSeparators(base)
	const normalizedRelativePath = normalizeSeparators(relativePath).replace(/^\/+/, '')
	return `${normalizedBase}/${normalizedRelativePath}`
}

const relativePathFromSpecTarget = (workspaceBaseDirectory: string, targetPath: string): string => {
	const base = normalizeSeparators(workspaceBaseDirectory)
	const target = normalizeSeparators(targetPath)
	const basePrefix = `${base}/`
	if (target.startsWith(basePrefix)) return target.slice(basePrefix.length)
	return target.split('/').at(-1) ?? target
}

const baseDirectoryForTarget = (targetPath: string, relativePath: string): string => {
	const target = normalizeSeparators(targetPath)
	const relative = normalizeSeparators(relativePath).replace(/^\/+/, '')
	const suffix = `/${relative}`
	if (relative.length > 0 && target.endsWith(suffix)) return target.slice(0, -suffix.length)
	const separatorIndex = target.lastIndexOf('/')
	return separatorIndex > 0 ? target.slice(0, separatorIndex) : target
}

/**
 * Resolves the setup-aware workspace shape used by readers during the
 * workspace_state migration. A task with workspace_spec never falls back to
 * workspace_state; the legacy snapshot is consulted only when no spec exists.
 */
export function deriveWorkspaceView(input: DeriveWorkspaceViewInput): WorkspaceView | null {
	if (input.workspaceSpec) {
		const workspaceSpec = input.workspaceSpec
		const setupRepos = new Map(input.workspaceSetupState?.repos.map((repo) => [repo.localPath, repo]) ?? [])
		const repos = workspaceSpec.repos.map<WorkspaceViewRepo>((repo) => {
			const setupRepo = setupRepos.get(repo.localPath)
			const materializedTargetPath = setupRepo?.worktree?.targetPath
			const relativePath = relativePathFromSpecTarget(workspaceSpec.workspaceBaseDirectory, repo.targetPath)
			const workspaceViewRepo: MutableWorkspaceViewRepo = {
				localPath: repo.localPath,
				relativePath,
				targetPath: materializedTargetPath ?? repo.targetPath,
				materialized: materializedTargetPath !== undefined,
				sourceRef: repo.sourceRef,
				branch: repo.branch,
				primary: repo.primary,
			}
			const status = setupRepo?.status
			if (status !== undefined) workspaceViewRepo.status = status
			const remoteUrl = setupRepo?.worktree?.remoteUrl
			if (remoteUrl !== undefined) workspaceViewRepo.remoteUrl = remoteUrl
			const sourceCommit = setupRepo?.preflight?.resolvedSourceCommit
			if (sourceCommit !== undefined) workspaceViewRepo.sourceCommit = sourceCommit
			return workspaceViewRepo
		})
		const firstMaterializedRepo = repos.find((repo) => repo.materialized)
		const workspaceBaseDirectory = firstMaterializedRepo
			? baseDirectoryForTarget(firstMaterializedRepo.targetPath, firstMaterializedRepo.relativePath)
			: workspaceSpec.workspaceBaseDirectory

		return {
			source: 'workspace_spec',
			workspaceBaseDirectory,
			setupBlocksFirstSession: workspaceSpec.setupBlocksFirstSession,
			repos,
		}
	}

	if (!input.legacyWorkspaceState) return null
	const legacyWorkspaceState = input.legacyWorkspaceState
	return {
		source: 'legacy_workspace_state',
		workspaceBaseDirectory: legacyWorkspaceState.workspaceBaseDirectory,
		setupBlocksFirstSession: false,
		repos: legacyWorkspaceState.repos.map((repo) => {
			const workspaceViewRepo: MutableWorkspaceViewRepo = {
				localPath: repo.path,
				relativePath: repo.path,
				targetPath: joinWorkspacePath(legacyWorkspaceState.workspaceBaseDirectory, repo.path),
				materialized: true,
				sourceRef: repo.sourceRef,
				branch: repo.branch,
				primary: repo.primary,
			}
			if (repo.description !== undefined) workspaceViewRepo.description = repo.description
			if (repo.remoteUrl !== undefined) workspaceViewRepo.remoteUrl = repo.remoteUrl
			if (repo.sourceCommit !== undefined) workspaceViewRepo.sourceCommit = repo.sourceCommit
			return workspaceViewRepo
		}),
	}
}
