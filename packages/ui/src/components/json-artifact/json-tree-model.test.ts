import { describe, expect, test } from 'vitest'

import {
	findJsonTreeMatches,
	getSearchExpandedIds,
	MAX_STRUCTURED_SEARCH_MATCHES,
} from './json-artifact-search'
import type { JsonlRecord, JsonValue } from './json-artifact-parser'
import {
	buildJsonlTreeModel,
	buildJsonTreeModel,
	flattenVisibleRows,
	getDefaultExpandedIds,
	MAX_STRUCTURED_DEPTH,
	MAX_STRUCTURED_NODES,
} from './json-tree-model'

function modelOf(value: JsonValue) {
	const result = buildJsonTreeModel(value)
	if (result.kind !== 'model') throw new Error(result.message)
	return result
}

describe('JSON tree model', () => {
	test('builds escaped stable paths, source order, and sibling metadata', () => {
		const model = modelOf({ 'a/b': 1, 'c~d': [true, false] })
		expect(model.rows.map((row) => row.id)).toEqual(['', '/a~1b', '/c~0d', '/c~0d/0', '/c~0d/1'])
		expect(model.rows[1]).toMatchObject({ indexInParent: 0, setSize: 2, depth: 1 })
		expect(model.rows[4]).toMatchObject({ indexInParent: 1, setSize: 2, depth: 2 })
		expect(flattenVisibleRows(model, getDefaultExpandedIds(model)).map((row) => row.id)).toEqual([
			'',
			'/a~1b',
			'/c~0d',
		])
	})

	test('orders key matches before value matches and unions match ancestors', () => {
		const model = modelOf({ target: { label: 'target target' } })
		const matches = findJsonTreeMatches(model, 'target')
		expect(matches.map(({ rowId, field, start }) => [rowId, field, start])).toEqual([
			['/target', 'key', 0],
			['/target/label', 'value', 1],
			['/target/label', 'value', 8],
		])
		expect([...getSearchExpandedIds(model, matches)]).toEqual(['', '/target'])
	})

	test('caps matches from a large scalar', () => {
		const model = modelOf('a'.repeat(MAX_STRUCTURED_SEARCH_MATCHES * 2))
		const matches = findJsonTreeMatches(model, 'a')
		expect(matches).toHaveLength(MAX_STRUCTURED_SEARCH_MATCHES)
		expect(matches.at(-1)).toMatchObject({ rowId: '', start: MAX_STRUCTURED_SEARCH_MATCHES })
	})

	test('guards node count at 50,001 displayed values', () => {
		const result = buildJsonTreeModel(Array.from({ length: MAX_STRUCTURED_NODES }, (_, index) => index))
		expect(result).toMatchObject({ kind: 'fallback', reason: 'too-many-nodes' })
	})

	test('guards depth 129 while accepting depth 128', () => {
		const nested = (depth: number): JsonValue => {
			let value: JsonValue = true
			for (let index = 0; index < depth; index++) value = { child: value }
			return value
		}
		expect(buildJsonTreeModel(nested(MAX_STRUCTURED_DEPTH))).toMatchObject({ kind: 'model' })
		expect(buildJsonTreeModel(nested(MAX_STRUCTURED_DEPTH + 1))).toMatchObject({ kind: 'fallback', reason: 'too-deep' })
	})
})

describe('JSONL tree model', () => {
	test('prefixes paths by line and starts valid records collapsed', () => {
		const records: JsonlRecord[] = [
			{ kind: 'value', sourceLine: 1, value: { event: 'start' } },
			{ kind: 'blank', sourceLine: 2 },
			{ kind: 'invalid', sourceLine: 3, source: 'bad', message: 'invalid' },
			{ kind: 'value', sourceLine: 4, value: 7 },
		]
		const result = buildJsonlTreeModel(records)
		if (result.kind !== 'model') throw new Error(result.message)
		expect(result.rows.map((row) => row.id)).toEqual([
			'/line/1',
			'/line/1/event',
			'/line/2',
			'/line/3',
			'/line/4',
		])
		expect([...getDefaultExpandedIds(result)]).toEqual([])
		expect(flattenVisibleRows(result, new Set()).map((row) => row.rowKind)).toEqual([
			'value',
			'blank',
			'invalid',
			'value',
		])
		expect(result.rows[4]).toMatchObject({ indexInParent: 3, setSize: 4, sourceLine: 4 })
		expect(findJsonTreeMatches(result, 'start').map((match) => match.rowId)).toEqual(['/line/1/event'])
	})
})
