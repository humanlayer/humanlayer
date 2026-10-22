import { describe, expect, test } from 'vitest'

import { categorizeArtifact, isArtifactPath } from '../../src/utils/artifact-categorization'

describe('categorizeArtifact', () => {
	test('Read only → source', () => {
		expect(categorizeArtifact(['Read'])).toEqual(['source'])
	})

	test('Read → Edit → source, edited', () => {
		expect(categorizeArtifact(['Read', 'Edit'])).toEqual(['source', 'edited'])
	})

	test('Read → Write → source, edited', () => {
		expect(categorizeArtifact(['Read', 'Write'])).toEqual(['source', 'edited'])
	})

	test('Write only → new', () => {
		expect(categorizeArtifact(['Write'])).toEqual(['new'])
	})

	test('Write → Read → new (exclusive)', () => {
		expect(categorizeArtifact(['Write', 'Read'])).toEqual(['new'])
	})

	test('Edit only (no prior Read) → edited', () => {
		expect(categorizeArtifact(['Edit'])).toEqual(['edited'])
	})

	test('MultiEdit only → edited', () => {
		expect(categorizeArtifact(['MultiEdit'])).toEqual(['edited'])
	})

	test('Read → MultiEdit → source, edited', () => {
		expect(categorizeArtifact(['Read', 'MultiEdit'])).toEqual(['source', 'edited'])
	})

	test('lowercase CodeLayer operations normalize defensively', () => {
		expect(categorizeArtifact(['read', 'multi_edit'])).toEqual(['source', 'edited'])
	})

	test('mixed canonical and raw operations still classify correctly', () => {
		expect(categorizeArtifact(['Read', 'write'])).toEqual(['source', 'edited'])
	})

	test('unknown operations are ignored', () => {
		expect(categorizeArtifact(['bash', 'web_search'])).toEqual([])
	})

	test('Read → Read → source (deduplicated)', () => {
		expect(categorizeArtifact(['Read', 'Read'])).toEqual(['source'])
	})

	test('Read → Edit → Write → source, edited', () => {
		expect(categorizeArtifact(['Read', 'Edit', 'Write'])).toEqual(['source', 'edited'])
	})

	test('empty operations → empty categories', () => {
		expect(categorizeArtifact([])).toEqual([])
	})
})

describe('isArtifactPath', () => {
	test('.humanlayer/tasks/ paths are artifacts', () => {
		expect(isArtifactPath('.humanlayer/tasks/eng-123/research.md')).toBe(true)
		expect(isArtifactPath('.humanlayer/tasks/my-task/notes.md')).toBe(true)
	})

	test('thoughts/ paths are artifacts', () => {
		expect(isArtifactPath('thoughts/tasks/eng-456/design.md')).toBe(true)
		expect(isArtifactPath('thoughts/shared/ideas.md')).toBe(true)
	})

	test('./.humanlayer/tasks/ and ./thoughts/ paths are artifacts', () => {
		expect(isArtifactPath('./.humanlayer/tasks/test.md')).toBe(true)
		expect(isArtifactPath('./thoughts/notes.md')).toBe(true)
	})

	test('absolute paths with .humanlayer/tasks/ are artifacts', () => {
		expect(isArtifactPath('/Users/test/project/.humanlayer/tasks/doc.md')).toBe(true)
	})

	test('src/ paths are NOT artifacts', () => {
		expect(isArtifactPath('src/components/Button.tsx')).toBe(false)
	})

	test('packages/ paths are NOT artifacts', () => {
		expect(isArtifactPath('packages/ui/src/index.ts')).toBe(false)
	})

	test('apps/ paths are NOT artifacts', () => {
		expect(isArtifactPath('apps/riptide-ui/src/routes/index.tsx')).toBe(false)
	})

	test('root files are NOT artifacts', () => {
		expect(isArtifactPath('package.json')).toBe(false)
		expect(isArtifactPath('README.md')).toBe(false)
	})
})
