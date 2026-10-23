import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { HookInput } from '@anthropic-ai/claude-agent-sdk'
import { hash } from 'ohash'
import { describe, expect, test } from 'vitest'

import type { ArtifactCollectionLike, ArtifactData } from '@/collections/types'
import { createArtifactSyncLedger, recordSyncedFile } from '@/lib/artifact-sync-ledger'
import type { ISyncManager } from '@/lib/sync-service'

import { createArtifactBashSyncHook } from '../../../../../src/agents/claudecode/hooks/artifact-bash-sync-hook'
import { createUniqueTempDir } from '../../../../helpers/concurrency'

const MOCK_CLOUD_ORIGIN = 'https://test.codelayer.cloud'
const sessionId = 'test-session-id'
const taskId = 'task-uuid'
const taskSlug = 'test-task'
const signal = new AbortController().signal

type UpsertCall = Parameters<ISyncManager['upsertArtifact']>[0]
type UploadCall = Omit<Parameters<ISyncManager['uploadS3Artifact']>[0], 'bytes'>

function createMockSyncManager(
	existing: Array<Partial<ArtifactData> & { file_name: string; content_hash: string }> = [],
) {
	const upserts: UpsertCall[] = []
	const uploads: UploadCall[] = []
	const rows = existing.map(
		(row, index) =>
			({
				id: `existing-${index}`,
				content: '',
				task_slug: taskSlug,
				storage_type: 'postgres',
				...row,
			}) as ArtifactData,
	)
	const collection: ArtifactCollectionLike = {
		toArray: rows,
		toArrayWhenReady: async () => rows,
		subscribeChanges: () => ({ unsubscribe: () => {} }),
	}
	const manager: ISyncManager = {
		upsertArtifact: async (input) => {
			upserts.push(input)
			return { artifactId: `text-${upserts.length}` }
		},
		uploadS3Artifact: async ({ bytes: _bytes, ...rest }) => {
			uploads.push(rest)
			return { artifactId: `binary-${uploads.length}` }
		},
		getCollection: () => collection,
	}
	return { manager, upserts, uploads }
}

const bashInput = {
	hook_event_name: 'PostToolUse',
	session_id: 'test-session',
	cwd: '/test/cwd',
	tool_name: 'Bash',
	tool_input: { command: 'cp /tmp/shot.png .humanlayer/tasks/test-task/shot.png' },
} as HookInput

async function withTaskDir<T>(fn: (ctx: { taskDir: string; cwd: string }) => Promise<T>): Promise<T> {
	const cwd = await createUniqueTempDir('artifact-bash-sync-hook-test')
	const taskDir = join(cwd, 'rpi', 'tasks', taskSlug)
	await mkdir(taskDir, { recursive: true })
	try {
		return await fn({ taskDir, cwd })
	} finally {
		await rm(cwd, { recursive: true, force: true })
	}
}

function createHook(manager: ISyncManager, cwd: string, ledger = createArtifactSyncLedger()) {
	return createArtifactBashSyncHook(manager, sessionId, cwd, taskId, taskSlug, {
		getArtifactCloudUrl: (artifactId) => `${MOCK_CLOUD_ORIGIN}/artifacts/${artifactId}`,
		ledger,
	})
}

describe('createArtifactBashSyncHook', () => {
	test('ignores events other than PostToolUse', async () => {
		await withTaskDir(async ({ taskDir, cwd }) => {
			await writeFile(join(taskDir, 'shot.png'), Buffer.from([1, 2, 3]))
			const { manager, uploads } = createMockSyncManager()
			const hook = createHook(manager, cwd)

			const result = await hook({ ...bashInput, hook_event_name: 'PreToolUse' } as HookInput, undefined, {
				signal,
			})

			expect(result).toEqual({ continue: true })
			expect(uploads).toHaveLength(0)
		})
	})

	test('uploads files that appeared in the task directory and reports their cloud URLs', async () => {
		await withTaskDir(async ({ taskDir, cwd }) => {
			await writeFile(join(taskDir, 'shot.png'), Buffer.from([1, 2, 3]))
			await writeFile(join(taskDir, 'notes.md'), '# notes')
			const { manager, uploads, upserts } = createMockSyncManager()
			const hook = createHook(manager, cwd)

			const result = await hook(bashInput, undefined, { signal })

			expect(uploads).toEqual([
				{ fileName: 'shot.png', contentType: 'image/png', contentHash: expect.any(String), fileSizeBytes: 3 },
			])
			expect(upserts).toHaveLength(1)
			expect(upserts[0]).toMatchObject({ fileName: 'notes.md', content: '# notes', operationType: 'Write' })
			expect(result).toEqual({
				continue: true,
				hookSpecificOutput: {
					hookEventName: 'PostToolUse',
					additionalContext: expect.stringContaining(`shot.png: ${MOCK_CLOUD_ORIGIN}/artifacts/binary-1`),
				},
			})
		})
	})

	test('skips files whose content the cloud already has and syncs the ones that differ', async () => {
		await withTaskDir(async ({ taskDir, cwd }) => {
			const sameBytes = Buffer.from([9, 9, 9])
			const sameHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', sameBytes)))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('')
			await writeFile(join(taskDir, 'same.png'), sameBytes)
			await writeFile(join(taskDir, 'plan.md'), 'new body')
			const { manager, uploads, upserts } = createMockSyncManager([
				{ file_name: 'same.png', content_hash: sameHash, storage_type: 's3' },
				{ file_name: 'plan.md', content_hash: hash('old body') },
			])
			const hook = createHook(manager, cwd)

			await hook(bashInput, undefined, { signal })

			expect(uploads).toHaveLength(0)
			expect(upserts).toHaveLength(1)
			expect(upserts[0]).toMatchObject({ fileName: 'plan.md', content: 'new body', operationType: 'Edit' })
		})
	})

	test('only rescans files whose fingerprint changed since the previous Bash call', async () => {
		await withTaskDir(async ({ taskDir, cwd }) => {
			await writeFile(join(taskDir, 'shot.png'), Buffer.from([1]))
			const { manager, uploads } = createMockSyncManager()
			const hook = createHook(manager, cwd)

			await hook(bashInput, undefined, { signal })
			const second = await hook(bashInput, undefined, { signal })
			expect(second).toEqual({ continue: true })
			expect(uploads).toHaveLength(1)

			await writeFile(join(taskDir, 'shot.png'), Buffer.from([1, 2]))
			await hook(bashInput, undefined, { signal })
			expect(uploads).toHaveLength(2)
			expect(uploads[1]).toMatchObject({ fileName: 'shot.png', fileSizeBytes: 2 })
		})
	})

	test('trusts files another hook already recorded in the shared ledger', async () => {
		await withTaskDir(async ({ taskDir, cwd }) => {
			const shotPath = join(taskDir, 'shot.png')
			await writeFile(shotPath, Buffer.from([1, 2, 3]))
			const ledger = createArtifactSyncLedger()
			await recordSyncedFile(ledger, 'shot.png', shotPath)
			const { manager, uploads } = createMockSyncManager()
			const hook = createHook(manager, cwd, ledger)

			const result = await hook(bashInput, undefined, { signal })

			expect(result).toEqual({ continue: true })
			expect(uploads).toHaveLength(0)
		})
	})

	test('ignores the trash directory and returns quietly when the task directory is empty', async () => {
		await withTaskDir(async ({ taskDir, cwd }) => {
			await mkdir(join(taskDir, '.trash'), { recursive: true })
			await writeFile(join(taskDir, '.trash', 'old.png'), Buffer.from([1]))
			const { manager, uploads } = createMockSyncManager()
			const hook = createHook(manager, cwd)

			const result = await hook(bashInput, undefined, { signal })

			expect(result).toEqual({ continue: true })
			expect(uploads).toHaveLength(0)
		})
	})
})
