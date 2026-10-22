import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { collaborationColor, type CollaborationIdentity } from './collaboration-colors'
import { readResponseEditorAwareness } from './response-editor-awareness'
import { mountResponseCaretLabels } from './response-caret-labels'

export const responseEditorCaretsKey = new PluginKey<DecorationSet>('responseEditorCarets')

/** The binding owns relative positions; the app supplies only cache-resolved identities.
 * Unlike Caret 3.22.5 this installs no anonymous, unowned awareness listener. */
export function responseEditorCarets(
  awareness: Awareness,
  getIdentities: () => ReadonlyMap<string, CollaborationIdentity>,
) {
  function decorations(state: EditorState) {
    const binding = ySyncPluginKey.getState(state)
    if (!binding?.binding || binding.snapshot || binding.prevSnapshot) return DecorationSet.empty
    const result: Decoration[] = []
    for (const [clientId, raw] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue
      const peer = readResponseEditorAwareness(raw)
      if (!peer?.cursor) continue
      const identity = getIdentities().get(peer.memberId)
      if (!identity) continue
      const anchor = relativePositionToAbsolutePosition(binding.doc, binding.type,
        Y.createRelativePositionFromJSON(peer.cursor.anchor), binding.binding.mapping)
      const head = relativePositionToAbsolutePosition(binding.doc, binding.type,
        Y.createRelativePositionFromJSON(peer.cursor.head), binding.binding.mapping)
      if (anchor === null || head === null) continue
      const color = collaborationColor(peer.memberId)
      const label = `${identity.displayName} · Editing`
      result.push(Decoration.widget(head, () => {
        const caret = document.createElement('span')
        caret.className = 'response-caret'
        caret.style.setProperty('--collaboration-color', color)
        caret.dataset.clientId = String(clientId)
        caret.setAttribute('aria-label', label)
        caret.setAttribute('role', 'img')
        const name = document.createElement('span')
        name.className = 'response-caret-label'
        name.setAttribute('popover', 'manual')
        name.setAttribute('aria-hidden', 'true')
        name.textContent = identity.displayName
        caret.append(name)
        return caret
      }, { key: JSON.stringify([clientId, peer.memberId, identity.displayName]), side: 10 }))
      if (anchor !== head) result.push(Decoration.inline(Math.min(anchor, head), Math.max(anchor, head), {
        class: 'response-selection',
        style: `--collaboration-color: ${color}`,
        'aria-label': `${identity.displayName} · Selection`,
        'data-client-id': String(clientId),
      }))
    }
    return DecorationSet.create(state.doc, result)
  }

  return Extension.create({
    name: 'responseEditorCarets',
    addProseMirrorPlugins() {
      return [new Plugin({
        key: responseEditorCaretsKey,
        state: {
          init: (_, state) => decorations(state),
          apply: (transaction, previous, _, state) =>
            transaction.docChanged || transaction.getMeta(responseEditorCaretsKey) || transaction.getMeta(ySyncPluginKey)
              ? decorations(state) : previous.map(transaction.mapping, transaction.doc),
        },
        props: { decorations: (state) => responseEditorCaretsKey.getState(state) },
        view(view) {
          const labels = mountResponseCaretLabels(view.dom)
          let destroyed = false
          let scheduled = false
          const refresh = () => {
            if (scheduled || destroyed) return
            scheduled = true
            queueMicrotask(() => {
              scheduled = false
              if (!destroyed) view.dispatch(view.state.tr.setMeta(responseEditorCaretsKey, true))
            })
          }
          const clear = () => {
            if (awareness.getLocalState()?.cursor != null) awareness.setLocalStateField('cursor', null)
          }
          const publish = (currentView: EditorView) => {
            if (!currentView.hasFocus() || !currentView.editable) return clear()
            const binding = ySyncPluginKey.getState(currentView.state)
            if (!binding?.binding) return
            const selection = currentView.state.selection
            const cursor = {
              anchor: absolutePositionToRelativePosition(selection.anchor, binding.type, binding.binding.mapping),
              head: absolutePositionToRelativePosition(selection.head, binding.type, binding.binding.mapping),
            }
            if (JSON.stringify(awareness.getLocalState()?.cursor) !== JSON.stringify(cursor))
              awareness.setLocalStateField('cursor', cursor)
          }
          const focus = () => publish(view)
          awareness.on('change', refresh)
          view.dom.addEventListener('focus', focus)
          view.dom.addEventListener('blur', clear)
          publish(view)
          return {
            update(currentView) {
              publish(currentView)
              labels.update()
            },
            destroy() {
              labels.destroy()
              destroyed = true
              awareness.off('change', refresh)
              view.dom.removeEventListener('focus', focus)
              view.dom.removeEventListener('blur', clear)
              clear() // private-mode remount drops only cursor, not session presence
            },
          }
        },
      })]
    },
  })
}
