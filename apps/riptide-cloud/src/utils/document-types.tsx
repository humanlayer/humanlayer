import { Badge } from '@humanlayer/ui/components/badge'

/**
 * Document types for RPI artifacts.
 * Matches the labels from SessionLabelBadge in packages/ui.
 */
export type DocumentType =
	| 'research-questions'
	| 'research'
	| 'design'
	| 'design-discussion'
	| 'structure'
	| 'structure-outline'
	| 'plan'
	| 'worktree-setup'
	| 'implementation'
	| 'describe-pr'

/**
 * Get color for a document type.
 * Matches the color logic from SessionLabelBadge (getLabelColor).
 */
function getDocumentTypeColor(type: DocumentType): string {
	switch (type) {
		// Research phase - blue (information gathering)
		// Both research-questions and research use same color (rpi:research* prefix)
		case 'research-questions':
		case 'research':
			return 'var(--terminal-accent)'
		// Design phase - cyan (creative decisions)
		case 'design':
		case 'design-discussion':
			return 'var(--terminal-accent-alt)'
		// Structure phase - gold (organizing)
		case 'structure':
		case 'structure-outline':
			return 'var(--terminal-warning)'
		// Plan phase - violet (detailed planning)
		case 'plan':
			return 'var(--terminal-color-13)'
		// Worktree setup - muted gray (infrastructure)
		case 'worktree-setup':
			return 'var(--terminal-fg-dim)'
		// Implementation phase - green (building)
		case 'implementation':
			return 'var(--terminal-success)'
		// Describe PR phase - bright blue (finalization)
		case 'describe-pr':
			return 'var(--terminal-color-12)'
		default:
			return 'var(--terminal-fg)'
	}
}

/**
 * Valid document type values that can appear in frontmatter.
 */
export const VALID_DOCUMENT_TYPES: DocumentType[] = [
	'research-questions',
	'research',
	'design',
	'design-discussion',
	'structure',
	'structure-outline',
	'plan',
	'worktree-setup',
	'implementation',
	'describe-pr',
]

/**
 * Parse frontmatter from markdown content and extract the document type.
 * Frontmatter format:
 * ---
 * type: research-questions
 * ---
 *
 * Returns null if no frontmatter or no valid type field.
 */
export function getDocumentTypeFromContent(content: string | null | undefined): DocumentType | null {
	if (!content) return null

	// Check if content starts with frontmatter delimiter
	if (!content.startsWith('---')) return null

	// Find the closing delimiter
	const endIndex = content.indexOf('---', 3)
	if (endIndex === -1) return null

	// Extract frontmatter section
	const frontmatter = content.slice(3, endIndex)

	// Parse type field (simple regex, no need for full YAML parser)
	const typeMatch = frontmatter.match(/^type:\s*(.+)$/m)
	if (!typeMatch) return null

	const [, captured] = typeMatch
	if (captured === undefined) return null

	const typeValue = captured.trim() as DocumentType

	// Validate it's a known document type
	if (VALID_DOCUMENT_TYPES.includes(typeValue)) {
		return typeValue
	}

	return null
}

/**
 * Get display label for a document type.
 * Maps verbose types to their shorter display names.
 */
function getDocumentTypeLabel(type: DocumentType): string {
	switch (type) {
		case 'design-discussion':
			return 'design'
		case 'structure-outline':
			return 'structure'
		default:
			return type
	}
}

/**
 * Badge component for document types.
 * Matches SessionLabelBadge styling from packages/ui.
 */
export function DocumentTypeBadge({ type }: { type: DocumentType }) {
	const color = getDocumentTypeColor(type)
	const label = getDocumentTypeLabel(type)

	return (
		<Badge
			variant="outline"
			className="text-[10px] py-0 px-1.5 font-mono"
			style={{
				borderColor: `color-mix(in srgb, ${color} 50%, transparent)`,
				backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
				color: color,
			}}
		>
			{label}
		</Badge>
	)
}
