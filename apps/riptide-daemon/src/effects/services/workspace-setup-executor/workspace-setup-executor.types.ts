import type { WorkspaceSpecRepo } from '@humanlayer/schemas/effect/workspace'

export type WorkspaceSetupRepository = Omit<WorkspaceSpecRepo, 'copyGlobs'> & {
	readonly copyGlobs: readonly string[]
}

export type WorkspaceRepoOperationInput = {
	readonly taskId: string
	readonly hostId: string
	readonly directory: string
	readonly repo: WorkspaceSetupRepository
	readonly singleRepositoryName?: string
}

export type WorkspaceWorktreeOperationInput = WorkspaceRepoOperationInput & {
	readonly resolvedSourceCommit: string
	readonly branchRemote?: string
}

export type WorkspacePreflightFacts = {
	readonly resolvedSourceCommit: string
	readonly branchRemote?: string
}

export type WorkspaceWorktreeFacts = {
	readonly targetPath: string
	readonly remoteName?: string
	readonly remoteUrl?: string
	readonly upstreamRef?: string
	readonly adopted: boolean
}

export type WorkspaceCopyFacts = {
	readonly filesCopied: readonly string[]
}

export type WorkspaceSetupCommandFacts = {
	readonly command: string
	readonly exitCode: number
}
