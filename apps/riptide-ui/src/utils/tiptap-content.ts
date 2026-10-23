import type { Content, JSONContent } from '@tiptap/core'

import { SIMPLE_RESPONSE_RESTATE_COMMAND, SIMPLE_RESPONSE_RESTATE_PROMPT } from '@/constants/response-slash-commands'

/**
 * Extract plain text from TipTap content, preserving newlines between paragraphs
 * and hardBreaks. Accepts a plain string (returned as-is) or TipTap JSON content.
 *
 * Shared by the desktop composer (ContinueSessionInput) and the mobile composer
 * so that drafts persisted via `useDraftsStore` — which may be authored on either
 * surface — read back consistently.
 */
export function getTextFromContent(content: Content | null): string {
	if (!content) return ''
	if (typeof content === 'string') return content

	const extractText = (node: JSONContent): string => {
		if (node.type === 'text') return node.text || ''
		if (node.type === 'mention') {
			const mentionId = node.attrs?.id || node.attrs?.label || ''
			if (mentionId === SIMPLE_RESPONSE_RESTATE_COMMAND) {
				return `${SIMPLE_RESPONSE_RESTATE_PROMPT}\n\n`
			}
			if (mentionId.startsWith('/rpi:') || mentionId.startsWith('/hl:')) {
				const skillName = mentionId.slice(1)
				return `use the ${skillName} skill\n\n`
			}
			return mentionId
		}
		if (node.type === 'file-mention') {
			return node.attrs?.id || ''
		}
		if (node.type === 'hardBreak') return '\n'
		if (node.content) {
			const hasParagraphs = node.content.some((child) => child.type === 'paragraph')
			const separator = hasParagraphs ? '\n' : ''
			return node.content.map(extractText).join(separator)
		}
		return ''
	}

	return extractText(content)
}
