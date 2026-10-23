export type WorkspaceRemoteSelectionInput = {
	readonly configuredBranchRemote?: string
	readonly sourceRef: string
	readonly upstreamRef?: string
	readonly remotes: readonly string[]
}

export const workspaceRemoteFromRef = (ref: string, remotes: readonly string[]): string | undefined => {
	const normalized = ref.startsWith('refs/remotes/') ? ref.slice('refs/remotes/'.length) : ref
	return remotes.find((remote) => normalized.startsWith(`${remote}/`))
}

export const selectWorkspaceBranchRemote = (input: WorkspaceRemoteSelectionInput): string | undefined => {
	if (input.configuredBranchRemote !== undefined) {
		return input.remotes.includes(input.configuredBranchRemote) ? input.configuredBranchRemote : undefined
	}
	return (
		workspaceRemoteFromRef(input.sourceRef, input.remotes) ??
		(input.upstreamRef === undefined ? undefined : workspaceRemoteFromRef(input.upstreamRef, input.remotes)) ??
		(input.remotes.includes('origin') ? 'origin' : undefined) ??
		(input.remotes.length === 1 ? input.remotes[0] : undefined)
	)
}

export const workspaceRemoteTrackingRef = (remote: string, branch: string): string => `refs/remotes/${remote}/${branch}`

export const workspaceUpstreamRef = (remote: string, branch: string): string => `${remote}/${branch}`
