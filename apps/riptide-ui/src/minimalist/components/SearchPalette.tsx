import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useMountEffect } from '@/hooks/useMountEffect'
import {
	type PaletteItem,
	useActionResults,
	useDocumentResults,
	useTaskResults,
} from '@/minimalist/components/PaletteItems'
import { openModal } from '@/minimalist/lib/modal'
import { useMinimalistPortal } from '@/minimalist/lib/portal'
import { useUi } from '@/minimalist/lib/ui-state'

export function SearchPalette() {
	const portal = useMinimalistPortal()
	const { searchOpen } = useUi()
	if (!searchOpen || !portal) return null
	return createPortal(<Palette />, portal)
}

/** Mounted only while open, so the artifact and host queries don't run in the background. */
function Palette() {
	const { setSearchOpen } = useUi()
	const [query, setQuery] = useState('')
	const [active, setActive] = useState(0)
	const listId = useId()
	const tasks = useTaskResults(query)
	const documents = useDocumentResults(query)
	const actions = useActionResults(query)
	const items = [...tasks, ...documents, ...actions]
	const close = () => setSearchOpen(false)
	// Modal: it focuses the search field, keeps focus inside, the page behind is inert, and Escape cancels. Closing hands focus back.
	const ref = useRef<HTMLDialogElement>(null)
	useMountEffect(() => openModal(ref.current))
	const pick = (item: PaletteItem | undefined) => {
		if (!item) return
		item.run()
		close()
	}
	const sections = [
		{ label: 'Tasks', list: tasks },
		{ label: 'Documents', list: documents },
		{ label: 'Actions', list: actions },
	]

	return (
		<dialog
			ref={ref}
			className="pop palette"
			aria-label="Search"
			onCancel={(event) => {
				event.preventDefault()
				close()
			}}
			// A click that lands on the dialog itself is on the backdrop around it.
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) close()
			}}
		>
			<input
				role="combobox"
				aria-expanded={items.length > 0}
				aria-autocomplete="list"
				aria-controls={listId}
				aria-activedescendant={items[active] ? rowId(listId, items[active].id) : undefined}
				aria-label="Search tasks, documents and actions"
				placeholder="Search tasks, documents and actions"
				value={query}
				onChange={(event) => {
					setQuery(event.target.value)
					setActive(0)
				}}
				onKeyDown={(event) => {
					if (event.key === 'ArrowDown') {
						event.preventDefault()
						setActive((index) => Math.min(items.length - 1, index + 1))
					}
					if (event.key === 'ArrowUp') {
						event.preventDefault()
						setActive((index) => Math.max(0, index - 1))
					}
					if (event.key === 'Enter') pick(items[active])
					if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
						event.preventDefault()
						pick(tasks[Number(event.key) - 1])
					}
				}}
			/>
			{items.length === 0 ? (
				<div className="palette-empty" role="status">
					No matches
				</div>
			) : null}
			<div className="palette-body" id={listId} role="listbox" aria-label="Results" hidden={items.length === 0}>
				{sections.map(({ label, list }) =>
					list.length > 0 ? (
						<div key={label} role="group" aria-label={label}>
							<div className="lbl">{label}</div>
							{list.map((item) => (
								<PaletteRow
									key={item.id}
									id={rowId(listId, item.id)}
									item={item}
									active={items[active]?.id === item.id}
									onPick={() => pick(item)}
								/>
							))}
						</div>
					) : null,
				)}
			</div>
		</dialog>
	)
}

function PaletteRow({
	id,
	item,
	active,
	onPick,
}: {
	id: string
	item: PaletteItem
	active: boolean
	onPick: () => void
}) {
	return (
		<button
			type="button"
			id={id}
			className="mi"
			role="option"
			aria-selected={active}
			tabIndex={-1}
			data-active={active}
			onClick={onPick}
			ref={active ? (node) => node?.scrollIntoView({ block: 'nearest' }) : undefined}
		>
			{item.icon}
			<span className="ell">{item.label}</span>
			<span className="sp" />
			{item.detail ? <span className="d">{item.detail}</span> : null}
			{item.kbd ? <span className="kbd">{item.kbd}</span> : null}
		</button>
	)
}

function rowId(listId: string, itemId: string) {
	return `${listId}-${itemId}`
}
