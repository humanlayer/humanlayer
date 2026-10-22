import type { RichTextEditorRef } from '@humanlayer/ui/components/rich-text-editor'
import { responseEditorCarets } from '@humanlayer/ui/lib/response-editor-carets'
import Collaboration from '@tiptap/extension-collaboration'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
	type ComponentProps,
	type RefObject,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react'

import { resolveCollaborationIdentities } from '@/hooks/session-detail/response-editor-presence'
import {
	type SharedResponseOptions,
	type SharedResponseOwner,
	type SharedResponseStatus,
	useResponseEditorCollaboration,
} from '@/hooks/session-detail/use-response-editor-collaboration'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { Composer } from '@/minimalist/components/Composer'
import { SuggestionList, useSuggestions } from '@/minimalist/components/Suggestions'
import { enterAction } from '@/minimalist/lib/send-keys'
import { applyTextChange, caretOffset, positionAt, promptText } from '@/minimalist/lib/shared-prompt'
import { getTextFromContent } from '@/utils/tiptap-content'

type Props = ComponentProps<typeof Composer> & {
	options: SharedResponseOptions
	/** Resolves true once the message is accepted, so the shared prompt can clear. */
	onSend: (text: string, interrupt: boolean) => Promise<boolean>
}

/**
 * The composer while teammates may prompt the session: one prompt everyone edits at once, with
 * each teammate's caret and selection in their color. Built on the same shared document, presence,
 * and caret plugin as the standard session input.
 */
export function SharedComposer({ options, onSend, ...props }: Props) {
	const editorRef = useRef<RichTextEditorRef>(null)
	const shared = useResponseEditorCollaboration(options, editorRef)
	if (!shared || shared.status === 'access-lost')
		return (
			<div className="note" role="status">
				{shared?.status === 'access-lost'
					? 'You no longer have access to the shared prompt'
					: 'Connecting to the shared prompt…'}
			</div>
		)
	return (
		<SharedComposerReady
			{...props}
			editorRef={editorRef}
			owner={shared.owner}
			status={shared.status}
			onSend={onSend}
		/>
	)
}

const EDITOR_PROPS = {
	attributes: {
		'aria-label': 'Message the agent',
		role: 'textbox',
		'aria-multiline': 'true',
		class: 'shared-prompt',
	},
}

/** Shown only while the prompt can't be edited; when connected, the header already says who can prompt. */
const STATUS_LABELS: Record<SharedResponseStatus, string | null> = {
	connecting: 'Connecting…',
	connected: null,
	reconnecting: 'Reconnecting…',
	'view-only': 'Shared prompt · view only',
	'access-lost': 'Shared prompt · no access',
}

function SharedComposerReady({
	owner,
	status,
	onSend,
	editorRef,
	...props
}: Omit<Props, 'options'> & {
	owner: SharedResponseOwner
	status: SharedResponseStatus
	editorRef: RefObject<RichTextEditorRef | null>
}) {
	const { membersMap } = useOrgMembers()
	const resolved = useMemo(() => resolveCollaborationIdentities(membersMap), [membersMap])
	// The caret plugin reads identities on every awareness change; a ref keeps it on the latest list.
	const identities = useRef(resolved)
	identities.current = resolved
	const sendKey = useSettingsStore((state) => state.sendMessageKeybinding)
	const [text, setText] = useState('')
	const [sending, setSending] = useState(false)
	const [stopArmed, setStopArmed] = useState(false)
	const textarea = useRef<HTMLTextAreaElement>(null)
	const latest = useRef(props)
	latest.current = props
	const caret = useRef({ edited: (_offset: number) => {}, moved: (_offset: number) => {} })
	const writable = status === 'connected'
	const editable = writable && !props.disabled
	// Built once per shared document. A fresh array each render makes the editor reapply its options on
	// every render, and every remote edit then renders again.
	const extensions = useMemo(
		() => [
			StarterKit.configure({
				undoRedo: false,
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
			}),
			Collaboration.configure({ document: owner.binding.document, field: 'response' }),
			responseEditorCarets(owner.binding.awareness, () => identities.current),
			Placeholder.configure({ placeholder: () => latest.current.placeholder ?? '' }),
		],
		[owner],
	)
	const editor = useEditor({
		extensions,
		editable,
		editorProps: EDITOR_PROPS,
		onCreate: ({ editor }) => {
			setText(promptText(editor.state.doc))
			if (latest.current.autoFocus) editor.commands.focus('end')
		},
		onUpdate: ({ editor }) => {
			setText(promptText(editor.state.doc))
			caret.current.edited(caretOffset(editor.state.doc, editor.state.selection.head))
		},
		onSelectionUpdate: ({ editor }) =>
			caret.current.moved(caretOffset(editor.state.doc, editor.state.selection.head)),
	})
	// The editor keeps the editable flag it was created with, usually while still connecting.
	useLayoutEffect(() => {
		if (editor && editor.isEditable !== editable) editor.setEditable(editable)
	}, [editor, editable])
	useImperativeHandle(
		editorRef,
		() => ({
			editor,
			focus: () => {
				editor?.commands.focus()
			},
			focusEnd: () => {
				editor?.commands.focus('end')
			},
			blur: () => {
				editor?.commands.blur()
			},
			blurImmediately: () => {
				editor?.commands.blur()
			},
		}),
		[editor],
	)
	const suggestions = useSuggestions({
		value: text,
		onChange: (value) => {
			if (editor) applyTextChange(editor, value)
		},
		commands: props.commands ?? [],
		mentionScope: props.mentionScope,
		textarea,
		selectRange: (offset) => {
			if (editor) editor.chain().focus().setTextSelection(positionAt(editor.state.doc, offset)).run()
		},
	})
	caret.current = suggestions
	const send = async (interrupt = false) => {
		if (
			!editor ||
			!writable ||
			props.disabled ||
			props.attachments?.blocked ||
			sending ||
			(!text.trim() && !props.attachments?.metadata.length)
		)
			return
		const captured = JSON.stringify(editor.getJSON())
		setSending(true)
		try {
			if (await onSend(getTextFromContent(editor.getJSON()), interrupt)) {
				// A teammate who kept typing while this sent keeps their words.
				if (!editor.isDestroyed && JSON.stringify(editor.getJSON()) === captured) editor.commands.clearContent()
			}
		} finally {
			setSending(false)
		}
	}
	return (
		<Composer
			{...props}
			value={text}
			onChange={() => {}}
			commands={[]}
			mentionScope={undefined}
			submitDisabled={!writable || sending || props.submitDisabled}
			onSubmit={() => void send()}
			onInterruptAndSend={props.onInterruptAndSend ? () => void send(true) : undefined}
			promptInput={
				<>
					{stopArmed && props.running ? (
						<div className="shared-prompt-status" role="status">
							Press Esc again to stop
						</div>
					) : STATUS_LABELS[status] ? (
						<div className="shared-prompt-status" role="status">
							{STATUS_LABELS[status]}
						</div>
					) : null}
					<SuggestionList suggestions={suggestions} />
					<div
						onKeyDownCapture={(event) => {
							if (suggestions.onKeyDown(event)) {
								event.stopPropagation()
								return
							}
							if (event.key === 'Escape' && props.running && props.onStop) {
								event.preventDefault()
								event.stopPropagation()
								if (stopArmed) {
									setStopArmed(false)
									props.onStop()
								} else {
									setStopArmed(true)
									setTimeout(() => setStopArmed(false), 1500)
								}
								return
							}
							const action = enterAction(
								event,
								sendKey,
								Boolean(props.running && props.onInterruptAndSend),
							)
							if (!action) return
							event.preventDefault()
							event.stopPropagation()
							void send(action === 'interrupt')
						}}
						onPaste={(event) => {
							if (props.attachments && event.clipboardData.files.length > 0) {
								event.preventDefault()
								props.attachments.add(Array.from(event.clipboardData.files))
							}
						}}
					>
						<EditorContent editor={editor} />
					</div>
				</>
			}
		/>
	)
}
