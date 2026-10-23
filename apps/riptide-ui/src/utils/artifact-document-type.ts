/**
 * Grouping of artifacts by the `type` field of their YAML frontmatter
 * (research, plan, structure-outline, …) as written by the rpi skills.
 */

import { Option, Schema } from 'effect'

const KNOWN_DOCUMENT_TYPES = [
	'pr-description',
	'plan',
	'structure-outline',
	'design-tdd',
	'design-prd',
	'design-discussion',
	'research',
	'research-questions',
	'ticket',
] as const
const KnownDocumentType = Schema.Literals(KNOWN_DOCUMENT_TYPES)

const KNOWN_DOCUMENT_TYPE_LABELS: Record<(typeof KNOWN_DOCUMENT_TYPES)[number], string> = {
	'pr-description': 'PR Description',
	plan: 'Plan',
	'structure-outline': 'Outline',
	'design-tdd': 'TDD',
	'design-prd': 'PRD',
	'design-discussion': 'Design Discussion',
	research: 'Research',
	'research-questions': 'Research Questions',
	ticket: 'Ticket',
}

/** Reverse RPI workflow order (latest documents first); unknown types sort after these, untyped artifacts last. */
const DOCUMENT_TYPE_ORDER = KNOWN_DOCUMENT_TYPES

export const UNTYPED_DOCUMENT_LABEL = 'Other'

/**
 * Extract the frontmatter `type` from an artifact's frontmatter value.
 * Accepts both parsed objects and JSON-string values (drizzle double-serializes
 * JSONB in some sync paths).
 */
export function getArtifactDocumentType(frontmatter: unknown): string | null {
	let value = frontmatter
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value)
		} catch {
			return null
		}
	}
	if (!value || typeof value !== 'object') return null
	const type = (value as Record<string, unknown>).type
	return typeof type === 'string' && type.length > 0 ? type : null
}

export function documentTypeLabel(type: string | null): string {
	if (!type) return UNTYPED_DOCUMENT_LABEL
	const knownType = Option.getOrUndefined(Schema.decodeUnknownOption(KnownDocumentType)(type))
	return (
		(knownType === undefined ? undefined : KNOWN_DOCUMENT_TYPE_LABELS[knownType]) ??
		type
			.split('-')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ')
	)
}

export interface DocumentTypeGroup<T> {
	type: string | null
	label: string
	items: T[]
}

/**
 * Group artifacts by frontmatter document type, in reverse RPI workflow order
 * (pr-description → plan → … → ticket), then unknown types alphabetically,
 * with untyped artifacts last.
 */
export function groupArtifactsByDocumentType<T extends { frontmatterType?: string | null }>(
	artifacts: T[],
): DocumentTypeGroup<T>[] {
	const byType = new Map<string | null, T[]>()
	for (const artifact of artifacts) {
		const type = artifact.frontmatterType ?? null
		const items = byType.get(type) ?? []
		items.push(artifact)
		byType.set(type, items)
	}

	const types = [...byType.keys()].filter((type): type is string => type !== null)
	types.sort((a, b) => {
		const knownA = Option.getOrUndefined(Schema.decodeUnknownOption(KnownDocumentType)(a))
		const knownB = Option.getOrUndefined(Schema.decodeUnknownOption(KnownDocumentType)(b))
		const aIndex = knownA === undefined ? -1 : DOCUMENT_TYPE_ORDER.indexOf(knownA)
		const bIndex = knownB === undefined ? -1 : DOCUMENT_TYPE_ORDER.indexOf(knownB)
		if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
		if (aIndex !== -1) return -1
		if (bIndex !== -1) return 1
		return a.localeCompare(b)
	})

	const groups: DocumentTypeGroup<T>[] = types.map((type) => ({
		type,
		label: documentTypeLabel(type),
		items: byType.get(type) ?? [],
	}))

	const untyped = byType.get(null)
	if (untyped?.length) {
		groups.push({ type: null, label: UNTYPED_DOCUMENT_LABEL, items: untyped })
	}

	return groups
}
