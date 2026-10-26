import { type KeyboardEvent, type PointerEvent, useState } from 'react'

import { clampWidth, type PaneId, PANES, saveWidth, storedWidth } from '@/minimalist/lib/panel-widths'

const STEP = 16

/**
 * A drag edge for a pane. `edge` is the side of the pane it sits on: dragging away from the
 * pane makes it bigger. A left or right edge sets a width, a bottom edge sets a height.
 * Double-click resets the default size; arrow keys move it in steps.
 */
export function ResizeHandle({ pane, edge }: { pane: PaneId; edge: 'left' | 'right' | 'bottom' }) {
	const { variable, label, min, max } = PANES[pane]
	const rows = edge === 'bottom'
	const [size, setSize] = useState<number | null>(() => storedWidth(pane))
	const apply = (element: HTMLElement, next: number | null) => {
		const root = element.closest<HTMLElement>('.minimalist-ui')
		if (next === null) root?.style.removeProperty(variable)
		else root?.style.setProperty(variable, `${next}px`)
		setSize(next)
	}
	const currentSize = (element: HTMLElement) => {
		const rect = element.parentElement?.getBoundingClientRect()
		return (rows ? rect?.height : rect?.width) ?? min
	}

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return
		event.preventDefault()
		const handle = event.currentTarget
		const start = rows ? event.clientY : event.clientX
		const startSize = currentSize(handle)
		let latest = startSize
		const root = handle.closest<HTMLElement>('.minimalist-ui')
		const resizing = rows ? 'pane-resizing-rows' : 'pane-resizing'
		handle.setPointerCapture(event.pointerId)
		root?.classList.add(resizing)
		const move = (moveEvent: globalThis.PointerEvent) => {
			const delta = (rows ? moveEvent.clientY : moveEvent.clientX) - start
			latest = clampWidth(pane, startSize + (edge === 'left' ? -delta : delta))
			apply(handle, latest)
		}
		const stop = () => {
			handle.removeEventListener('pointermove', move)
			handle.removeEventListener('pointerup', stop)
			handle.removeEventListener('pointercancel', stop)
			root?.classList.remove(resizing)
			saveWidth(pane, latest)
		}
		handle.addEventListener('pointermove', move)
		handle.addEventListener('pointerup', stop)
		handle.addEventListener('pointercancel', stop)
	}

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const grow = rows ? 'ArrowDown' : edge === 'right' ? 'ArrowRight' : 'ArrowLeft'
		const shrink = rows ? 'ArrowUp' : edge === 'right' ? 'ArrowLeft' : 'ArrowRight'
		if (event.key !== grow && event.key !== shrink) return
		event.preventDefault()
		const next = clampWidth(pane, currentSize(event.currentTarget) + (event.key === grow ? STEP : -STEP))
		apply(event.currentTarget, next)
		saveWidth(pane, next)
	}

	return (
		<div
			className={`resize-handle ${edge}`}
			role="separator"
			aria-orientation={rows ? 'horizontal' : 'vertical'}
			aria-label={`Resize ${label}`}
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={size ?? undefined}
			tabIndex={0}
			title="Drag to resize. Double-click to reset."
			onPointerDown={onPointerDown}
			onKeyDown={onKeyDown}
			onDoubleClick={(event) => {
				apply(event.currentTarget, null)
				saveWidth(pane, null)
			}}
		/>
	)
}
