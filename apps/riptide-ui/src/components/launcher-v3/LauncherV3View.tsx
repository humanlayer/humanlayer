import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Popover, PopoverContent, PopoverTrigger } from '@humanlayer/ui/components/popover'
import { cn } from '@humanlayer/ui/lib/utils'
import { Ellipsis, Loader2, Send } from 'lucide-react'
import { isValidElement, type ReactNode, useRef, useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { formatShortcut, hotkeysCatalog } from '@/hotkeysCatalog'

const TRAY_OVERFLOW_KEYS = ['attachments', 'permission', 'auto-advance', 'host', 'directory', 'workflow', 'worktree']

function collectRenderedSlots(children: ReactNode): ReadonlyMap<string, ReactNode> {
	const renderedChildren = Array.isArray(children) ? children : [children]
	return new Map(
		renderedChildren.flatMap((child) =>
			isValidElement(child) && child.key !== null ? [[String(child.key), child] as const] : [],
		),
	)
}

/**
 * Provider-free Launcher V3 page layout. Callers fill its keyed slots with rendered leaves.
 *
 * The composer and its expanded content are one contiguous surface. A fixed
 * responsive top spacer preserves the initial composer position while the
 * flexible bottom spacer collapses as expanded content grows downward.
 */
export function LauncherV3View({ children }: { children: ReactNode }) {
	const slots = collectRenderedSlots(children)
	return (
		<main className="scrollbar-hide h-full w-full min-h-0 overflow-y-auto overscroll-y-contain">
			<div className="flex min-h-full w-full flex-col px-4 pb-16 sm:px-6">
				<div aria-hidden className="h-[clamp(2rem,8vh,6rem)] shrink-0" />
				<div className="mx-auto w-full min-w-0 max-w-[1400px]">
					<div className="@container/layout flex min-w-0 flex-col items-center">
						<div className="flex w-full min-w-0 max-w-4xl flex-col">
							<h1 className="mb-6 text-center text-3xl font-medium tracking-tight">
								What should we build today?
							</h1>
							<div className="mb-4 min-h-6">{slots.get('identity')}</div>
							<div className="@container/frame min-w-0 border-l-2 border-l-[var(--terminal-accent)] bg-foreground/10">
								{slots.get('prompt')}
								{(slots.has('uploads') || slots.has('agent')) && (
									<div
										aria-label="Attached context and model"
										className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2"
									>
										{slots.get('uploads')}
										<div className="ml-auto shrink-0">{slots.get('agent')}</div>
									</div>
								)}
								{slots.get('tray')}
							</div>
							{slots.get('host-state')}
							{slots.get('host-pressure')}
							{slots.get('status')}
							{slots.get('progress')}
							{slots.has('chips') && <div className="mt-2">{slots.get('chips')}</div>}
							<div className="group/drafts contents">
								{slots.get('drafts')}
								<div className="contents group-has-[[data-launcher-recent-drafts]]/drafts:hidden">
									{slots.get('workflow-graph')}
									{slots.get('workspace')}
								</div>
							</div>
						</div>
					</div>
				</div>
				<div aria-hidden className="flex-1" />
			</div>
		</main>
	)
}

/** Provider-free tray layout. Its keyed children preserve the TDD's control order. */
export function LauncherTrayView({ children }: { children: ReactNode }) {
	const slots = collectRenderedSlots(children)
	const rootRef = useRef<HTMLDivElement>(null)
	const frameRef = useRef<number | null>(null)
	const [layout, setLayout] = useState<{ density: 'wide' | 'compact' | 'minimal'; hidden: readonly string[] }>({
		density: 'wide',
		hidden: [],
	})
	const itemKeys = [...slots.keys()].filter((key) => key !== 'submit')

	useMountEffect(() => {
		const root = rootRef.current
		if (!root) return

		const measure = () => {
			frameRef.current = null
			const items = Array.from(root.querySelectorAll<HTMLElement>(':scope > [data-launcher-tray-item]'))
			const itemsByKey = new Map(items.map((item) => [item.dataset.launcherTrayItem, item]))
			const more = root.querySelector<HTMLElement>(':scope > [data-launcher-tray-more-wrapper]')
			const submit = root.querySelector<HTMLElement>(':scope > [data-launcher-tray-submit]')
			if (!more || !submit) return

			for (const item of items) item.style.display = 'flex'
			more.style.display = 'none'

			const styles = getComputedStyle(root)
			const available =
				root.clientWidth - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight)
			if (available <= 0) return
			const gap = Number.parseFloat(styles.columnGap) || 0
			const widthOf = (element: HTMLElement) => element.getBoundingClientRect().width
			const fits = () => {
				const visible = items.filter((item) => item.style.display !== 'none')
				const controls = [...visible]
				if (more.style.display !== 'none') controls.push(more)
				controls.push(submit)
				return (
					controls.reduce((total, element) => total + widthOf(element), 0) + gap * (controls.length - 1) <=
					available
				)
			}

			const candidates = ['wide', 'compact', 'minimal'] as const
			let density: 'wide' | 'compact' | 'minimal' = 'wide'
			for (const candidate of candidates) {
				root.dataset.density = candidate
				density = candidate
				if (fits()) break
			}

			const hidden: string[] = []
			if (!fits()) {
				more.style.display = 'flex'
				for (const key of TRAY_OVERFLOW_KEYS) {
					if (fits()) break
					const item = itemsByKey.get(key)
					if (!item) continue
					item.style.display = 'none'
					hidden.push(key)
				}
			}

			for (const item of items) item.style.removeProperty('display')
			more.style.removeProperty('display')
			setLayout((current) =>
				current.density === density && current.hidden.join(':') === hidden.join(':')
					? current
					: { density, hidden },
			)
		}

		const scheduleMeasure = () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
			frameRef.current = requestAnimationFrame(measure)
		}
		const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
		const mutationObserver = new MutationObserver(scheduleMeasure)
		resizeObserver?.observe(root)
		mutationObserver.observe(root, { childList: true, subtree: true, characterData: true })
		scheduleMeasure()

		return () => {
			resizeObserver?.disconnect()
			mutationObserver.disconnect()
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
		}
	})

	return (
		<div
			ref={rootRef}
			aria-label="Launch controls"
			data-density={layout.density}
			className="group/tray @container/tray flex w-full min-w-0 flex-nowrap items-center gap-1 overflow-hidden bg-foreground/5 p-2 text-foreground"
		>
			{itemKeys.map((key) => (
				<div
					key={key}
					data-launcher-tray-item={key}
					data-launcher-tray-measure
					className={cn(
						key === 'directory'
							? 'max-w-80 shrink-0'
							: key === 'host'
								? 'min-w-[50px] shrink group-data-[density=wide]/tray:min-w-[160px]'
								: 'shrink-0',
						layout.hidden.includes(key) && 'hidden',
					)}
				>
					{slots.get(key)}
				</div>
			))}
			<div
				data-launcher-tray-more-wrapper
				data-launcher-tray-measure
				className={cn('shrink-0', layout.hidden.length === 0 && 'hidden')}
			>
				<Popover>
					<PopoverTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label={`More launch controls (${layout.hidden.length})`}
							title={`${layout.hidden.length} more launch controls`}
							className="size-7"
						>
							<Ellipsis aria-hidden className="size-3.5" />
						</Button>
					</PopoverTrigger>
					<PopoverContent
						align="end"
						className="w-auto min-w-64 p-2"
						onFocusOutside={(event) => event.preventDefault()}
					>
						<p className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
							Launch controls
						</p>
						<div data-density="wide" className="group/tray flex flex-col items-stretch gap-1">
							{layout.hidden.map((key) => (
								<div key={key} className="flex min-w-0 items-center">
									{slots.get(key)}
								</div>
							))}
						</div>
					</PopoverContent>
				</Popover>
			</div>
			<div data-launcher-tray-submit data-launcher-tray-measure className="ml-auto shrink-0">
				{slots.get('submit')}
			</div>
		</div>
	)
}

export function LauncherWorkflowSummary() {
	return (
		<span className="whitespace-nowrap px-2 font-mono text-xs font-medium uppercase tracking-wider text-foreground">
			Freeform
		</span>
	)
}

export interface LauncherV3SubmitProps {
	disabled?: boolean
	submitting?: boolean
	waiting?: boolean
	/** Platform-aware label for the active Send-message binding. */
	submitShortcutLabel?: string
}

/** Pure submit/readiness display. The owning form supplies native submit behavior. */
export function LauncherV3Submit({
	disabled = false,
	submitting = false,
	waiting = false,
	submitShortcutLabel = formatShortcut(hotkeysCatalog.textEditing.shortcuts.submit.display),
}: LauncherV3SubmitProps) {
	const busy = submitting || waiting
	return (
		<Button
			type="submit"
			variant="default"
			aria-label="Create task"
			title={
				waiting
					? 'Waiting for a task title'
					: submitting
						? 'Creating task'
						: `Create task (${submitShortcutLabel})`
			}
			disabled={disabled || busy}
			className="ml-auto h-7 px-2 text-xs"
		>
			{busy ? (
				<Loader2 aria-hidden className="size-3.5 animate-spin" />
			) : (
				<Send aria-hidden className="size-3.5" />
			)}
			<span className="group-data-[density=compact]/tray:hidden group-data-[density=minimal]/tray:hidden">
				{waiting ? 'Waiting...' : submitting ? 'Creating...' : 'Create task'}
			</span>
			{!busy && (
				<KeyboardShortcut size="xs" className="group-data-[density=minimal]/tray:hidden">
					{submitShortcutLabel}
				</KeyboardShortcut>
			)}
		</Button>
	)
}

export interface LauncherV3StatusProps {
	message: string | null
	waiting?: boolean
}

/** Readiness feedback sits below the composer so it never changes the tray layout. */
export function LauncherV3Status({ message, waiting = false }: LauncherV3StatusProps) {
	if (!message) return null
	return (
		<div className="mt-2 flex min-h-5 items-center justify-end gap-2 px-1 text-right font-mono text-xs text-muted-foreground">
			{waiting && <Loader2 aria-hidden className="size-3 animate-spin text-[var(--terminal-success)]" />}
			<p role={waiting ? 'status' : 'alert'}>{message}</p>
		</div>
	)
}
