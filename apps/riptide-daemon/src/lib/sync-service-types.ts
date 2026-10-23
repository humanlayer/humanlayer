import type { ArtifactCollectionLike } from '@/collections/types'

export interface ISyncManager {
	upsertArtifact(input: {
		fileName: string
		content: string
		operationType: 'Write' | 'Edit' | 'MultiEdit' | 'Read'
		operationContents: Record<string, unknown>
		frontmatter?: Record<string, unknown>
	}): Promise<{ artifactId: string; designQuestionsResolved?: boolean }>
	uploadS3Artifact(params: {
		fileName: string
		contentType: string
		contentHash: string
		fileSizeBytes: number
		bytes: ArrayBuffer
	}): Promise<{ artifactId: string }>
	getCollection(): ArtifactCollectionLike | undefined
}

export interface ISyncService {
	ensureTaskSync(taskId: string, cwd: string): Promise<ITaskSyncContext>
	shutdown(): void | Promise<void>
	getDebugState(): SyncServiceDebugState
}

export interface ITaskSyncContext {
	createSessionManager(sessionId: string): ISyncManager
	getCollection(): ArtifactCollectionLike | undefined
	getTaskSlug(): string | null
}

export interface SyncServiceDebugState {
	activeTaskIds: string[]
	registeredTaskIds: string[]
	pendingTaskIds: string[]
}
