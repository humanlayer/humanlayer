/** Plain-text -> TipTap doc JSON, matching the desktop comment editor's serialization. */
export function toCommentDocJson(text: string): string {
	return JSON.stringify({
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
	})
}
