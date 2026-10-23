import {
	WorkspaceRepositorySetupResult,
	type WorkspaceRepositoryActorSnapshot,
} from '@humanlayer/schemas/effect/project-workspace'
import { Clock, Effect, FileSystem, Path } from 'effect'

import { resolveWorkspacePath } from '../workspace-path-resolver/resolve-workspace-path'
import {
	isSafeWorkspaceRelativePath,
	normalizeWorkspaceRelativePath,
	workspacePathHasGlobMagic,
} from '../workspace-path-resolver/workspace-copy-path'
import { WorkspaceRepositoryLocalOperationError } from './workspace-repository-local-operation-error'

interface CopyWorkspaceRepositoryFilesInput {
	readonly snapshot: WorkspaceRepositoryActorSnapshot
}

export const copyWorkspaceRepositoryFiles = Effect.fn('workspace_repository.copy_files')(function* (
	input: CopyWorkspaceRepositoryFilesInput,
) {
	const fileSystem = yield* FileSystem.FileSystem
	const pathService = yield* Path.Path
	const snapshot = input.snapshot
	const storedSourcePath = snapshot.status.sourcePath
	if (storedSourcePath === null) {
		return yield* new WorkspaceRepositoryLocalOperationError({ message: 'Repository source path is missing' })
	}
	const storedMaterialization = snapshot.status.materialization
	if (storedMaterialization === null) {
		return yield* new WorkspaceRepositoryLocalOperationError({ message: 'Repository is not materialized' })
	}
	const source = yield* resolveWorkspacePath({ path: storedSourcePath })
	const materializationPath = yield* resolveWorkspacePath({ path: storedMaterialization.path })
	const sourceRoot = yield* fileSystem.realPath(source)
	const copied = new Set<string>()
	const copyRelativePath = (entry: string) =>
		Effect.gen(function* () {
			const normalized = normalizeWorkspaceRelativePath(entry)
			if (!isSafeWorkspaceRelativePath(normalized) || copied.has(normalized)) return
			const sourceFile = pathService.join(source, normalized)
			if (!(yield* fileSystem.exists(sourceFile))) return
			const resolvedSourceFile = yield* fileSystem.realPath(sourceFile)
			if (!isSafeWorkspaceRelativePath(pathService.relative(sourceRoot, resolvedSourceFile))) return
			const info = yield* fileSystem.stat(resolvedSourceFile)
			if (info.type !== 'File') return
			const destination = pathService.join(materializationPath, normalized)
			yield* fileSystem.makeDirectory(pathService.dirname(destination), { recursive: true })
			yield* fileSystem.copyFile(resolvedSourceFile, destination)
			copied.add(normalized)
		})

	const literalPaths = snapshot.repository.copyGlobs.filter((pattern) => !workspacePathHasGlobMagic(pattern))
	// The copied-file set is the result; avoid retaining one unused Effect result per matched file.
	yield* Effect.forEach(literalPaths, copyRelativePath, { concurrency: 8, discard: true })
	const globPatterns = snapshot.repository.copyGlobs.filter(workspacePathHasGlobMagic)
	const matches = yield* Effect.forEach(globPatterns, (pattern) => fileSystem.glob(pattern, { root: source }), {
		concurrency: 8,
	})
	yield* Effect.forEach(matches.flat(), copyRelativePath, { concurrency: 8, discard: true })
	const completedAt = yield* Clock.currentTimeMillis
	return WorkspaceRepositorySetupResult.cases.FilesCopied.make({
		result: { copiedFiles: [...copied], completedAt },
	})
})
