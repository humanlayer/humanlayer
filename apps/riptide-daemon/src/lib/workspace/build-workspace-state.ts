import type { WorkspaceSetupState, WorkspaceSpec, WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { Effect, Path } from 'effect'

import { normalizePath } from '@/lib/utils'

type WorkspaceSpecInput = Omit<WorkspaceSpec, 'repos'> & {
	readonly repos: readonly (Omit<WorkspaceSpec['repos'][number], 'copyGlobs'> & {
		readonly copyGlobs: readonly string[]
	})[]
}

export const buildCompatibilityWorkspaceState = (spec: WorkspaceSpecInput, state: WorkspaceSetupState) =>
	Effect.gen(function* () {
		const pathService = yield* Path.Path
		const progressByLocalPath = new Map(state.repos.map((repo) => [repo.localPath, repo]))

		const repos: WorkspaceState['repos'] = spec.repos.map((repo) => {
			const progress = progressByLocalPath.get(repo.localPath)
			const realizedTargetPath = progress?.worktree?.targetPath ?? repo.targetPath
			const workspaceRepo: WorkspaceState['repos'][number] = {
				path: pathService.relative(
					normalizePath(spec.workspaceBaseDirectory),
					normalizePath(realizedTargetPath),
				),
				sourceRef: repo.sourceRef,
				branch: repo.branch,
				primary: repo.primary,
			}
			if (repo.branchRemote !== undefined) workspaceRepo.branchRemote = repo.branchRemote
			if (progress?.worktree?.remoteUrl !== undefined) {
				workspaceRepo.remoteUrl = progress.worktree.remoteUrl
			}
			if (progress?.preflight?.resolvedSourceCommit !== undefined) {
				workspaceRepo.sourceCommit = progress.preflight.resolvedSourceCommit
			}
			return workspaceRepo
		})
		return {
			workspaceBaseDirectory: spec.workspaceBaseDirectory,
			repos,
		} satisfies WorkspaceState
	}).pipe(Effect.withSpan('workspace.build_compatibility_state'))
