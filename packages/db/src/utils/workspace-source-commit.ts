import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import { Data } from 'effect'

export type WorkspaceSpecSourceCommitPinResult = Data.TaggedEnum<{
	Pinned: { readonly workspaceSpec: WorkspaceSpec; readonly changed: boolean }
	RepositoryNotFound: {}
	SourceCommitConflict: { readonly recordedSourceCommit: string }
}>

export const WorkspaceSpecSourceCommitPinResult = Data.taggedEnum<WorkspaceSpecSourceCommitPinResult>()

/**
 * Pins one repository in a task workspace to the commit selected during its
 * first successful preflight. A later caller can observe, but cannot replace,
 * that commit.
 */
export function pinWorkspaceSpecSourceCommit({
	workspaceSpec,
	localPath,
	resolvedSourceCommit,
}: {
	readonly workspaceSpec: WorkspaceSpec
	readonly localPath: string
	readonly resolvedSourceCommit: string
}): WorkspaceSpecSourceCommitPinResult {
	const repository = workspaceSpec.repos.find((candidate) => candidate.localPath === localPath)
	if (!repository) return WorkspaceSpecSourceCommitPinResult.RepositoryNotFound()
	if (
		repository.sourceCommit !== undefined &&
		repository.sourceCommit.toLowerCase() !== resolvedSourceCommit.toLowerCase()
	) {
		return WorkspaceSpecSourceCommitPinResult.SourceCommitConflict({
			recordedSourceCommit: repository.sourceCommit,
		})
	}
	if (repository.sourceCommit?.toLowerCase() === resolvedSourceCommit.toLowerCase()) {
		return WorkspaceSpecSourceCommitPinResult.Pinned({ workspaceSpec, changed: false })
	}
	return WorkspaceSpecSourceCommitPinResult.Pinned({
		changed: true,
		workspaceSpec: {
			...workspaceSpec,
			repos: workspaceSpec.repos.map((candidate) =>
				candidate.localPath === localPath ? { ...candidate, sourceCommit: resolvedSourceCommit } : candidate,
			),
		},
	})
}
