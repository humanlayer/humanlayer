import { parseAnchorV2 } from '../anchor/resolve'

/**
 * The saved selection text of a thread root's V2 anchor, or null when the
 * anchor is malformed or carries no text (whole-block atom anchors). Reads
 * saved evidence only; it never reruns placement or substitutes the comment
 * body.
 */
export function originalAnchorText(anchorJson: unknown): string | null {
	const anchor = parseAnchorV2(anchorJson)
	if (!anchor || anchor.selectedText.trim().length === 0) return null
	return anchor.selectedText
}
