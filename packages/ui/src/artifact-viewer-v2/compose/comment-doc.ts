/**
 * V2-owned serializer from the composer's plain text to the stored
 * `content_json` TipTap document. Line breaks become separate paragraphs so
 * multi-line comments round-trip through the rich comment renderers.
 */
export function serializeCommentText(contentText: string): string {
	const paragraphs = contentText.split('\n').map((line) => {
		if (line.length === 0) return { type: 'paragraph' as const }
		return { type: 'paragraph' as const, content: [{ type: 'text' as const, text: line }] }
	})
	return JSON.stringify({ type: 'doc', content: paragraphs })
}
