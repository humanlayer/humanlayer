import { describe, expect, test } from 'vitest'

import {
	clampArtifactViewMode,
	getArtifactRendererKind,
	isJsonFile,
	isJsonlFile,
	isMarkdownFile,
	isRenderedArtifactFile,
} from './file-types'

describe('JSON artifact file types', () => {
	test.each(['data.json', 'DATA.JSON', 'nested/data.json'])('recognizes %s as rendered JSON', (fileName) => {
		expect(isJsonFile(fileName)).toBe(true)
		expect(isRenderedArtifactFile(fileName)).toBe(true)
	})

	test.each(['events.jsonl', 'data.json.gz', 'json'])('does not recognize %s as JSON', (fileName) => {
		expect(isJsonFile(fileName)).toBe(false)
	})

	test.each(['events.jsonl', 'EVENTS.JSONL', 'nested/events.jsonl'])(
		'recognizes %s as rendered JSONL',
		(fileName) => {
			expect(isJsonlFile(fileName)).toBe(true)
			expect(isRenderedArtifactFile(fileName)).toBe(true)
		},
	)

	test.each(['README.md', 'notes.MDX', 'nested/plan.md'])('recognizes %s as Markdown only', (fileName) => {
		expect(isMarkdownFile(fileName)).toBe(true)
		expect(getArtifactRendererKind(fileName, 'rendered')).toBe('markdown')
	})

	test.each(['data.json.gz', 'data.jsonl.bak', 'json', '.json/file'])('rejects false suffix %s', (fileName) => {
		expect(isRenderedArtifactFile(fileName)).toBe(false)
		expect(clampArtifactViewMode(fileName, 'rendered')).toBe('raw')
	})

	test('keeps V2 classification distinct from structured rendered files', () => {
		expect(isMarkdownFile('data.json')).toBe(false)
		expect(getArtifactRendererKind('data.json', 'rendered')).toBe('json-tree')
		expect(getArtifactRendererKind('events.JSONL', 'rendered')).toBe('json-tree')
		expect(getArtifactRendererKind('events.JSONL', 'raw')).toBe('raw')
	})
})
