import { matchSlashCommands } from '@humanlayer/ui/lib/slash-command-match'
import { File, FileText, Folder } from 'lucide-react'
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from 'react'

import type { SlashCommand } from '@/minimalist/lib/data'
import { insertMention, type Mention, type MentionScope, mentionAt, useMentions } from '@/minimalist/lib/mentions'
import { getTextFromContent } from '@/utils/tiptap-content'

type Suggestion = { kind: 'command'; command: SlashCommand } | { kind: 'mention'; mention: Mention }

/**
 * The list above the composer: slash commands while the message is a lone `/word`, otherwise
 * `@` mentions at the caret. Arrow keys move, Tab or Enter picks, Esc hides mentions until the
 * next `@`. The textarea reports edits and caret moves; `onKeyDown` says whether it used the key.
 */
export function useSuggestions({
	value,
	onChange,
	commands,
	mentionScope,
	textarea,
	selectRange,
}: {
	value: string
	onChange: (value: string) => void
	commands: SlashCommand[]
	mentionScope: MentionScope | undefined
	textarea: RefObject<HTMLTextAreaElement | null>
	selectRange?: (position: number) => void
}) {
	const listId = useId()
	const [active, setActive] = useState(0)
	const [caret, setCaret] = useState<number | null>(null)
	const [dismissedAt, setDismissedAt] = useState<number | null>(null)
	const slashQuery = /^\/(\S*)$/.exec(value)?.[1]?.toLowerCase()
	const commandMatches =
		slashQuery === undefined ? [] : matchSlashCommands(commands, slashQuery, { atStartOfMessage: true })
	const typed = mentionScope && commandMatches.length === 0 && caret !== null ? mentionAt(value, caret) : null
	const mention = typed && typed.start !== dismissedAt ? typed : null
	const mentions = useMentions(mention?.query ?? null, mentionScope)
	const items: Suggestion[] =
		commandMatches.length > 0
			? commandMatches.map((command) => ({ kind: 'command', command: command as SlashCommand }))
			: mentions.map((option) => ({ kind: 'mention', mention: option }))
	const selected = Math.min(active, Math.max(0, items.length - 1))

	const pick = (item: Suggestion | undefined) => {
		if (!item) return
		setActive(0)
		if (item.kind === 'command') {
			const id = item.command.insertText ?? item.command.name
			// Plain drafts carry the same skill instruction as a selected mention in the standard editor.
			const text = getTextFromContent({ type: 'mention', attrs: { id, label: item.command.name } })
			onChange(text === id ? `${text} ` : text)
			return
		}
		if (!mention) return
		const next = insertMention(value, mention, item.mention.insert)
		onChange(next.value)
		setCaret(next.caret)
		requestAnimationFrame(() =>
			selectRange ? selectRange(next.caret) : textarea.current?.setSelectionRange(next.caret, next.caret),
		)
	}

	const open = items.length > 0
	return {
		items,
		active: selected,
		listId,
		label: commandMatches.length > 0 ? 'Commands' : 'Mentions',
		/** For the textarea: which list it drives and which row the arrows are on, for screen readers. */
		ariaProps: {
			'aria-autocomplete': 'list',
			'aria-controls': open ? listId : undefined,
			'aria-activedescendant': open ? optionId(listId, selected) : undefined,
		} as const,
		pick,
		/** After typing: follow the caret and start from the top of the new list. */
		edited: (position: number) => {
			setCaret(position)
			setActive(0)
		},
		moved: setCaret,
		onKeyDown: (event: KeyboardEvent<HTMLElement>): boolean => {
			if (items.length === 0 || event.nativeEvent.isComposing) return false
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				const step = event.key === 'ArrowDown' ? 1 : -1
				setActive((selected + step + items.length) % items.length)
			} else if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
				pick(items[selected])
			} else if (event.key === 'Escape' && mention) {
				setDismissedAt(mention.start)
			} else return false
			event.preventDefault()
			return true
		},
	}
}

export function SuggestionList({
	suggestions,
}: {
	suggestions: Pick<ReturnType<typeof useSuggestions>, 'items' | 'active' | 'listId' | 'label' | 'pick'>
}) {
	const { items, active, listId, label, pick } = suggestions
	const list = useRef<HTMLDivElement>(null)
	const selected = Math.min(active, Math.max(0, items.length - 1))
	useEffect(() => {
		list.current?.children[selected]?.scrollIntoView({ block: 'nearest' })
	}, [selected, items.length])
	if (items.length === 0) return null
	return (
		<div className="slash-menu" ref={list} id={listId} role="listbox" aria-label={label}>
			{items.map((item, index) => (
				<button
					type="button"
					key={item.kind === 'command' ? item.command.name : item.mention.key}
					className="mi"
					id={optionId(listId, index)}
					role="option"
					aria-selected={index === selected}
					data-active={index === selected}
					onMouseDown={(event) => {
						// Keep focus, and the caret, in the textarea.
						event.preventDefault()
						pick(item)
					}}
				>
					{item.kind === 'command' ? (
						<CommandRow command={item.command} />
					) : (
						<MentionRow mention={item.mention} />
					)}
				</button>
			))}
		</div>
	)
}

function CommandRow({ command }: { command: SlashCommand }) {
	return (
		<>
			<span className="mono">{command.name}</span>
			<span className="d ell">{command.description}</span>
			<span className="sp" />
			{command.kind === 'skill' ? <span className="badge">Skill</span> : null}
		</>
	)
}

const MENTION_ICONS = { doc: FileText, dir: Folder, file: File } as const

function MentionRow({ mention }: { mention: Mention }) {
	const Icon = MENTION_ICONS[mention.kind]
	return (
		<>
			<Icon className="i sm" strokeWidth={1.6} />
			<span className="ell">{mention.label}</span>
			<span className="d ell">{mention.detail}</span>
		</>
	)
}

function optionId(listId: string, index: number) {
	return `${listId}-${index}`
}
