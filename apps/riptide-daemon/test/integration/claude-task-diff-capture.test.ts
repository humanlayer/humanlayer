import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { PostToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { createClaudeTaskDiffCaptureHook } from '../../src/agents/claudecode/hooks/task-diff-capture-hook'
import { TaskDiffServiceRegistry } from '../../src/effects/services/task-diff/task-diff-service-registry.service'
import { runClaudeTaskDiffCaptureFixture } from './helpers/claude-task-diff-capture-fixture'
import { runTaskDiffCaptureFixture } from './helpers/task-diff-capture-fixture'

describe('Claude task diff capture integration', () => {
	it.effect('publishes direct tool writes to local Durable Streams', () =>
		Effect.gen(function* () {
			const { files, baselines, versions } = yield* Effect.promise(() => runClaudeTaskDiffCaptureFixture())

			// `files` holds inserts only; the later edit to added.txt is an update.
			expect(files.map((file) => file.path).sort()).toEqual(['added.txt', 'modified.txt'])
			expect(files.every((file) => file.sessionId === 'session-fixture')).toBe(true)
			expect(new Set(versions.map((version) => version.id))).toHaveLength(3)
			for (const file of files) {
				expect(versions.some((version) => version.id === file.versionId)).toBe(true)
			}
			const bodies = versions.map((version) => version.content ?? '').join('\n')
			expect(bodies).toContain('added by Claude')
			expect(bodies).toContain('with another line')
			// Task-start bodies: the original modified.txt, and no body for the added file.
			const baselineByKey = new Map(baselines.map((baseline) => [baseline.fileKey, baseline]))
			expect(baselineByKey.get('repo-fixture:modified.txt')?.content).toBe('before\n')
			expect(baselineByKey.get('repo-fixture:added.txt')?.content).toBeNull()
		}),
	)

	it.effect('removes a captured directory from diff-files once it is ignored', () =>
		Effect.gen(function* () {
			const taskId = 'task-claude-ignored-fixture'
			const { files, deletes } = yield* Effect.promise(() =>
				runTaskDiffCaptureFixture({
					tempDirectoryPrefix: 'claude-task-diff-ignored-',
					organizationId: 'org-claude-fixture',
					taskId,
					hostId: 'host-claude-fixture',
					sessionId: 'session-fixture',
					capture: async ({ root, worktree, sessionId, runtime, waitForPublicationCounts }) => {
						const runHook = async (filePath: string) => {
							const input: PostToolUseHookInput = {
								hook_event_name: 'PostToolUse',
								session_id: 'sdk-session-fixture',
								transcript_path: join(root, 'transcript.jsonl'),
								cwd: worktree,
								tool_name: 'Write',
								tool_input: { file_path: filePath },
								tool_response: { success: true },
								tool_use_id: 'tool-use-fixture',
							}
							const hook = createClaudeTaskDiffCaptureHook({
								taskId,
								sessionId,
								requestCapture: () =>
									runtime.runPromise(
										Effect.gen(function* () {
											const registry = yield* TaskDiffServiceRegistry
											yield* registry.requestCapture({ taskId, sessionId })
										}),
									),
							})
							await hook(input, input.tool_use_id, { signal: new AbortController().signal })
						}
						// A tool writes deployment state before the repository ignores it.
						await mkdir(join(worktree, '.alchemy'), { recursive: true })
						await writeFile(join(worktree, '.alchemy', 'state.json'), '{"stage":"dev"}\n')
						await writeFile(join(worktree, 'modified.txt'), 'after\n')
						await runHook(join(worktree, '.alchemy', 'state.json'))
						await waitForPublicationCounts({ files: 2, versions: 2 })
						await writeFile(join(worktree, '.gitignore'), '.alchemy/\n')
						await runHook(join(worktree, '.gitignore'))
						// One insert for .gitignore and one delete for the ignored file.
						await waitForPublicationCounts({ files: 4, versions: 3 })
					},
				}),
			)

			expect(files.map((file) => file.path).sort()).toEqual(['.alchemy/state.json', '.gitignore', 'modified.txt'])
			expect(deletes).toEqual([`${taskId}:repo-fixture:.alchemy/state.json`])
		}),
	)
})
