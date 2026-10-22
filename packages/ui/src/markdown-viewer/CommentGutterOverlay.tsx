import type { Editor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
	AvatarGroupCount,
	AvatarImage,
} from '@humanlayer/ui/components/avatar'
import { type BlockComment, type CommentedBlock, getCommentedBlocks } from './CommentGutter'

export interface GutterItemInfo {
	comments: BlockComment[]
	lineNumber: number
	rect: DOMRect
}

interface CommentGutterOverlayProps {
	editor: Editor | null
	onGutterItemHover?: (info: GutterItemInfo | null) => void
	onGutterItemClick?: (info: GutterItemInfo) => void
}

interface PositionedBlock {
	key: string
	top: number
	comments: CommentedBlock['comments']
}

function getInitials(name: string): string {
	return name
		.split(' ')
		.map((w) => w[0])
		.join('')
		.toUpperCase()
		.slice(0, 2)
}

function getUniqueParticipants(comments: BlockComment[]): Array<{ name: string; avatarUrl: string }> {
	const allParticipants = comments.flatMap((c) => c.participants)
	if (allParticipants.length === 0) {
		// Fallback: use root comment authors when no participants data
		return comments.map((c) => ({ name: c.authorName, avatarUrl: c.authorAvatarUrl }))
	}
	const seen = new Set<string>()
	return allParticipants.filter((p) => {
		if (seen.has(p.name)) return false
		seen.add(p.name)
		return true
	})
}

export function CommentGutterOverlay({ editor, onGutterItemHover, onGutterItemClick }: CommentGutterOverlayProps) {
	const [positioned, setPositioned] = useState<PositionedBlock[]>([])
	const rafRef = useRef<number>(0)

	useEffect(() => {
		if (!editor?.view) return

		const updatePositions = () => {
			const blocks = getCommentedBlocks(editor.state)
			if (blocks.length === 0) {
				setPositioned([])
				return
			}

			const editorEl = editor.view.dom
			const editorRect = editorEl.getBoundingClientRect()
			const next: PositionedBlock[] = []

			for (const block of blocks) {
				try {
					// Prefer the node's actual DOM rect over coordsAtPos: NodeViews without a
					// contentDOM (e.g. mermaid code blocks that render an SVG instead of
					// NodeViewContent) return incorrect coords for positions inside the node.
					let top: number
					const dom = editor.view.nodeDOM(block.blockPos)
					if (dom instanceof HTMLElement) {
						top = dom.getBoundingClientRect().top - editorRect.top
					} else {
						const coords = editor.view.coordsAtPos(block.blockPos + 1)
						top = coords.top - editorRect.top
					}
					const key = block.comments.map((c) => c.commentId).join(',')
					next.push({ key, top, comments: block.comments })
				} catch {
					// Position might be invalid if doc changed
				}
			}

			setPositioned(next)
		}

		// Update once now
		updatePositions()

		// React node views (like code blocks) mount asynchronously via queueMicrotask.
		// Run updatePositions again after a frame to catch late-mounting node views.
		const deferredUpdate = requestAnimationFrame(() => {
			requestAnimationFrame(updatePositions)
		})

		// Listen to editor transactions to know when to recalc
		const onUpdate = () => {
			cancelAnimationFrame(rafRef.current)
			rafRef.current = requestAnimationFrame(updatePositions)
		}

		editor.on('transaction', onUpdate)

		// Also reposition on resize
		const editorEl = editor.view.dom.closest('.tiptap-comment-wrapper')
		let observer: ResizeObserver | undefined
		if (editorEl) {
			observer = new ResizeObserver(onUpdate)
			observer.observe(editorEl)
		}

		return () => {
			editor.off('transaction', onUpdate)
			cancelAnimationFrame(rafRef.current)
			cancelAnimationFrame(deferredUpdate)
			observer?.disconnect()
		}
	}, [editor])

	if (!editor || positioned.length === 0) return null

	return (
		<div className="comment-gutter-overlay">
			{positioned.map((block) => {
				const participants = getUniqueParticipants(block.comments)
				return (
					<div
						key={block.key}
						className="comment-gutter-item cursor-pointer"
						style={{ top: block.top }}
						onMouseEnter={(e) => {
							if (onGutterItemHover) {
								const rect = e.currentTarget.getBoundingClientRect()
								const lineNumber = block.comments[0]?.lineNumber ?? 0
								onGutterItemHover({ comments: block.comments, lineNumber, rect })
							}
						}}
						onMouseLeave={() => onGutterItemHover?.(null)}
						onClick={(e) => {
							if (onGutterItemClick) {
								const rect = e.currentTarget.getBoundingClientRect()
								const lineNumber = block.comments[0]?.lineNumber ?? 0
								onGutterItemClick({ comments: block.comments, lineNumber, rect })
							}
						}}
					>
						<AvatarGroup className="*:data-[slot=avatar]:ring-0">
							{participants.slice(0, 3).map((p) => (
								<Avatar key={p.name} className="size-6 border border-border">
									<AvatarImage src={p.avatarUrl} alt={p.name} />
									<AvatarFallback className="text-[10px]">
										{getInitials(p.name)}
									</AvatarFallback>
								</Avatar>
							))}
							{participants.length > 3 && (
								<AvatarGroupCount className="size-6 text-[10px]">
									+{participants.length - 3}
								</AvatarGroupCount>
							)}
						</AvatarGroup>
					</div>
				)
			})}
		</div>
	)
}
