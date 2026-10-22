import { describe, expect, it } from 'vitest'

import {
	parseToolInput,
	type BashToolInput,
	type EditToolInput,
	type ReadToolInput,
	type WriteToolInput,
} from './types'

describe('Fold tool input compatibility', () => {
	it('normalizes Fold file and timeout input names used by specialized renderers', () => {
		const read = parseToolInput<ReadToolInput>('{"path":"src/index.ts","offset":3,"limit":4}')
		const write = parseToolInput<WriteToolInput>('{"path":"src/new.ts","content":"hello"}')
		const bash = parseToolInput<BashToolInput>('{"command":"pwd","timeout_ms":5000}')
		const edit = parseToolInput<EditToolInput>(
			'{"path":"src/index.ts","edits":[{"oldText":"before","newText":"after"}]}',
		)

		expect(read?.file_path).toBe('src/index.ts')
		expect(read?.offset).toBe(3)
		expect(read?.limit).toBe(4)
		expect(write?.file_path).toBe('src/new.ts')
		expect(write?.content).toBe('hello')
		expect(bash?.timeout).toBe(5000)
		expect(edit?.file_path).toBe('src/index.ts')
		expect(edit?.old_string).toBe('before')
		expect(edit?.new_string).toBe('after')
		expect(edit?.edits).toEqual([
			{ oldText: 'before', newText: 'after', old_string: 'before', new_string: 'after' },
		])
	})

	it('preserves every Fold batch edit instead of collapsing the input to one pair', () => {
		const edit = parseToolInput<EditToolInput>(
			'{"path":"src/index.ts","edits":[{"oldText":"one","newText":"ONE"},{"oldText":"two","newText":"TWO"}]}',
		)

		expect(edit?.edits).toEqual([
			{ oldText: 'one', newText: 'ONE', old_string: 'one', new_string: 'ONE' },
			{ oldText: 'two', newText: 'TWO', old_string: 'two', new_string: 'TWO' },
		])
		expect(edit?.old_string).toBeUndefined()
		expect(edit?.new_string).toBeUndefined()
	})
})
