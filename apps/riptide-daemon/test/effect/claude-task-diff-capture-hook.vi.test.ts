import type { PostToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'
import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { createClaudeTaskDiffCaptureHook } from '../../src/agents/claudecode/hooks/task-diff-capture-hook'
import { TaskDiffServiceRegistry } from '../../src/effects/services/task-diff/task-diff-service-registry.service'
import { makeTaskDiffCaptureHarness } from '../helpers/task-diff-capture-harness'

const postToolUseInput = (agentId?: string): PostToolUseHookInput => ({
	hook_event_name: 'PostToolUse',
	session_id: 'sdk-session-1',
	transcript_path: '/tmp/transcript.jsonl',
	cwd: '/tmp/task-1/repo-1',
	tool_name: 'Bash',
	tool_input: { command: 'printf changed > changed.txt' },
	tool_response: { exitCode: 0 },
	tool_use_id: 'tool-use-1',
	...(agentId ? { agent_id: agentId, agent_type: 'general-purpose' } : {}),
})

describe('Claude task diff capture hook', () => {
	it.effect('schedules Bash capture with task/session identity and returns while capture is blocked', () =>
		Effect.gen(function* () {
			// The test owns this signal through the detached capture's release and disposal below.
			const signal = yield* Effect.abortSignal
			const harness = yield* makeTaskDiffCaptureHarness
			const hook = createClaudeTaskDiffCaptureHook({
				taskId: 'task-1',
				sessionId: 'session-1',
				requestCapture: () =>
					harness.runtime.runPromise(
						Effect.gen(function* () {
							const registry = yield* TaskDiffServiceRegistry
							yield* registry.requestCapture({ taskId: 'task-1', sessionId: 'session-1' })
						}),
					),
			})
			const hookPromise = hook(postToolUseInput(), 'tool-use-1', { signal })
			yield* harness.waitForCapture
			const returnedBeforeCapture = yield* Effect.promise(() =>
				Promise.race([
					hookPromise.then(() => true),
					new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
				]),
			)

			expect(returnedBeforeCapture).toBe(true)
			expect(signal.aborted).toBe(false)
			expect(harness.capturedRepos).toHaveLength(1)
			expect(harness.capturedRepos[0]).toMatchObject({ taskId: 'task-1', sessionId: 'session-1' })
			yield* harness.releaseAndDispose
			expect(signal.aborted).toBe(false)
		}),
	)
})
