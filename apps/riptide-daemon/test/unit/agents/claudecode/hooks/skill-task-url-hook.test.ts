import type { HookInput } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, test } from 'vitest'

const MOCK_CLOUD_ORIGIN = 'https://test.codelayer.cloud'

import { createSkillTaskUrlHook } from '../../../../../src/agents/claudecode/hooks/skill-task-url-hook'

function createHookInput(overrides: Partial<HookInput> = {}): HookInput {
	return {
		hook_event_name: 'PostToolUse',
		session_id: 'test-session',
		cwd: '/test/cwd',
		tool_input: {},
		...overrides,
	} as HookInput
}

describe('createSkillTaskUrlHook', () => {
	describe('null taskId', () => {
		test('no-ops immediately when taskId is null', async () => {
			const hook = createSkillTaskUrlHook(null, {
				getTaskArtifactsCloudUrl: (taskId) => `${MOCK_CLOUD_ORIGIN}/tasks/${taskId}/artifacts`,
				getTaskDeepLinkUrl: (taskId) => `${MOCK_CLOUD_ORIGIN}/deep/tasks/${taskId}`,
			})
			const result = await hook(
				createHookInput({
					tool_name: 'Skill',
					tool_input: { skill: 'rpi:describe-pr' },
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)
			expect(result).toEqual({ continue: true })
		})
	})

	describe('event filtering', () => {
		test('skips non-PostToolUse events', async () => {
			const hook = createSkillTaskUrlHook('task-123', {
				getTaskArtifactsCloudUrl: (taskId) => `${MOCK_CLOUD_ORIGIN}/tasks/${taskId}/artifacts`,
				getTaskDeepLinkUrl: (taskId) => `${MOCK_CLOUD_ORIGIN}/deep/tasks/${taskId}`,
			})
			const result = await hook(createHookInput({ hook_event_name: 'PreToolUse' as any }), undefined, {
				signal: new AbortController().signal,
			})
			expect(result).toEqual({ continue: true })
		})
	})

	describe('tool filtering', () => {
		test('skips non-Skill tools', async () => {
			const hook = createSkillTaskUrlHook('task-123', {
				getTaskArtifactsCloudUrl: (taskId) => `${MOCK_CLOUD_ORIGIN}/tasks/${taskId}/artifacts`,
				getTaskDeepLinkUrl: (taskId) => `${MOCK_CLOUD_ORIGIN}/deep/tasks/${taskId}`,
			})
			const result = await hook(
				createHookInput({
					tool_name: 'Write',
					tool_input: { file_path: '/test/file.md' },
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)
			expect(result).toEqual({ continue: true })
		})
	})

	describe('skill filtering', () => {
		test('skips non-describe-pr skills', async () => {
			const hook = createSkillTaskUrlHook('task-123', {
				getTaskArtifactsCloudUrl: (taskId) => `${MOCK_CLOUD_ORIGIN}/tasks/${taskId}/artifacts`,
				getTaskDeepLinkUrl: (taskId) => `${MOCK_CLOUD_ORIGIN}/deep/tasks/${taskId}`,
			})
			const result = await hook(
				createHookInput({
					tool_name: 'Skill',
					tool_input: { skill: 'rpi:create-research' },
				} as any),
				undefined,
				{ signal: new AbortController().signal },
			)
			expect(result).toEqual({ continue: true })
		})
	})

	describe('successful URL provision', () => {
		test('returns task context for rpi:describe-pr', async () => {
			const hook = createSkillTaskUrlHook('task-abc-123', {
				getTaskArtifactsCloudUrl: (taskId) => `${MOCK_CLOUD_ORIGIN}/tasks/${taskId}/artifacts`,
				getTaskDeepLinkUrl: (taskId) => `${MOCK_CLOUD_ORIGIN}/deep/tasks/${taskId}`,
			})
			const result = await hook(
				createHookInput({
					tool_name: 'Skill',
					tool_input: { skill: 'rpi:describe-pr' },
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
		})
	})
})
