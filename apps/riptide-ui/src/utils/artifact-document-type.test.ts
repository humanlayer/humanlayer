import { describe, expect, test } from 'vitest'

import {
	documentTypeLabel,
	getArtifactDocumentType,
	groupArtifactsByDocumentType,
	UNTYPED_DOCUMENT_LABEL,
} from './artifact-document-type'

describe('getArtifactDocumentType', () => {
	test('reads type from a parsed frontmatter object', () => {
		expect(getArtifactDocumentType({ type: 'research', date: '2026-07-04' })).toBe('research')
	})

	test('reads type from a double-serialized JSON string', () => {
		expect(getArtifactDocumentType(JSON.stringify({ type: 'plan' }))).toBe('plan')
	})

	test('returns null for missing, empty, or non-string types', () => {
		expect(getArtifactDocumentType({})).toBeNull()
		expect(getArtifactDocumentType({ type: '' })).toBeNull()
		expect(getArtifactDocumentType({ type: 42 })).toBeNull()
		expect(getArtifactDocumentType(null)).toBeNull()
		expect(getArtifactDocumentType(undefined)).toBeNull()
		expect(getArtifactDocumentType('not json')).toBeNull()
	})
})

describe('documentTypeLabel', () => {
	test('uses known labels for rpi document types', () => {
		expect(documentTypeLabel('research-questions')).toBe('Research Questions')
		expect(documentTypeLabel('design-prd')).toBe('PRD')
		expect(documentTypeLabel('structure-outline')).toBe('Outline')
	})

	test('humanizes unknown types', () => {
		expect(documentTypeLabel('meeting-notes')).toBe('Meeting Notes')
	})

	test('labels untyped artifacts', () => {
		expect(documentTypeLabel(null)).toBe(UNTYPED_DOCUMENT_LABEL)
	})
})

describe('groupArtifactsByDocumentType', () => {
	test('orders groups by reverse rpi workflow with unknown types after and untyped last', () => {
		const artifacts = [
			{ path: 'notes.md', frontmatterType: 'meeting-notes' },
			{ path: 'plan.md', frontmatterType: 'plan' },
			{ path: 'ticket.md', frontmatterType: null },
			{ path: 'research.md', frontmatterType: 'research' },
			{ path: 'research-2.md', frontmatterType: 'research' },
			{ path: 'pr-description.md', frontmatterType: 'pr-description' },
		]

		const groups = groupArtifactsByDocumentType(artifacts)

		expect(groups.map((group) => group.label)).toEqual([
			'PR Description',
			'Plan',
			'Research',
			'Meeting Notes',
			UNTYPED_DOCUMENT_LABEL,
		])
		expect(groups[2].items.map((artifact) => artifact.path)).toEqual(['research.md', 'research-2.md'])
		expect(groups[4].items.map((artifact) => artifact.path)).toEqual(['ticket.md'])
	})

	test('returns no groups for an empty list', () => {
		expect(groupArtifactsByDocumentType([])).toEqual([])
	})
})
