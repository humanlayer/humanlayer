import { describe, expect, test } from 'vitest'

import { classifyTaskIntent, type TaskIntent } from '../../src/agents/classify-task-intent'
import { buildMatrix } from '../_lib/matrix'

const MATRIX = buildMatrix({
	anthropic: { label: 'anthropic-haiku', modelId: 'claude-haiku-4-5' },
	openai: { label: 'openai-gpt-5-mini', modelId: 'gpt-5-mini' },
})

const CASES: ReadonlyArray<{ text: string; expected: TaskIntent }> = [
	{ text: 'How does session auto-advance work?', expected: 'research' },
	{ text: 'Check the Sentry logs for failures in the task launch flow', expected: 'research' },
	{ text: 'Fetch issue ENG-1234 and summarize its acceptance criteria', expected: 'research' },
	{ text: 'Debug why the daemon loses sessions after reconnecting', expected: 'research' },
	{ text: "Let's make a plan for adding retry controls to the launcher", expected: 'design' },
	{ text: 'Fix the session reconnect bug', expected: 'implementation' },
	{ text: 'Change the launcher button copy to Start task', expected: 'implementation' },
	{ text: 'Build a settings page for notification rules', expected: 'implementation' },
	{ text: 'Investigate the failed test and fix the root cause', expected: 'implementation' },
	{ text: 'task stuff', expected: 'unknown' },
	{ text: 'hello', expected: 'unknown' },
]

if (MATRIX.length === 0) {
	describe('classify-task-intent', () => {
		test.skip('requires ANTHROPIC_API_KEY or OPENAI_API_KEY', () => {})
	})
}

for (const { label, model } of MATRIX) {
	describe(`classify-task-intent [${label}]`, () => {
		test.each(CASES)('$expected: $text', async ({ text, expected }) => {
			await expect(classifyTaskIntent(text, { model })).resolves.toBe(expected)
		})
	})
}
