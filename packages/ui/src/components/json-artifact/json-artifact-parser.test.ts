import { describe, expect, test } from 'vitest'

import { parseJsonArtifact, parseJsonlArtifact } from './json-artifact-parser'
import { MAX_STRUCTURED_NODES, MAX_STRUCTURED_SOURCE_BYTES } from './json-tree-model'

describe('parseJsonArtifact', () => {
	test.each([
		['object', '{"ok":true}', { ok: true }],
		['array', '[1,null]', [1, null]],
		['string', '"value"', 'value'],
		['number', '42', 42],
		['boolean', 'false', false],
		['null', 'null', null],
	])('accepts a strict JSON %s root', (_name, source, value) => {
		expect(parseJsonArtifact(source)).toMatchObject({ kind: 'value', value, source })
	})

	test('preserves invalid and empty source in fallback results', () => {
		expect(parseJsonArtifact(' {nope} ')).toMatchObject({ kind: 'fallback', reason: 'invalid', source: ' {nope} ' })
		expect(parseJsonArtifact(' \n ')).toMatchObject({ kind: 'fallback', reason: 'empty', source: ' \n ' })
	})

	test('counts UTF-8 bytes and guards source before parsing', () => {
		const source = `"${'😀'.repeat(MAX_STRUCTURED_SOURCE_BYTES / 4)}"`
		expect(parseJsonArtifact(source)).toMatchObject({
			kind: 'fallback',
			reason: 'source-too-large',
			source,
			sourceBytes: MAX_STRUCTURED_SOURCE_BYTES + 2,
		})
	})
})

describe('parseJsonlArtifact', () => {
	test('keeps valid, invalid, blank, scalar, and null records in source-line order', () => {
		const source = '{"id":1}\n\nnot-json\n42\nnull\n'
		const result = parseJsonlArtifact(source)
		expect(result).toMatchObject({
			kind: 'records',
			source,
			records: [
				{ kind: 'value', sourceLine: 1, value: { id: 1 } },
				{ kind: 'blank', sourceLine: 2 },
				{ kind: 'invalid', sourceLine: 3, source: 'not-json' },
				{ kind: 'value', sourceLine: 4, value: 42 },
				{ kind: 'value', sourceLine: 5, value: null },
			],
		})
	})

	test('ignores only the synthetic segment after a final newline', () => {
		expect(parseJsonlArtifact('{}\n')).toMatchObject({ kind: 'records', records: [{ sourceLine: 1 }] })
		expect(parseJsonlArtifact('{}\n\n')).toMatchObject({
			kind: 'records',
			records: [{ sourceLine: 1 }, { kind: 'blank', sourceLine: 2 }],
		})
	})

	test('returns whole-file fallback only for empty and oversized source', () => {
		expect(parseJsonlArtifact('')).toMatchObject({ kind: 'fallback', reason: 'empty', source: '' })
		const source = 'x'.repeat(MAX_STRUCTURED_SOURCE_BYTES + 1)
		expect(parseJsonlArtifact(source)).toMatchObject({ kind: 'fallback', reason: 'source-too-large', source })
	})

	test('guards excessive blank lines before creating a full record array and preserves source', () => {
		const source = '\n'.repeat(MAX_STRUCTURED_NODES + 1)
		expect(parseJsonlArtifact(source)).toMatchObject({
			kind: 'fallback',
			reason: 'too-many-nodes',
			source,
			sourceBytes: source.length,
		})
	})

	test('guards cumulative JSONL nodes during record parsing', () => {
		const source = JSON.stringify(Array.from({ length: MAX_STRUCTURED_NODES }, () => null))
		expect(parseJsonlArtifact(source)).toMatchObject({ kind: 'fallback', reason: 'too-many-nodes', source })
	})
})
