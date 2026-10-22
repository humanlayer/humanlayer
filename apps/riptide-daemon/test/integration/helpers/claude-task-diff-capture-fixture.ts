import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { PostToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import { Effect } from 'effect'

import { createClaudeTaskDiffCaptureHook } from '../../../src/agents/claudecode/hooks/task-diff-capture-hook'
import { TaskDiffServiceRegistry } from '../../../src/effects/services/task-diff/task-diff-service-registry.service'
import { runTaskDiffCaptureFixture, type TaskDiffCaptureFixtureResult } from './task-diff-capture-fixture'

export type ClaudeTaskDiffCaptureFixtureResult = TaskDiffCaptureFixtureResult

/** Runs a fixture Claude PostToolUse callback through real Git capture and local Durable Streams. */
export const runClaudeTaskDiffCaptureFixture = async (agentId?: string): Promise<ClaudeTaskDiffCaptureFixtureResult> =>
	runTaskDiffCaptureFixture({
		tempDirectoryPrefix: 'claude-task-diff-capture-',
		organizationId: 'org-claude-fixture',
		taskId: 'task-claude-fixture',
		hostId: 'host-claude-fixture',
		sessionId: 'session-fixture',
		capture: async ({ root, worktree, taskId, sessionId, runtime, waitForPublicationCounts }) => {
			await writeFile(join(worktree, 'modified.txt'), 'after\n')
			await writeFile(join(worktree, 'added.txt'), 'added by Claude\n')
			const input: PostToolUseHookInput = {
				hook_event_name: 'PostToolUse',
				session_id: 'sdk-session-fixture',
				transcript_path: join(root, 'transcript.jsonl'),
				cwd: worktree,
				tool_name: 'Write',
				tool_input: { file_path: join(worktree, 'added.txt') },
				tool_response: { success: true },
				tool_use_id: 'tool-use-fixture',
				...(agentId ? { agent_id: agentId, agent_type: 'general-purpose' } : {}),
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
			await waitForPublicationCounts({ files: 2, versions: 2 })
			// An unchanged worktree publishes nothing new.
			await hook(input, input.tool_use_id, { signal: new AbortController().signal })
			await writeFile(join(worktree, 'added.txt'), 'added by Claude\nwith another line\n')
			await hook(input, input.tool_use_id, { signal: new AbortController().signal })
			await waitForPublicationCounts({ files: 3, versions: 3 })
		},
	})
