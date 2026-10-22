import { describe, expect, it } from 'vitest'

import { askSummary, changesFiles, editCounts, latestTodos, turnWrites } from '@/minimalist/lib/tools'
import type { ToolStep } from '@/minimalist/lib/transcript'

describe('changesFiles', () => {
	it('counts edit tools', () => {
		expect(changesFiles('Edit', {})).toBe(true)
		expect(changesFiles('MultiEdit', {})).toBe(true)
	})

	it('counts shell commands that write files', () => {
		for (const command of [
			"echo 'Third line.' >> README",
			'sed -i "" s/a/b/ x.ts',
			'cat x | tee out.txt',
			'git apply p.diff',
			'cd src && rm old.ts',
		])
			expect(changesFiles('Bash', { command })).toBe(true)
	})

	it('ignores reads and discarded output', () => {
		for (const command of [
			'cat README',
			'git status 2>&1',
			'ls > /dev/null',
			'grep -rn foo src 2>/dev/null',
			'bun test',
		])
			expect(changesFiles('Bash', { command })).toBe(false)
		expect(changesFiles('Read', { file_path: 'x' })).toBe(false)
	})
})

describe('editCounts', () => {
	const step = (name: string, input: Record<string, unknown>) => ({ name, input }) as unknown as ToolStep

	it('counts changed lines, not the context around them', () => {
		expect(editCounts(step('Edit', { old_string: 'a\nb', new_string: 'a\nb\nc' }))).toEqual({
			added: 1,
			removed: 0,
		})
		expect(editCounts(step('Edit', { old_string: 'a\nb\nc', new_string: 'a\nB\nc' }))).toEqual({
			added: 1,
			removed: 1,
		})
		expect(editCounts(step('Write', { content: 'apple\n' }))).toEqual({ added: 1, removed: 0 })
	})
})

describe('askSummary', () => {
	it('names the command, file or tool the agent is waiting on', () => {
		expect(askSummary('Bash', { command: 'bun run db:migrate\necho done' })).toEqual({
			text: 'Wants to run',
			code: 'bun run db:migrate',
		})
		expect(askSummary('Edit', { file_path: '/repo/src/host-status.ts' })).toEqual({
			text: 'Wants to edit',
			code: 'host-status.ts',
		})
		expect(askSummary('mcp__linear__create_issue', {})).toEqual({
			text: 'Wants to use',
			code: 'mcp__linear__create_issue',
		})
	})

	it('reads questions and plans as plain words', () => {
		expect(askSummary('AskUserQuestion', {})).toEqual({ text: 'Asked a question', code: null })
		expect(askSummary('ExitPlanMode', {})).toEqual({ text: 'Plan ready for review', code: null })
		expect(askSummary('Bash', {})).toEqual({ text: 'Wants to run a command', code: null })
	})
})

describe('turnWrites', () => {
	const tool = (name: string, input: Record<string, unknown>, isError = false) =>
		({ kind: 'tool', id: `${name}${JSON.stringify(input)}`, name, input, isError }) as unknown as ToolStep

	it('sums lines per file and sets task documents apart', () => {
		const { docs, files } = turnWrites([
			tool('Edit', { file_path: '/r/a.ts', old_string: 'x', new_string: 'y' }),
			tool('Read', { file_path: '/r/b.ts' }),
			tool('Write', { file_path: '/r/a.ts', content: 'one\ntwo\n' }),
			tool('Write', { file_path: '/r/.humanlayer/tasks/t/plan.md', content: '# Plan' }),
		])
		expect(docs).toEqual(['plan.md'])
		expect(files).toEqual([{ path: '/r/a.ts', added: 3, removed: 1 }])
	})

	it('leaves out edits that failed or were denied', () => {
		expect(turnWrites([tool('Edit', { file_path: '/r/a.ts', old_string: 'x', new_string: 'y' }, true)])).toEqual({
			docs: [],
			files: [],
		})
	})
})

describe('latestTodos', () => {
	const todos = (items: Array<[string, string]>) =>
		({
			kind: 'tool',
			name: 'TodoWrite',
			input: { todos: items.map(([content, status]) => ({ content, status })) },
		}) as unknown as ToolStep

	it('reads the last todo update', () => {
		expect(
			latestTodos([
				todos([['Read', 'in_progress']]),
				todos([
					['Read', 'completed'],
					['Write', 'bogus'],
				]),
			]),
		).toEqual([
			{ content: 'Read', status: 'completed' },
			{ content: 'Write', status: 'pending' },
		])
		expect(latestTodos([])).toEqual([])
	})
})
