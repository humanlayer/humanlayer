import type { Editor, Range } from '@tiptap/core'
import { useCallback, useMemo, useRef, useState } from 'react'

import type { FileMentionDropdownRef } from '@/components/FileMentionDropdown'

interface FileMentionSuggestionProps {
	query: string
	clientRect: (() => DOMRect | null) | null
	command: (item: { id: string; label: string; isDirectory: boolean; isArtifact: boolean }) => void
	editor: Editor
	range: Range
	props: { id: string; label: string; isDirectory?: boolean; isArtifact?: boolean }
}

const VIEWPORT_MARGIN = 16

function computePosition(rect: DOMRect) {
	const spaceBelow = window.innerHeight - rect.bottom
	const direction: 'up' | 'down' = spaceBelow < 200 ? 'up' : 'down'
	const top = direction === 'up' ? rect.top - 4 : rect.bottom + 4

	// Flip the dropdown toward the center of the window so long options grow
	// inward and stay confined: anchor from whichever side leaves more room.
	const horizontal: 'left' | 'right' = rect.left > window.innerWidth / 2 ? 'right' : 'left'
	const left = rect.left
	const right = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right)
	// Cap the width to the available space on the anchored side so the dropdown
	// never extends past the viewport edge.
	const maxWidth =
		horizontal === 'left' ? window.innerWidth - rect.left - VIEWPORT_MARGIN : rect.right - VIEWPORT_MARGIN

	return { top, left, right, direction, horizontal, maxWidth }
}

export function useFileMentionSuggestion(enabled: boolean) {
	const fileMentionDropdownRef = useRef<FileMentionDropdownRef>(null)
	const fileMentionSuggestionPropsRef = useRef<FileMentionSuggestionProps | null>(null)

	const [fileMentionOpen, setFileMentionOpen] = useState(false)
	const [fileMentionPosition, setFileMentionPosition] = useState({
		top: 0,
		left: 0,
		right: 0,
		maxWidth: 0,
		direction: 'down' as 'up' | 'down',
		horizontal: 'left' as 'left' | 'right',
	})
	const [fileMentionQuery, setFileMentionQuery] = useState('')

	const fileMentionSuggestion = useMemo(() => {
		if (!enabled) return undefined
		return {
			render: () => ({
				onStart: (props: FileMentionSuggestionProps) => {
					fileMentionSuggestionPropsRef.current = props
					setFileMentionQuery(props.query ?? '')
					const rect = props.clientRect?.()
					if (rect) {
						setFileMentionPosition(computePosition(rect))
					}
					setFileMentionOpen(true)
				},
				onUpdate: (props: FileMentionSuggestionProps) => {
					fileMentionSuggestionPropsRef.current = props
					setFileMentionQuery(props.query ?? '')
					const rect = props.clientRect?.()
					if (rect) {
						setFileMentionPosition(computePosition(rect))
					}
				},
				onExit: () => {
					fileMentionSuggestionPropsRef.current = null
					setFileMentionOpen(false)
					setFileMentionQuery('')
				},
				onKeyDown: ({ event }: { event: KeyboardEvent }) => {
					if (event.key === 'Escape') {
						setFileMentionOpen(false)
						return true
					}
					return fileMentionDropdownRef.current?.onKeyDown({ event }) ?? false
				},
			}),
			command: ({ editor, range, props }: FileMentionSuggestionProps) => {
				editor
					.chain()
					.focus()
					.deleteRange(range)
					.insertContent([
						{
							type: 'file-mention',
							attrs: {
								id: props.id,
								label: props.label,
								isDirectory: props.isDirectory ?? false,
								isArtifact: props.isArtifact ?? false,
							},
						},
						{ type: 'text', text: ' ' },
					])
					.run()
			},
		}
	}, [enabled])

	const commandAndClose = useCallback(
		(item: { id: string; label: string; isDirectory: boolean; isArtifact: boolean }) => {
			fileMentionSuggestionPropsRef.current?.command(item)
			setFileMentionOpen(false)
		},
		[],
	)

	/**
	 * Rewrites the mention being typed and leaves the dropdown open, so choosing
	 * a directory descends into it instead of completing the mention. Descending
	 * is also how a name containing spaces is reached: the suggestion stops at a
	 * space, so such a name can be picked from a listing but never typed.
	 */
	const continueQuery = useCallback((text: string) => {
		const props = fileMentionSuggestionPropsRef.current
		if (!props) return
		props.editor.chain().focus().insertContentAt(props.range, `@${text}`).run()
	}, [])

	return {
		fileMentionSuggestion,
		fileMentionOpen,
		fileMentionPosition,
		fileMentionQuery,
		fileMentionDropdownRef,
		commandAndClose,
		continueQuery,
	}
}
