import { cn } from '@humanlayer/ui/lib/utils'
import { dragCarriesFiles } from '@humanlayer/ui/lib/dropped-files'
import { matchSlashCommands } from '@humanlayer/ui/lib/slash-command-match'
import Mention from '@tiptap/extension-mention'
import Collaboration from '@tiptap/extension-collaboration'
import { responseEditorCarets, responseEditorCaretsKey } from '../lib/response-editor-carets'
import type { CollaborationIdentity } from '../lib/collaboration-colors'
import { PluginKey } from '@tiptap/pm/state'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import Placeholder from '@tiptap/extension-placeholder'
import { type Editor, EditorContent, Extension, ReactNodeViewRenderer, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { type Content } from '@tiptap/core'
import {
  type CSSProperties,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import z from 'zod/v4'
import { SlashCommandList, type SlashCommand, type SlashCommandListRef } from './slash-command-list'
import { FileMentionNode } from './file-mention-node'

// Re-export SlashCommand for convenience
export type { SlashCommand } from './slash-command-list'

export interface RichTextEditorRef {
  editor: Editor | null
  focus: () => void
  focusEnd: () => void
  blur: () => void
  blurImmediately: () => void
}

export interface CollaborationUser {
  memberId: string
}

export type RichTextEditorBinding =
  | { mode?: 'local'; value: Content | null; onChange: (value: Content) => void }
  | {
      mode: 'collaborative'
      document: Y.Doc
      fragment: 'response'
      awareness: Awareness
      localUser: CollaborationUser
      identities?: ReadonlyMap<string, CollaborationIdentity>
      value?: never
      onChange?: never
    }

export type RichTextEditorProps = RichTextEditorBinding & RichTextEditorOptions

interface RichTextEditorOptions {
  ariaLabel?: string
  placeholder?: string
  disabled?: boolean
  className?: string
  slashCommands?: SlashCommand[]
  /** Show hint in slash command list that other skills may be available */
  showSkillsHint?: boolean
  /** Suggestion config for @-mention file/artifact autocomplete. When provided, enables @ trigger. */
  fileMentionSuggestion?: {
    render: () => {
      onStart: (props: any) => void
      onUpdate: (props: any) => void
      onExit: () => void
      onKeyDown: (props: { event: KeyboardEvent }) => boolean
    }
  }
  onSubmit?: () => void
  /**
   * Which key gesture invokes `onSubmit`. Defaults to `'mod+enter'`, the current behavior.
   * With `'enter'`, plain Enter submits, Shift+Enter still inserts a hard break, and open
   * slash/mention suggestion menus still consume Enter before submit. Mod-Enter submits
   * in both modes.
   */
  submitShortcut?: 'enter' | 'mod+enter'
  onFocus?: () => void
  onBlur?: () => void
  /** Intercept Escape key. Return true to prevent the default blur behavior. */
  onEscape?: () => boolean
  /** Callback when files are pasted (e.g., images from clipboard) */
  onFilePaste?: (files: File[]) => void
  /** Focus the editor when it is created (mount), placing the cursor at the start or end. */
  autoFocus?: 'start' | 'end'
}

const SlashCommandSchema: z.ZodType<SlashCommand> = z.object({
  name: z.string(),
  source: z.enum(['local', 'global', 'bundled']),
  description: z.string().optional(),
  insertText: z.string().optional(),
  startOfMessageOnly: z.boolean().optional(),
})

const SLASH_MENU_MIN_WIDTH = 450
const SLASH_MENU_MAX_WIDTH = 960
const SLASH_MENU_VIEWPORT_MARGIN = 16

function getSlashMenuHorizontalStyle(triggerLeft: number, viewportWidth: number): CSSProperties {
  const viewportWidthWithinMargins = Math.max(0, viewportWidth - SLASH_MENU_VIEWPORT_MARGIN * 2)
  const anchor = Math.min(
    Math.max(triggerLeft, SLASH_MENU_VIEWPORT_MARGIN),
    viewportWidth - SLASH_MENU_VIEWPORT_MARGIN,
  )
  const spaceLeft = anchor - SLASH_MENU_VIEWPORT_MARGIN
  const spaceRight = viewportWidth - anchor - SLASH_MENU_VIEWPORT_MARGIN

  if (spaceRight < SLASH_MENU_MIN_WIDTH && spaceLeft < SLASH_MENU_MIN_WIDTH) {
    return {
      left: SLASH_MENU_VIEWPORT_MARGIN,
      right: 'auto',
      minWidth: Math.min(SLASH_MENU_MIN_WIDTH, viewportWidthWithinMargins),
      maxWidth: Math.min(SLASH_MENU_MAX_WIDTH, viewportWidthWithinMargins),
    }
  }

  const opensLeft = spaceRight < SLASH_MENU_MIN_WIDTH && spaceLeft > spaceRight
  const availableWidth = opensLeft ? spaceLeft : spaceRight

  return {
    left: opensLeft ? 'auto' : anchor,
    right: opensLeft ? viewportWidth - anchor : 'auto',
    minWidth: Math.min(SLASH_MENU_MIN_WIDTH, availableWidth),
    maxWidth: Math.min(SLASH_MENU_MAX_WIDTH, availableWidth),
  }
}

export const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(
  (props, ref) => {
    const {
      value,
      onChange,
      ariaLabel,
      placeholder = 'Type your message...',
      disabled = false,
      className,
      slashCommands = [],
      showSkillsHint = false,
      fileMentionSuggestion,
      onSubmit,
      submitShortcut = 'mod+enter',
      onFocus,
      onBlur,
      onEscape,
      onFilePaste,
      autoFocus,
    } = props
    // The parent keys the editor lifetime when switching documents/content modes.
    const collaborative = props.mode === 'collaborative'
    const identities = props.mode === 'collaborative' ? props.identities : undefined
    const identitiesRef = useRef(identities)
    const onChangeRef = useRef(onChange)
    const onSubmitRef = useRef(onSubmit)
    // Read through a ref so the keymap (fixed at editor creation) follows setting changes.
    const submitShortcutRef = useRef(submitShortcut)
    const onFocusRef = useRef(onFocus)
    const onBlurRef = useRef(onBlur)
    const onEscapeRef = useRef(onEscape)
    const placeholderRef = useRef(placeholder)
    const staticPlaceholderRef = useRef(() => placeholderRef.current)
    const onFilePasteRef = useRef(onFilePaste)
    const [slashMenuOpen, setSlashMenuOpen] = useState(false)
    const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0, direction: 'down' as 'up' | 'down' })
    const [slashQuery, setSlashQuery] = useState('')
    // Whether the open slash trigger is the first character of the message. Some commands
    // are only valid there. `items` below is not handed the range, so `allow` records it.
    const [slashAtStart, setSlashAtStart] = useState(true)
    const slashAtStartRef = useRef(true)

    // Refs for TipTap suggestion integration
    const slashCommandListRef = useRef<SlashCommandListRef>(null)
    const suggestionPropsRef = useRef<any>(null)
    // Filter commands based on query (memoized to avoid recreating array on every render)
    const filteredCommands = useMemo(
      () => {
        return matchSlashCommands(slashCommands, slashQuery, { atStartOfMessage: slashAtStart })
      },
      [slashCommands, slashQuery, slashAtStart],
    )

    // Keyboard shortcuts extension
    const KeyboardShortcuts = Extension.create({
      name: 'keyboardShortcuts',
      addKeyboardShortcuts() {
        return {
          'Mod-Enter': () => {
            onSubmitRef.current?.()
            return true
          },
          // Plain Enter submits only when the caller opts in. Open slash/mention
          // suggestion menus consume Enter first: TipTap registers the suggestion
          // plugins ahead of this keymap (extension arrays are reversed when plugins
          // are collected), so their handleKeyDown wins while a menu is open.
          Enter: () => {
            if (submitShortcutRef.current !== 'enter') return false
            if (!onSubmitRef.current) return false
            onSubmitRef.current()
            return true
          },
          'Shift-Enter': () => this.editor.chain().setHardBreak().scrollIntoView().run(),
          Escape: () => {
            if (onEscapeRef.current?.()) {
              return true
            }
            this.editor.commands.blur()
            return true
          },
        }
      },
    })

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: false,
          bold: false,
          italic: false,
          strike: false,
          code: false,
          codeBlock: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          blockquote: false,
          horizontalRule: false,
          dropcursor: false,
          link: false,
          undoRedo: collaborative ? false : {},
        }),
        ...(props.mode === 'collaborative'
          ? [Collaboration.configure({ document: props.document, field: props.fragment }),
            responseEditorCarets(props.awareness, () => identitiesRef.current ?? new Map())]
          : []),
        KeyboardShortcuts,
        Placeholder.configure({
          placeholder: staticPlaceholderRef.current,
        }),
        Mention.configure({
          HTMLAttributes: {
            class: 'mention',
          },
          // Don't prepend trigger char since label already includes it
          renderLabel: ({ node }) => node.attrs.label ?? node.attrs.id,
          suggestion: {
            char: '/',
            startOfLine: false,
            // Trigger anywhere the slash starts a word: at the start of the input or
            // after whitespace. This keeps the menu out of file paths like `src/components`,
            // where the slash sits mid-word.
            allowedPrefixes: [' ', '\n'],
            // Runs before `items` in the same update, and unlike `items` it receives the
            // range, so this is where the start-of-message position is captured.
            allow: ({ range }) => {
              slashAtStartRef.current = range.from === 1
              return true
            },
            items: ({ query }) => {
              const atStartOfMessage = slashAtStartRef.current
              setSlashQuery(query)
              setSlashAtStart(atStartOfMessage)
              return matchSlashCommands(slashCommands, query, { atStartOfMessage })
            },
            render: () => {
              return {
                onStart: (props) => {
                  suggestionPropsRef.current = props
                  const rect = props.clientRect?.()
                  if (rect) {
                    // Check if there's room below (at least 200px for the dropdown)
                    const spaceBelow = window.innerHeight - rect.bottom
                    const direction = spaceBelow < 200 ? 'up' : 'down'
                    const top = direction === 'up' ? rect.top - 4 : rect.bottom + 4
                    setSlashMenuPosition({ top, left: rect.left, direction })
                  }
                  setSlashMenuOpen(true)
                },
                onUpdate: (props) => {
                  suggestionPropsRef.current = props
                  const rect = props.clientRect?.()
                  if (rect) {
                    const spaceBelow = window.innerHeight - rect.bottom
                    const direction = spaceBelow < 200 ? 'up' : 'down'
                    const top = direction === 'up' ? rect.top - 4 : rect.bottom + 4
                    setSlashMenuPosition({ top, left: rect.left, direction })
                  }
                },
                onExit: () => {
                  suggestionPropsRef.current = null
                  setSlashMenuOpen(false)
                  setSlashQuery('')
                },
                onKeyDown: ({ event }) => {
                  if (event.key === 'Escape') {
                    setSlashMenuOpen(false)
                    return true
                  }
                  // Forward keyboard events to SlashCommandList for navigation
                  return slashCommandListRef.current?.onKeyDown({ event }) ?? false
                },
              }
            },
            command: ({ editor, range, props }) => {
              const command = SlashCommandSchema.safeParse(props)
              if (!command.success) return
              const cmd = command.data
              // id: canonical command (used for submission via renderText)
              // label: display name (shown in badge via renderLabel)
              const id = cmd.insertText ?? cmd.name
              const label = cmd.name
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent([
                  { type: 'mention', attrs: { id, label } },
                  { type: 'text', text: ' ' },
                ])
                .run()
            },
          },
        }),
        Mention.extend({
          name: 'file-mention',
          addProseMirrorPlugins() {
            return fileMentionSuggestion ? (this.parent?.() ?? []) : []
          },
          addAttributes() {
            return {
              id: { default: null },
              label: { default: null },
              isDirectory: { default: false },
              isArtifact: { default: false },
            }
          },
          addNodeView() {
            return ReactNodeViewRenderer(FileMentionNode)
          },
          renderText({ node }) {
            return node.attrs.id ?? ''
          },
        }).configure({
          HTMLAttributes: {
            class: 'mention',
          },
          renderLabel: ({ node }) => node.attrs.label ?? node.attrs.id,
          suggestion: {
            pluginKey: new PluginKey('fileMention'),
            char: '@',
            startOfLine: false,
            allowSpaces: false,
            allowedPrefixes: [' ', '\n'],
            ...fileMentionSuggestion,
          },
        }),
      ],
      ...(!collaborative
        ? {
            content: value,
            onUpdate: ({ editor }: { editor: Editor }) => onChangeRef.current?.(editor.getJSON()),
          }
        : {}),
      autofocus: autoFocus ?? false,
      editable: !disabled,
      onFocus: () => {
        onFocusRef.current?.()
      },
      onBlur: () => {
        onBlurRef.current?.()
      },
      editorProps: {
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? [])
          if (files.length > 0 && onFilePasteRef.current) {
            event.preventDefault()
            onFilePasteRef.current(files)
            return true
          }
          return false
        },
        handleDOMEvents: {
          dragover: (_view, event) => {
            if (dragCarriesFiles(event.dataTransfer)) {
              event.preventDefault()
              return true
            }
            return false
          },
          drop: (_view, event) => {
            // Prevent ProseMirror from processing file drops;
            // the parent wrapper div handles the actual upload. WebKitGTK sends
            // files as `text/uri-list`, which ProseMirror would otherwise paste
            // in as a file:// link.
            if (dragCarriesFiles(event.dataTransfer)) {
              return true
            }
            return false
          },
        },
        attributes: {
          ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
          spellcheck: 'false',
          autocorrect: 'off',
          autocomplete: 'off',
          autocapitalize: 'off',
          class: cn(
            'prose prose-sm max-w-none focus:outline-none min-h-[2.5rem] max-h-[50vh] overflow-y-auto p-3',
            'text-foreground',
            className,
          ),
        },
      },
    })

    const syncEditorOptionsRef = useCallback(
      (node: HTMLDivElement | null) => {
        if (!node) return
        // Commit-time synchronization: abandoned React renders must not replace
        // handlers used by the live ProseMirror instance.
        onChangeRef.current = onChange
        onSubmitRef.current = onSubmit
        onFocusRef.current = onFocus
        onBlurRef.current = onBlur
        onEscapeRef.current = onEscape
        onFilePasteRef.current = onFilePaste
        submitShortcutRef.current = submitShortcut
        const placeholderChanged = placeholderRef.current !== placeholder
        placeholderRef.current = placeholder
        if (!editor) return
        if (identitiesRef.current !== identities) {
          identitiesRef.current = identities
          if (collaborative) editor.view.dispatch(editor.state.tr.setMeta(responseEditorCaretsKey, true))
        }
        if (editor.isEditable === disabled) editor.setEditable(!disabled)
        if (!collaborative && value !== undefined && JSON.stringify(editor.getJSON()) !== JSON.stringify(value))
          editor.commands.setContent(value)
        if (placeholderChanged && editor.isEmpty) editor.commands.selectAll()
      },
      [
        disabled, editor, collaborative, identities, value, placeholder, onChange,
        onSubmit, onFocus, onBlur, onEscape, onFilePaste, submitShortcut,
      ],
    )

    // Expose editor methods via ref
    useImperativeHandle(ref, () => ({
      editor,
      focus: () => editor?.commands.focus(),
      focusEnd: () => editor?.commands.focus('end'),
      blur: () => editor?.commands.blur(),
      blurImmediately: () => editor?.view.dom.blur(),
    }), [editor])

    const handleSlashSelect = useCallback(
      (command: SlashCommand) => {
        // Use the stored suggestion props to properly trigger the command
        // This ensures the typed text (e.g., "/res") gets replaced
        const props = suggestionPropsRef.current
        if (props?.command) {
          props.command(command)
        }
        setSlashMenuOpen(false)
      },
      [],
    )

    return (
      <div ref={syncEditorOptionsRef} className="relative">
        <EditorContent
          editor={editor}
          className={cn(
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        />
        {slashMenuOpen &&
          createPortal(
            <div
              className="fixed z-50 w-max bg-popover border rounded-md shadow-lg"
              style={{
                top: slashMenuPosition.direction === 'up' ? 'auto' : slashMenuPosition.top,
                bottom: slashMenuPosition.direction === 'up' ? window.innerHeight - slashMenuPosition.top : 'auto',
                ...getSlashMenuHorizontalStyle(slashMenuPosition.left, window.innerWidth),
              }}
            >
              <SlashCommandList
                ref={slashCommandListRef}
                commands={filteredCommands}
                onSelect={handleSlashSelect}
                showSkillsHint={showSkillsHint}
              />
            </div>,
            document.body,
          )}
      </div>
    )
  },
)

RichTextEditor.displayName = 'RichTextEditor'
