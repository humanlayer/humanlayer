import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import type { ISyncManager } from '../../../../src/lib/sync-service'
import { createUniqueTempDir } from '../../../helpers/concurrency'
import { createMockHookServices } from '../../../mocks/daemon-services.mock'

const MOCK_CLOUD_ORIGIN = 'https://test.codelayer.cloud'
const taskId = 'task-uuid'
const taskSlug = 'test-task'

import { createArtifactSyncHook } from '../../../../src/agents/claudecode/hooks/artifact-sync-hook'

const MOCK_ARTIFACT_ID = 'mock-artifact-id'

/**
 * Create a minimal mock ISyncManager that returns a fixed artifactId.
 */
function createMockSyncManager(overrides?: Partial<ISyncManager>): ISyncManager {
	return {
		upsertArtifact: vi.fn(async () => ({ artifactId: MOCK_ARTIFACT_ID })),
		uploadS3Artifact: vi.fn(async () => ({ artifactId: MOCK_ARTIFACT_ID })),
		getCollection: () => undefined,
		...overrides,
	}
}

function createArtifactSyncHookForTest(
	syncManager: ISyncManager,
	sessionId: string,
	cwd: string,
	ticketId: string | null,
	ticketProvider: string | null,
	services: ReturnType<typeof createMockHookServices>,
) {
	return createArtifactSyncHook(syncManager, sessionId, cwd, taskId, taskSlug, ticketId, ticketProvider, services, {
		getArtifactCloudUrl: (artifactId) => `${MOCK_CLOUD_ORIGIN}/artifacts/${artifactId}`,
	})
}

describe('createArtifactSyncHook — integration paths', () => {
	const sessionId = 'test-session-id'

	async function withTestContext<T>(
		fn: (context: { testDir: string; rpiTasksDir: string }) => Promise<T>,
	): Promise<T> {
		const testDir = await createUniqueTempDir('artifact-sync-hook-test')
		const rpiTasksDir = join(testDir, 'rpi', 'tasks', taskSlug)
		await mkdir(rpiTasksDir, { recursive: true })
		try {
			return await fn({ testDir, rpiTasksDir })
		} finally {
			await rm(testDir, { recursive: true, force: true })
		}
	}

	test('calls createAttachment for linear ticketProvider', async () => {
		await withTestContext(async ({ testDir, rpiTasksDir }) => {
			const mockCreateAttachment = vi.fn(async () => ({ created: true }))
			const services = createMockHookServices({
				orpc: {
					integrations: { linear: { createAttachment: mockCreateAttachment } },
				},
			})
			const syncManager = createMockSyncManager()

			const hook = createArtifactSyncHookForTest(syncManager, sessionId, testDir, 'ENG-123', 'linear', services)

			const filePath = join(rpiTasksDir, 'research.md')
			await hook(
				{
					hook_event_name: 'PostToolUse',
					tool_name: 'Write',
					tool_input: {
						file_path: filePath,
						content: '# Research\n\nContent here.',
					},
					cwd: testDir,
				} as any,
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(mockCreateAttachment).toHaveBeenCalledTimes(1)
			expect(mockCreateAttachment).toHaveBeenCalledWith({
				issueId: 'ENG-123',
				url: `${MOCK_CLOUD_ORIGIN}/artifacts/${MOCK_ARTIFACT_ID}`,
				title: 'research.md',
			})
		})
	})

	test('calls createRemoteLink for jira ticketProvider', async () => {
		await withTestContext(async ({ testDir, rpiTasksDir }) => {
			const mockCreateRemoteLink = vi.fn(async () => ({ created: true }))
			const services = createMockHookServices({
				orpc: {
					integrations: { jira: { createRemoteLink: mockCreateRemoteLink } },
				},
			})
			const syncManager = createMockSyncManager()

			const hook = createArtifactSyncHookForTest(syncManager, sessionId, testDir, 'PROJ-456', 'jira', services)

			const filePath = join(rpiTasksDir, 'plan.md')
			await hook(
				{
					hook_event_name: 'PostToolUse',
					tool_name: 'Write',
					tool_input: {
						file_path: filePath,
						content: '# Plan\n\nContent here.',
					},
					cwd: testDir,
				} as any,
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(mockCreateRemoteLink).toHaveBeenCalledTimes(1)
			expect(mockCreateRemoteLink).toHaveBeenCalledWith({
				issueKey: 'PROJ-456',
				url: `${MOCK_CLOUD_ORIGIN}/artifacts/${MOCK_ARTIFACT_ID}`,
				title: 'plan.md',
				globalId: `system=codelayer&id=${MOCK_ARTIFACT_ID}`,
			})
		})
	})

	test('skips integration call when ticketId is null', async () => {
		await withTestContext(async ({ testDir, rpiTasksDir }) => {
			const mockCreateAttachment = vi.fn(async () => ({ created: true }))
			const mockCreateRemoteLink = vi.fn(async () => ({ created: true }))
			const services = createMockHookServices({
				orpc: {
					integrations: {
						linear: { createAttachment: mockCreateAttachment },
						jira: { createRemoteLink: mockCreateRemoteLink },
					},
				},
			})
			const syncManager = createMockSyncManager()

			const hook = createArtifactSyncHookForTest(syncManager, sessionId, testDir, null, null, services)

			const filePath = join(rpiTasksDir, 'research.md')
			await hook(
				{
					hook_event_name: 'PostToolUse',
					tool_name: 'Write',
					tool_input: {
						file_path: filePath,
						content: '# Content',
					},
					cwd: testDir,
				} as any,
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(mockCreateAttachment).not.toHaveBeenCalled()
			expect(mockCreateRemoteLink).not.toHaveBeenCalled()
		})
	})

	test('does not call linear createAttachment for jira ticketProvider', async () => {
		await withTestContext(async ({ testDir, rpiTasksDir }) => {
			const mockCreateAttachment = vi.fn(async () => ({ created: true }))
			const mockCreateRemoteLink = vi.fn(async () => ({ created: true }))
			const services = createMockHookServices({
				orpc: {
					integrations: {
						linear: { createAttachment: mockCreateAttachment },
						jira: { createRemoteLink: mockCreateRemoteLink },
					},
				},
			})
			const syncManager = createMockSyncManager()

			const hook = createArtifactSyncHookForTest(syncManager, sessionId, testDir, 'PROJ-456', 'jira', services)

			const filePath = join(rpiTasksDir, 'research.md')
			await hook(
				{
					hook_event_name: 'PostToolUse',
					tool_name: 'Write',
					tool_input: {
						file_path: filePath,
						content: '# Content',
					},
					cwd: testDir,
				} as any,
				undefined,
				{ signal: new AbortController().signal },
			)

			// Linear createAttachment must NOT be called for jira provider
			expect(mockCreateAttachment).not.toHaveBeenCalled()
			// Jira createRemoteLink SHOULD be called
			expect(mockCreateRemoteLink).toHaveBeenCalledTimes(1)
		})
	})

	test('does not call jira createRemoteLink for linear ticketProvider', async () => {
		await withTestContext(async ({ testDir, rpiTasksDir }) => {
			const mockCreateAttachment = vi.fn(async () => ({ created: true }))
			const mockCreateRemoteLink = vi.fn(async () => ({ created: true }))
			const services = createMockHookServices({
				orpc: {
					integrations: {
						linear: { createAttachment: mockCreateAttachment },
						jira: { createRemoteLink: mockCreateRemoteLink },
					},
				},
			})
			const syncManager = createMockSyncManager()

			const hook = createArtifactSyncHookForTest(syncManager, sessionId, testDir, 'ENG-123', 'linear', services)

			const filePath = join(rpiTasksDir, 'research.md')
			await hook(
				{
					hook_event_name: 'PostToolUse',
					tool_name: 'Write',
					tool_input: {
						file_path: filePath,
						content: '# Content',
					},
					cwd: testDir,
				} as any,
				undefined,
				{ signal: new AbortController().signal },
			)

			// Jira createRemoteLink must NOT be called for linear provider
			expect(mockCreateRemoteLink).not.toHaveBeenCalled()
			// Linear createAttachment SHOULD be called
			expect(mockCreateAttachment).toHaveBeenCalledTimes(1)
		})
	})

	test('linear attachment failure is non-blocking', async () => {
		await withTestContext(async ({ testDir, rpiTasksDir }) => {
			const mockCreateAttachment = vi.fn(async () => {
				throw new Error('API error')
			})
			const services = createMockHookServices({
				orpc: {
					integrations: { linear: { createAttachment: mockCreateAttachment } },
				},
			})
			const syncManager = createMockSyncManager()

			const hook = createArtifactSyncHookForTest(syncManager, sessionId, testDir, 'ENG-123', 'linear', services)

			const filePath = join(rpiTasksDir, 'research.md')
			// Should not throw
			const result = await hook(
				{
					hook_event_name: 'PostToolUse',
					tool_name: 'Write',
					tool_input: {
						file_path: filePath,
						content: '# Content',
					},
					cwd: testDir,
				} as any,
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(result).toEqual({
				continue: true,
				hookSpecificOutput: {
					hookEventName: 'PostToolUse',
					additionalContext: expect.any(String),
				},
			})
			expect(mockCreateAttachment).toHaveBeenCalledTimes(1)
		})
	})
})
