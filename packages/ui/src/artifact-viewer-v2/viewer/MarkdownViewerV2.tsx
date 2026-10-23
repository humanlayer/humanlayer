import { EditorContent, type Editor } from '@tiptap/react'

import { cn } from '../../lib/utils'
import { ArtifactFocusHotkeyLegend } from './ArtifactFocusHotkeyLegend'

import '../../styles/tiptap.css'
import '../artifact-viewer-v2.css'

export interface MarkdownViewerV2Props {
	/** The editor created by {@link useMarkdownViewerV2Editor} in the consuming
	 *  composition. */
	editor: Editor | null
	onFoldToggle?: (headingId: string) => void
	/**
	 * Show the small hotkey legend in the reading column's right margin, centred on
	 * the keyboard-focused block. The composition sets this true only while a block
	 * is focused AND the last keypress was a navigation key (h/j/k/l), so a mouse-
	 * driven focus hides it unless the legend is collapsed, in which case the
	 * restore button stays mounted. Positioned via the focus-block CSS anchor —
	 * inert on engines without anchor positioning.
	 */
	showFocusHotkeys?: boolean
	focusHotkeysCollapsed?: boolean
	onToggleFocusHotkeys?: () => void
	className?: string
}

/**
 * Read-only TipTap document host for Artifact Viewer V2. Uses the established
 * production markdown schema and reusable node views, without the V1 comment
 * or search extensions — later slices compose their own V2 extensions.
 */
export function MarkdownViewerV2({
	editor,
	onFoldToggle,
	showFocusHotkeys,
	focusHotkeysCollapsed = false,
	onToggleFocusHotkeys,
	className,
}: MarkdownViewerV2Props) {
	// `tiptap-comment-wrapper tiptap-no-gutter` reuses the production document
	// typography (scoped under that wrapper) without reserving the V1 comment
	// gutter lane — V2 grows its own comment surfaces in later slices.
	return (
		<div
			className={cn('tiptap-comment-wrapper', 'tiptap-no-gutter', 'artifact-viewer-v2-markdown', className)}
			onClick={(event) => {
				const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.artifact-viewer-v2-heading-disclosure')
				if (button?.dataset.headingId) onFoldToggle?.(button.dataset.headingId)
			}}
		>
			<EditorContent editor={editor} />
			{showFocusHotkeys ? (
				<ArtifactFocusHotkeyLegend collapsed={focusHotkeysCollapsed} onToggle={onToggleFocusHotkeys} />
			) : null}
		</div>
	)
}
