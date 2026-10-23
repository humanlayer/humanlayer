import { type KeyboardEvent, type PointerEvent, useState } from 'react'

import { clampWidth, type PaneId, PANES, saveWidth, storedWidth } from '@/minimalist/lib/panel-widths'

const STEP = 16

/**
 * A drag edge for a pane. `edge` is the side of the pane it sits on: dragging away from the
 * pane widens it. Double-click resets the default width; arrow keys move it in steps.
 */
export function ResizeHandle({ pane, edge }: { pane: PaneId; edge: 'left' | 'right' }) {
	const { variable, label, min, max } = PANES[pane]
	const [width, setWidth] = useState<number | null>(() => storedWidth(pane))
	const apply = (element: HTMLElement, next: number | null) => {
		const root = element.closest<HTMLElement>('.minimalist-ui')
		if (next === null) root?.style.removeProperty(variable)
		else root?.style.setProperty(variable, `${next}px`)
		setWidth(next)
	}
	const currentWidth = (element: HTMLElement) => element.parentElement?.getBoundingClientRect().width ?? min

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return
		event.preventDefault()
		const handle = event.currentTarget
		const startX = event.clientX
		const startWidth = currentWidth(handle)
		let latest = startWidth
		const root = handle.closest<HTMLElement>('.minimalist-ui')
		handle.setPointerCapture(event.pointerId)
		root?.classList.add('pane-resizing')
		const move = (moveEvent: globalThis.PointerEvent) => {
			const delta = moveEvent.clientX - startX
			latest = clampWidth(pane, startWidth + (edge === 'right' ? delta : -delta))
			apply(handle, latest)
		}
		const stop = () => {
			handle.removeEventListener('pointermove', move)
			handle.removeEventListener('pointerup', stop)
			handle.removeEventListener('pointercancel', stop)
			root?.classList.remove('pane-resizing')
			saveWidth(pane, latest)
		}
		handle.addEventListener('pointermove', move)
		handle.addEventListener('pointerup', stop)
		handle.addEventListener('pointercancel', stop)
	}

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const grow = edge === 'right' ? 'ArrowRight' : 'ArrowLeft'
		const shrink = edge === 'right' ? 'ArrowLeft' : 'ArrowRight'
		if (event.key !== grow && event.key !== shrink) return
		event.preventDefault()
		const next = clampWidth(pane, currentWidth(event.currentTarget) + (event.key === grow ? STEP : -STEP))
		apply(event.currentTarget, next)
		saveWidth(pane, next)
	}

	return (
		<div
			className={`resize-handle ${edge}`}
			role="separator"
			aria-orientation="vertical"
			aria-label={`Resize ${label}`}
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={width ?? undefined}
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
