import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

export interface KeyboardFocusState {
	/** Absolute ProseMirror position of the keyboard-focused block, if any. */
	focusedPos: number | null
}

interface KeyboardFocusMeta {
	focusedPos: number | null
}

const keyboardFocusPluginKey = new PluginKey<KeyboardFocusState>('artifactViewerV2KeyboardFocus')

/** CSS class applied to the keyboard-focused block's rendered node. */
export const KEYBOARD_FOCUS_CLASS = 'artifact-viewer-v2-block-focused'

/**
 * View-only keyboard block-focus state for Artifact Viewer V2.
 *
 * Holds at most one focused block position in plugin state and renders it as
 * a non-persistent node decoration (textblocks and block atoms alike) without
 * mutating the document. It is intentionally independent of comment
 * decorations so the keyboard cursor remains useful before and after
 * annotation features exist. State resets naturally when the (content-keyed)
 * document remounts.
 */
export const KeyboardFocusExtension = Extension.create({
	name: 'artifactViewerV2KeyboardFocus',

	addProseMirrorPlugins() {
		return [
			new Plugin<KeyboardFocusState>({
				key: keyboardFocusPluginKey,
				state: {
					init: () => ({ focusedPos: null }),
					apply(tr, value) {
						const meta = tr.getMeta(keyboardFocusPluginKey) as KeyboardFocusMeta | undefined
						if (meta !== undefined) return { focusedPos: meta.focusedPos }
						if (!tr.docChanged || value.focusedPos == null) return value
						const mapped = tr.mapping.mapResult(value.focusedPos)
						return mapped.deleted ? { focusedPos: null } : { focusedPos: mapped.pos }
					},
				},
				props: {
					decorations(state) {
						const focusedPos = keyboardFocusPluginKey.getState(state)?.focusedPos
						if (focusedPos == null) return DecorationSet.empty
						const node = state.doc.nodeAt(focusedPos)
						if (!node || !node.isBlock) return DecorationSet.empty
						return DecorationSet.create(state.doc, [
							Decoration.node(focusedPos, focusedPos + node.nodeSize, { class: KEYBOARD_FOCUS_CLASS }),
						])
					},
				},
			}),
		]
	},
})

/**
 * Move (or clear, with `null`) the keyboard block-focus decoration. Called
 * from the event handlers that own focus movement; never from render.
 */
export function setKeyboardBlockFocus(view: EditorView, focusedPos: number | null): void {
	const meta: KeyboardFocusMeta = { focusedPos }
	view.dispatch(view.state.tr.setMeta(keyboardFocusPluginKey, meta))
}

/** Read the currently focused block position from the editor state. */
export function getKeyboardBlockFocus(state: EditorState): number | null {
	return keyboardFocusPluginKey.getState(state)?.focusedPos ?? null
}
