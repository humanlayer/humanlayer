import { Mark } from '@tiptap/core'

export interface CommentAttrs {
	commentId: string
	authorName: string
	authorAvatarUrl: string
	color?: string
	/** 1-based line number in the source markdown */
	lineNumber?: number
	/** All unique participants in this comment's thread */
	participants?: Array<{ name: string; avatarUrl: string }>
}

export const CommentMark = Mark.create({
	name: 'comment',

	addAttributes() {
		return {
			commentId: {
				default: null,
				parseHTML: (el) => el.getAttribute('data-comment-id'),
				renderHTML: (attrs) =>
					attrs.commentId ? { 'data-comment-id': attrs.commentId } : {},
			},
			authorName: {
				default: null,
				parseHTML: (el) => el.getAttribute('data-author-name'),
				renderHTML: (attrs) =>
					attrs.authorName ? { 'data-author-name': attrs.authorName } : {},
			},
			authorAvatarUrl: {
				default: null,
				parseHTML: (el) => el.getAttribute('data-author-avatar'),
				renderHTML: (attrs) =>
					attrs.authorAvatarUrl
						? { 'data-author-avatar': attrs.authorAvatarUrl }
						: {},
			},
			color: {
				default: '#fbbf24',
				parseHTML: (el) => el.getAttribute('data-comment-color'),
				renderHTML: (attrs) =>
					attrs.color ? { 'data-comment-color': attrs.color } : {},
			},
			lineNumber: {
				default: 0,
				parseHTML: (el) => Number(el.getAttribute('data-line-number')) || 0,
				renderHTML: (attrs) =>
					attrs.lineNumber ? { 'data-line-number': attrs.lineNumber } : {},
			},
			participants: {
				default: [],
				parseHTML: (el) => {
					const raw = el.getAttribute('data-participants')
					try {
						return raw ? JSON.parse(raw) : []
					} catch {
						return []
					}
				},
				renderHTML: (attrs) => {
					const p = attrs.participants as Array<{ name: string; avatarUrl: string }> | undefined
					return p && p.length > 0
						? { 'data-participants': JSON.stringify(p) }
						: {}
				},
			},
		}
	},

	parseHTML() {
		return [{ tag: 'span[data-comment-id]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['span', { class: 'comment-highlight', ...HTMLAttributes }, 0]
	},
})
