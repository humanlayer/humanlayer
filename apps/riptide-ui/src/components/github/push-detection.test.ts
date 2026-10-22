import { describe, expect, test } from 'vitest'

import { isGitPushToolCall, latestGitPushEventId } from './push-detection'

const bash = (command: string, isCompleted = true) => ({
	toolName: 'Bash',
	toolInputJson: JSON.stringify({ command, description: 'run' }),
	isCompleted,
})

describe('isGitPushToolCall', () => {
	test.each([
		'git push',
		'git push -u origin fix-flaky-retry',
		'git push --force-with-lease',
		'cd foo && git push',
		'git commit -am "x" && git push -u origin fix-flaky-retry',
		'git  push origin HEAD',
		'echo "git push"',
	])('recognises %s', (command) => {
		expect(isGitPushToolCall(bash(command))).toBe(true)
	})

	test.each(['gh pr create --draft --fill', 'git pull', 'git pushd', 'bun run test', 'gitx push'])(
		'ignores %s',
		(command) => {
			expect(isGitPushToolCall(bash(command))).toBe(false)
		},
	)

	test('waits for the push to finish', () => {
		expect(isGitPushToolCall(bash('git push', false))).toBe(false)
		expect(isGitPushToolCall({ ...bash('git push'), isCompleted: undefined })).toBe(false)
	})

	test('only reads Bash calls', () => {
		expect(isGitPushToolCall({ ...bash('git push'), toolName: 'Edit' })).toBe(false)
		expect(isGitPushToolCall({ toolName: 'Bash', isCompleted: true })).toBe(false)
	})

	test('survives input that is not JSON or has no command', () => {
		expect(isGitPushToolCall({ toolName: 'Bash', toolInputJson: 'git push', isCompleted: true })).toBe(false)
		expect(isGitPushToolCall({ toolName: 'Bash', toolInputJson: '{"file":"git push"}', isCompleted: true })).toBe(
			false,
		)
		expect(isGitPushToolCall({ toolName: 'Bash', toolInputJson: '"git push"', isCompleted: true })).toBe(false)
	})
})

describe('latestGitPushEventId', () => {
	test('names the last completed push, skipping a later push that is still running', () => {
		expect(
			latestGitPushEventId([
				{ id: 'e1', ...bash('git push') },
				{ id: 'e2', ...bash('bun test') },
				{ id: 'e3', ...bash('git push --force-with-lease') },
				{ id: 'e4', ...bash('git push', false) },
			]),
		).toBe('e3')
	})

	test('is null when nothing pushed', () => {
		expect(latestGitPushEventId([{ id: 'e1', ...bash('git pull') }])).toBeNull()
		expect(latestGitPushEventId([])).toBeNull()
	})
})
