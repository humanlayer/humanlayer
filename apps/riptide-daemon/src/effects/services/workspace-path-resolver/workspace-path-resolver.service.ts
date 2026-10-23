import { Context, type Effect } from 'effect'

export interface ResolveWorkspaceSourceDirectoryInput {
	readonly directory: string
	readonly localPath: string
	readonly singleRepositoryName?: string
}

export interface ResolveWorkspaceTargetDirectoryInput {
	readonly targetPath: string
}

export interface WorkspacePathResolverService {
	readonly resolveSourceDirectory: (input: ResolveWorkspaceSourceDirectoryInput) => Effect.Effect<string>
	readonly resolveTargetDirectory: (input: ResolveWorkspaceTargetDirectoryInput) => Effect.Effect<string>
}

export class WorkspacePathResolver extends Context.Service<WorkspacePathResolver, WorkspacePathResolverService>()(
	'WorkspacePathResolver',
) {}
