import { Extension, type JSONContent } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useLocalStorage } from '@uidotdev/usehooks'
import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { getVimMode, VimMode } from 'vim-prose/tiptap'

import 'vim-prose/style.css'

import { focusMainAndReleaseSpatialDomFocus } from '@/components/keyboard-focus-transfer'

function plainTextToDocument(value: string): JSONContent {
	return {
		type: 'doc',
		content: value.split('\n').map((line) => {
			const paragraph: JSONContent = { type: 'paragraph' }
			if (line) paragraph.content = [{ type: 'text', text: line }]
			return paragraph
		}),
	}
}

const ScratchPadVimBehavior = Extension.create({
	name: 'scratchPadVimBehavior',
	priority: 1_000,

	addKeyboardShortcuts() {
		return {
			Escape: () => {
				if (getVimMode(this.editor) !== 'normal') return false
				this.editor.view.dom.blur()
				focusMainAndReleaseSpatialDomFocus()
				return true
			},
		}
	},

	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					decorations(state) {
						const { $head } = state.selection
						if ($head.depth === 0) return DecorationSet.empty

						return DecorationSet.create(state.doc, [
							Decoration.node($head.before($head.depth), $head.after($head.depth), {
								class: 'scratch-pad-active-line',
							}),
						])
					},
				},
			}),
		]
	},
})

export function SidebarWidgetScratchPad({
	storageKey,
	onCycleForward,
	onCycleBackward,
}: {
	storageKey: string
	onCycleForward: () => void
	onCycleBackward: () => void
}) {
	const [value, setValue] = useLocalStorage(storageKey, '')
	const editor = useEditor({
		immediatelyRender: false,
		extensions: [ScratchPadVimBehavior, StarterKit, VimMode],
		content: plainTextToDocument(value),
		editorProps: {
			attributes: {
				'aria-label': 'Scratch pad',
				class: 'h-full min-h-full whitespace-pre-wrap break-words px-2 py-1 font-mono text-sm outline-none focus:outline-none',
			},
		},
		onUpdate: ({ editor: updatedEditor }) => {
			setValue(updatedEditor.getText({ blockSeparator: '\n' }))
		},
	})
	const mode = useEditorState({
		editor,
		selector: ({ editor: currentEditor }) => (currentEditor ? getVimMode(currentEditor) : 'normal'),
	})

	return (
		<div
			data-right-pane-focus-surface="sidebar"
			data-scratch-pad-mode={mode}
			tabIndex={-1}
			className="flex h-full min-h-0 flex-col gap-2 pt-1 outline-none focus-visible:outline-none"
			onKeyDownCapture={(event) => {
				if (
					event.key.toLowerCase() !== 's' ||
					mode !== 'normal' ||
					event.altKey ||
					event.ctrlKey ||
					event.metaKey
				) {
					return
				}
				const cycle = event.shiftKey ? onCycleBackward : onCycleForward
				event.preventDefault()
				event.stopPropagation()
				cycle()
			}}
			onFocus={(event) => {
				if (event.currentTarget === event.target) editor?.view.focus()
			}}
		>
			<EditorContent
				editor={editor}
				className="min-h-0 flex-1 overflow-y-auto rounded-md bg-accent/5 dark:bg-accent/5 [&_.scratch-pad-active-line]:-mx-2 [&_.scratch-pad-active-line]:bg-accent/15 [&_.scratch-pad-active-line]:px-2 [&_.vim-block-cursor]:bg-accent! [&_.vim-block-cursor]:text-accent-foreground! [&_.vim-block-cursor-eol]:bg-accent!"
			/>
			<p className="flex shrink-0 items-center justify-between text-xs text-muted-foreground">
				<span>Stored only on this device.</span>
				<span className="font-mono uppercase">{mode}</span>
			</p>
		</div>
	)
}
