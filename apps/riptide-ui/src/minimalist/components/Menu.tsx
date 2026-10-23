import { type ReactNode, type RefObject, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useMountEffect } from '@/hooks/useMountEffect'
import { openModal } from '@/minimalist/lib/modal'
import { useMinimalistPortal } from '@/minimalist/lib/portal'

type Placement = 'above-start' | 'below-start' | 'below-end' | 'above-end'

/**
 * A popover anchored to a trigger. Clicking outside or pressing Escape closes it.
 * Positioned with fixed coordinates so it never clips inside a scrolling column.
 */
export function Menu({
	anchor,
	open,
	onClose,
	placement = 'below-start',
	width = 260,
	children,
}: {
	anchor: RefObject<HTMLElement | null>
	open: boolean
	onClose: () => void
	placement?: Placement
	width?: number
	children: ReactNode
}) {
	const portal = useMinimalistPortal()
	if (!open || !portal) return null
	return (
		<OpenMenu anchor={anchor} onClose={onClose} placement={placement} width={width} portal={portal}>
			{children}
		</OpenMenu>
	)
}

function OpenMenu({
	anchor,
	onClose,
	placement,
	width,
	portal,
	children,
}: {
	anchor: RefObject<HTMLElement | null>
	onClose: () => void
	placement: Placement
	width: number
	portal: HTMLElement
	children: ReactNode
}) {
	const ref = useRef<HTMLDialogElement>(null)
	const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' })
	useMountEffect(() => {
		const trigger = anchor.current
		const close = openModal(ref.current, trigger)
		// The trigger says its menu is open; the row that holds it keeps its buttons showing by that.
		trigger?.setAttribute('aria-expanded', 'true')
		const place = () => {
			if (!trigger) return
			const rect = trigger.getBoundingClientRect()
			const actualWidth = Math.min(width, window.innerWidth - 16)
			const desiredLeft = placement.endsWith('end') ? rect.right - actualWidth : rect.left
			const left = Math.max(8, Math.min(desiredLeft, window.innerWidth - actualWidth - 8))
			const above = placement.startsWith('above')
			const available = above ? rect.top - 14 : window.innerHeight - rect.bottom - 14
			setStyle({
				left,
				width: actualWidth,
				maxHeight: Math.max(80, available),
				top: above ? 'auto' : rect.bottom + 6,
				bottom: above ? window.innerHeight - rect.top + 6 : 'auto',
			})
		}
		place()
		const frame = requestAnimationFrame(() =>
			ref.current?.querySelector<HTMLElement>('button:not(:disabled), input')?.focus(),
		)
		window.addEventListener('resize', place)
		return () => {
			// Focus goes back first, so the row still shows the trigger when it arrives.
			close()
			trigger?.setAttribute('aria-expanded', 'false')
			cancelAnimationFrame(frame)
			window.removeEventListener('resize', place)
		}
	})
	return createPortal(
		<dialog
			ref={ref}
			className="pop"
			style={style}
			aria-label="Options"
			tabIndex={-1}
			onCancel={(event) => {
				event.preventDefault()
				onClose()
			}}
			onClick={(event) => {
				if (event.target !== event.currentTarget) return
				const rect = event.currentTarget.getBoundingClientRect()
				if (
					event.clientX < rect.left ||
					event.clientX > rect.right ||
					event.clientY < rect.top ||
					event.clientY > rect.bottom
				)
					onClose()
			}}
			onKeyDown={(event) => {
				if (event.key === 'Escape') {
					event.preventDefault()
					onClose()
				}
			}}
		>
			{children}
		</dialog>,
		portal,
	)
}

export function MenuItem({
	icon,
	label,
	detail,
	checked,
	disabled,
	onSelect,
	kbd,
}: {
	icon?: ReactNode
	label: ReactNode
	detail?: string
	checked?: boolean
	disabled?: boolean
	onSelect?: () => void
	/** A shortcut hint on the right, like ⇧⌘A. */
	kbd?: string
}) {
	return (
		<button
			type="button"
			className="mi"
			aria-disabled={disabled}
			disabled={disabled}
			onClick={() => {
				if (!disabled) onSelect?.()
			}}
		>
			{icon}
			<div className="lines">
				<div>{label}</div>
				{detail ? <div className="d">{detail}</div> : null}
			</div>
			<span className="sp" />
			{kbd ? <span className="kbd">{kbd}</span> : null}
			{checked ? <span className="check">✓</span> : null}
		</button>
	)
}

export function MenuLabel({ children }: { children: ReactNode }) {
	return <div className="lbl">{children}</div>
}

export function MenuSeparator() {
	return <div className="sep" />
}
