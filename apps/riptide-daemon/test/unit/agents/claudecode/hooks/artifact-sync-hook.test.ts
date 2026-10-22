import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { HookInput } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, test, vi } from 'vitest'

import type { ISyncManager } from '@/lib/sync-service'

import { createArtifactSyncHook } from '../../../../../src/agents/claudecode/hooks/artifact-sync-hook'
import type { HookServices } from '../../../../../src/agents/claudecode/types'
import { createUniqueTempDir } from '../../../../helpers/concurrency'

const MOCK_CLOUD_ORIGIN = 'https://test.codelayer.cloud'
const sessionId = 'test-session-id'
const taskId = 'task-uuid'
const taskSlug = 'test-task'
const cwd = '/test/project'
function createMockSyncManager(): ISyncManager & { calls: Array<Parameters<ISyncManager['upsertArtifact']>[0]> } {
	const calls: Array<Parameters<ISyncManager['upsertArtifact']>[0]> = []
	return {
		calls,
		upsertArtifact: async (input) => {
			calls.push(input)
			return { artifactId: 'mock-artifact-id' }
		},
		uploadS3Artifact: async () => ({ artifactId: 'mock-s3-artifact-id' }),
		getCollection: () => undefined,
	}
}

function createHookInput(overrides: Partial<HookInput> = {}): HookInput {
	return {
		hook_event_name: 'PostToolUse',
		session_id: 'test-session',
		cwd: '/test/cwd',
		tool_input: {},
		...overrides,
	} as HookInput
}

function createNoopServices(): HookServices {
	return {
		orpc: {
			integrations: {
				github: { syncArtifactBacklink: vi.fn(() => Promise.resolve({ synced: true })) },
				jira: { createRemoteLink: vi.fn(() => Promise.resolve({ created: true })) },
				linear: { createAttachment: vi.fn(() => Promise.resolve({ created: true })) },
			},
		} as unknown as HookServices['orpc'],
	}
}

function createArtifactSyncHookForTest(
	manager: ISyncManager,
	sessionId: string,
	cwd: string,
	ticketId: string | null,
	ticketProvider: string | null,
	services: HookServices,
) {
	return createArtifactSyncHook(manager, sessionId, cwd, taskId, taskSlug, ticketId, ticketProvider, services, {
		getArtifactCloudUrl: (artifactId) => `${MOCK_CLOUD_ORIGIN}/artifacts/${artifactId}`,
	})
}

async function withArtifactSyncHookTest<T>(
	fn: (ctx: {
		testDir: string
		createHook: (manager: ISyncManager) => ReturnType<typeof createArtifactSyncHook>
	}) => Promise<T>,
): Promise<T> {
	const testDir = await createUniqueTempDir('artifact-sync-hook-test')
	await mkdir(join(testDir, 'rpi', 'tasks', taskSlug), { recursive: true })

	try {
		return await fn({
			testDir,
			createHook: (manager) =>
				createArtifactSyncHookForTest(manager, sessionId, testDir, null, null, createNoopServices()),
		})
	} finally {
		await rm(testDir, { recursive: true, force: true })
	}
}

describe('createArtifactSyncHook', () => {
	describe('event filtering', () => {
		test('skips non-PostToolUse events', async () => {
			const manager = createMockSyncManager()
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, null, createNoopServices())

			const result = await hook(createHookInput({ hook_event_name: 'PreToolUse' as any }), undefined, {
				signal: new AbortController().signal,
			})

			expect(result).toEqual({ continue: true })
			expect(manager.calls).toHaveLength(0)
		})
	})

	describe('path filtering', () => {
		test('skips when file_path is missing', async () => {
			const manager = createMockSyncManager()
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, null, createNoopServices())

			const result = await hook(createHookInput({ tool_input: { content: 'test' } }), undefined, {
				signal: new AbortController().signal,
			})

			expect(result).toEqual({ continue: true })
			expect(manager.calls).toHaveLength(0)
		})

		test('skips paths not in rpi/ directory', async () => {
			const manager = createMockSyncManager()
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, null, createNoopServices())

			const result = await hook(
				createHookInput({ tool_input: { file_path: '/test/project/src/index.ts' } }),
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(result).toEqual({ continue: true })
			expect(manager.calls).toHaveLength(0)
		})

		test('reports and skips a write in the task trash root', async () => {
			const manager = createMockSyncManager()
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, null, createNoopServices())

			const result = await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/.humanlayer/tasks/${taskSlug}/.trash/plan.md`,
						content: '# Deleted plan',
					},
					tool_name: 'Write',
				} as any),
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
			expect(manager.calls).toHaveLength(0)
		})
	})

	describe('Write tool handling', () => {
		test.each([
			['data.json', '{"enabled":true}'],
			['events.jsonl', '{"event":1}\n{"event":2}\n'],
		])('syncs %s through the text upsert path', async (fileName, content) => {
			const manager = createMockSyncManager()
			const uploadS3Artifact = vi.fn(async () => ({ artifactId: 'mock-s3-artifact-id' }))
			manager.uploadS3Artifact = uploadS3Artifact
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, null, createNoopServices())

			await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/${fileName}`,
						content,
					},
					tool_name: 'Write',
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(manager.calls).toHaveLength(1)
			expect(manager.calls[0]).toMatchObject({ fileName, content, operationType: 'Write' })
			expect(uploadS3Artifact).not.toHaveBeenCalled()
		})

		test('calls upsertArtifact with content from tool_input for Write', async () => {
			const manager = createMockSyncManager()
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, null, createNoopServices())

			const result = await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/test.md`,
						content: '# Test Content',
					},
					tool_name: 'Write',
				} as any),
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
			expect(manager.calls).toHaveLength(1)
			expect(manager.calls[0]).toEqual({
				fileName: 'test.md',
				content: '# Test Content',
				frontmatter: {},
				operationType: 'Write',
				operationContents: {
					file_path: `${cwd}/rpi/tasks/${taskSlug}/test.md`,
					content: '# Test Content',
				},
			})
		})

		test('skips Write when content is missing', async () => {
			const manager = createMockSyncManager()
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, null, createNoopServices())

			const result = await hook(
				createHookInput({
					tool_input: { file_path: `${cwd}/rpi/tasks/${taskSlug}/test.md` },
					tool_name: 'Write',
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(result).toEqual({ continue: true })
			expect(manager.calls).toHaveLength(0)
		})
	})

	describe('Edit tool handling', () => {
		test('syncs JSON through the text upsert path', async () => {
			await withArtifactSyncHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				const uploadS3Artifact = vi.fn(async () => ({ artifactId: 'mock-s3-artifact-id' }))
				manager.uploadS3Artifact = uploadS3Artifact
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, 'edited.json')
				const content = '{\n  "edited": true\n}\n'
				await writeFile(filePath, content)

				await createHook(manager)(
					createHookInput({
						tool_input: { file_path: filePath, old_string: 'false', new_string: 'true' },
						tool_name: 'Edit',
					}),
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(manager.calls).toHaveLength(1)
				expect(manager.calls[0]).toMatchObject({ fileName: 'edited.json', content, operationType: 'Edit' })
				expect(uploadS3Artifact).not.toHaveBeenCalled()
			})
		})

		test('calls upsertArtifact with content read from disk for Edit', async () => {
			await withArtifactSyncHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, 'edited.md')
				await writeFile(filePath, '# Edited Content')
				const hook = createHook(manager)

				const result = await hook(
					createHookInput({
						tool_input: {
							file_path: filePath,
							old_string: 'old',
							new_string: 'new',
						},
						tool_name: 'Edit',
					} as any),
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
				expect(manager.calls).toHaveLength(1)
				expect(manager.calls[0]).toMatchObject({
					fileName: 'edited.md',
					content: '# Edited Content',
					operationType: 'Edit',
				})
			})
		})
	})

	describe('MultiEdit tool handling', () => {
		test('syncs JSON through the text upsert path', async () => {
			await withArtifactSyncHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				const uploadS3Artifact = vi.fn(async () => ({ artifactId: 'mock-s3-artifact-id' }))
				manager.uploadS3Artifact = uploadS3Artifact
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, 'multi.json')
				const content = '{"first":true,"second":true}\n'
				await writeFile(filePath, content)

				await createHook(manager)(
					createHookInput({
						tool_input: { file_path: filePath, edits: [] },
						tool_name: 'MultiEdit',
					}),
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(manager.calls).toHaveLength(1)
				expect(manager.calls[0]).toMatchObject({ fileName: 'multi.json', content, operationType: 'MultiEdit' })
				expect(uploadS3Artifact).not.toHaveBeenCalled()
			})
		})

		test('calls upsertArtifact with content read from disk for MultiEdit', async () => {
			await withArtifactSyncHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, 'multi.md')
				await writeFile(filePath, '# Multi Edit Content')
				const hook = createHook(manager)

				const result = await hook(
					createHookInput({
						tool_input: {
							file_path: filePath,
							edits: [{ old_string: 'a', new_string: 'b' }],
						},
						tool_name: 'MultiEdit',
					} as any),
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
				expect(manager.calls).toHaveLength(1)
				expect(manager.calls[0]).toMatchObject({
					fileName: 'multi.md',
					content: '# Multi Edit Content',
					operationType: 'MultiEdit',
				})
			})
		})
	})

	describe('fileName extraction', () => {
		test('preserves nested subpath from artifact path', async () => {
			const manager = createMockSyncManager()
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, null, createNoopServices())

			await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/deep/nested/research.md`,
						content: 'content',
					},
					tool_name: 'Write',
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(manager.calls).toHaveLength(1)
			expect(manager.calls[0]?.fileName).toBe('deep/nested/research.md')
		})

		test('preserves nested subpath from humanlayer task path', async () => {
			const manager = createMockSyncManager()
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, null, createNoopServices())

			await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/.humanlayer/tasks/${taskSlug}/research/plan.md`,
						content: 'content',
					},
					tool_name: 'Write',
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(manager.calls).toHaveLength(1)
			expect(manager.calls[0]?.fileName).toBe('research/plan.md')
		})
	})

	describe('error handling', () => {
		test('returns continue: true on error (non-blocking)', async () => {
			const manager: ISyncManager = {
				upsertArtifact: async () => {
					throw new Error('API Error')
				},
				uploadS3Artifact: async () => ({ artifactId: 'mock-s3-artifact-id' }),
				getCollection: () => undefined,
			}
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, null, createNoopServices())

			const result = await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/test.md`,
						content: 'content',
					},
					tool_name: 'Write',
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(result).toEqual({ continue: true })
		})
	})

	describe('abort signal', () => {
		test('skips when signal is aborted', async () => {
			const manager = createMockSyncManager()
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, null, createNoopServices())
			const abortController = new AbortController()
			abortController.abort()

			const result = await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/test.md`,
						content: 'content',
					},
					tool_name: 'Write',
				} as any),
				undefined,
				{ signal: abortController.signal },
			)

			expect(result).toEqual({ continue: true })
			expect(manager.calls).toHaveLength(0)
		})
	})

	describe('frontmatter parsing', () => {
		test('parses YAML frontmatter from Write content and passes to upsertArtifact', async () => {
			await withArtifactSyncHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				const hook = createHook(manager)

				await hook(
					createHookInput({
						tool_input: {
							file_path: `${testDir}/rpi/tasks/${taskSlug}/research.md`,
							content: '---\ntype: research\nstatus: complete\n---\n# Research',
						},
						tool_name: 'Write',
					}),
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(manager.calls).toHaveLength(1)
				expect(manager.calls[0]!.frontmatter).toEqual({ type: 'research', status: 'complete' })
			})
		})

		test('passes empty frontmatter for content without YAML frontmatter', async () => {
			await withArtifactSyncHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				const hook = createHook(manager)

				await hook(
					createHookInput({
						tool_input: {
							file_path: `${testDir}/rpi/tasks/${taskSlug}/plain.md`,
							content: '# No frontmatter here',
						},
						tool_name: 'Write',
					}),
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(manager.calls).toHaveLength(1)
				expect(manager.calls[0]!.frontmatter).toEqual({})
			})
		})
	})

	describe('Linear attachment', () => {
		test('calls createAttachment when ticketProvider is linear', async () => {
			const manager = createMockSyncManager()
			const mockCreateAttachment = vi.fn(() => Promise.resolve({ created: true }))
			const services: HookServices = {
				orpc: {
					integrations: {
						jira: { createRemoteLink: vi.fn(() => Promise.resolve({ created: true })) },
						linear: { createAttachment: mockCreateAttachment },
					},
				} as unknown as HookServices['orpc'],
			}
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, 'ENG-123', 'linear', services)

			await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/research.md`,
						content: '# Research',
					},
					tool_name: 'Write',
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(mockCreateAttachment).toHaveBeenCalledWith({
				issueId: 'ENG-123',
				url: `${MOCK_CLOUD_ORIGIN}/artifacts/mock-artifact-id`,
				title: 'research.md',
			})
		})

		test('skips Linear attachment when ticketId is null', async () => {
			const manager = createMockSyncManager()
			const mockCreateAttachment = vi.fn(() => Promise.resolve({ created: true }))
			const services: HookServices = {
				orpc: {
					integrations: {
						jira: { createRemoteLink: vi.fn(() => Promise.resolve({ created: true })) },
						linear: { createAttachment: mockCreateAttachment },
					},
				} as unknown as HookServices['orpc'],
			}
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, 'linear', services)

			await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/research.md`,
						content: '# Research',
					},
					tool_name: 'Write',
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(mockCreateAttachment).not.toHaveBeenCalled()
		})

		test('artifact sync succeeds even when createAttachment throws', async () => {
			const manager = createMockSyncManager()
			const mockCreateAttachment = vi.fn(() => {
				throw new Error('Linear API Error')
			})
			const services: HookServices = {
				orpc: {
					integrations: {
						jira: { createRemoteLink: vi.fn(() => Promise.resolve({ created: true })) },
						linear: { createAttachment: mockCreateAttachment },
					},
				} as unknown as HookServices['orpc'],
			}
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, 'ENG-123', 'linear', services)

			const result = await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/research.md`,
						content: '# Research',
					},
					tool_name: 'Write',
				} as any),
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
			expect(manager.calls).toHaveLength(1)
		})
	})

	describe('Jira remote link attachment', () => {
		test('skips Linear attachment when ticketProvider is jira', async () => {
			const manager = createMockSyncManager()
			const mockCreateAttachment = vi.fn(() => Promise.resolve({ created: true }))
			const mockJiraCreateRemoteLink = vi.fn(() => Promise.resolve({ created: true }))
			const services: HookServices = {
				orpc: {
					integrations: {
						jira: { createRemoteLink: mockJiraCreateRemoteLink },
						linear: { createAttachment: mockCreateAttachment },
					},
				} as unknown as HookServices['orpc'],
			}
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, 'PROJ-456', 'jira', services)

			await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/research.md`,
						content: '# Research',
					},
					tool_name: 'Write',
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(mockCreateAttachment).not.toHaveBeenCalled()
		})

		test('calls createRemoteLink when ticketProvider is jira', async () => {
			const manager = createMockSyncManager()
			const mockJiraCreateRemoteLink = vi.fn(() => Promise.resolve({ created: true }))
			const services: HookServices = {
				orpc: {
					integrations: {
						jira: { createRemoteLink: mockJiraCreateRemoteLink },
						linear: { createAttachment: vi.fn(() => Promise.resolve({ created: true })) },
					},
				} as unknown as HookServices['orpc'],
			}
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, 'PROJ-456', 'jira', services)

			const result = await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/research.md`,
						content: '# Research',
					},
					tool_name: 'Write',
				} as any),
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
			expect(mockJiraCreateRemoteLink).toHaveBeenCalledTimes(1)
			expect(mockJiraCreateRemoteLink).toHaveBeenCalledWith({
				issueKey: 'PROJ-456',
				url: `${MOCK_CLOUD_ORIGIN}/artifacts/mock-artifact-id`,
				title: 'research.md',
				globalId: 'system=codelayer&id=mock-artifact-id',
			})
		})

		test('skips Jira link when ticketProvider is not jira', async () => {
			const manager = createMockSyncManager()
			const mockJiraCreateRemoteLink = vi.fn(() => Promise.resolve({ created: true }))
			const services: HookServices = {
				orpc: {
					integrations: {
						jira: { createRemoteLink: mockJiraCreateRemoteLink },
						linear: { createAttachment: vi.fn(() => Promise.resolve({ created: true })) },
					},
				} as unknown as HookServices['orpc'],
			}
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, 'ENG-123', 'linear', services)

			await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/research.md`,
						content: '# Research',
					},
					tool_name: 'Write',
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(mockJiraCreateRemoteLink).not.toHaveBeenCalled()
		})

		test('skips Jira link when ticketId is null', async () => {
			const manager = createMockSyncManager()
			const mockJiraCreateRemoteLink = vi.fn(() => Promise.resolve({ created: true }))
			const services: HookServices = {
				orpc: {
					integrations: {
						jira: { createRemoteLink: mockJiraCreateRemoteLink },
						linear: { createAttachment: vi.fn(() => Promise.resolve({ created: true })) },
					},
				} as unknown as HookServices['orpc'],
			}
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, null, 'jira', services)

			await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/research.md`,
						content: '# Research',
					},
					tool_name: 'Write',
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(mockJiraCreateRemoteLink).not.toHaveBeenCalled()
		})

		test('artifact sync succeeds even when createRemoteLink throws', async () => {
			const manager = createMockSyncManager()
			const mockJiraCreateRemoteLink = vi.fn(() => {
				throw new Error('Jira API Error')
			})
			const services: HookServices = {
				orpc: {
					integrations: {
						jira: { createRemoteLink: mockJiraCreateRemoteLink },
						linear: { createAttachment: vi.fn(() => Promise.resolve({ created: true })) },
					},
				} as unknown as HookServices['orpc'],
			}
			const hook = createArtifactSyncHookForTest(manager, sessionId, cwd, 'PROJ-456', 'jira', services)

			const result = await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/research.md`,
						content: '# Research',
					},
					tool_name: 'Write',
				} as any),
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
			expect(manager.calls).toHaveLength(1)
			expect(mockJiraCreateRemoteLink).toHaveBeenCalledTimes(1)
		})
	})

	describe('GitHub artifact backlink', () => {
		test('dispatches the task notification and preserves artifact sync on failure', async () => {
			const manager = createMockSyncManager()
			const syncArtifactBacklink = vi.fn(() => Promise.reject(new Error('GitHub unavailable')))
			const hook = createArtifactSyncHook(
				manager,
				sessionId,
				cwd,
				taskId,
				taskSlug,
				'42',
				'github',
				createNoopServices(),
				{
					getArtifactCloudUrl: (artifactId) => `${MOCK_CLOUD_ORIGIN}/artifacts/${artifactId}`,
					syncGitHubArtifactBacklink: syncArtifactBacklink,
				},
			)

			const result = await hook(
				createHookInput({
					tool_input: {
						file_path: `${cwd}/rpi/tasks/${taskSlug}/research.md`,
						content: '# Research',
					},
					tool_name: 'Write',
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)

			expect(syncArtifactBacklink).toHaveBeenCalledWith({ taskId })
			expect(manager.calls).toHaveLength(1)
			expect(result).toMatchObject({ continue: true })
		})
	})
})
