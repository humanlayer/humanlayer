import { Button } from '@humanlayer/ui/components/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@humanlayer/ui/components/dropdown-menu'
import { cn } from '@humanlayer/ui/lib/utils'
import { Ellipsis } from 'lucide-react'
import { Fragment, useRef, useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'

import type { ArtifactActionDescriptor, ArtifactActionKey, ArtifactActionTrayProps } from './ArtifactActionTray.types'

function sameKeys(left: readonly ArtifactActionKey[], right: readonly ArtifactActionKey[]) {
	return left.length === right.length && left.every((key, index) => key === right[index])
}

export function ArtifactActionTray({
	actions,
	overflowOrder,
	optionalLeading,
	fixedAction,
	size,
}: ArtifactActionTrayProps) {
	const rootRef = useRef<HTMLDivElement>(null)
	const frameRef = useRef<number | null>(null)
	const [hiddenKeys, setHiddenKeys] = useState<readonly ArtifactActionKey[]>([])
	const [isOptionalLeadingHidden, setIsOptionalLeadingHidden] = useState(false)
	const hiddenKeySet = new Set(hiddenKeys)
	const leadingActions = actions.filter((action) => action.placement === 'leading')
	const trailingActions = actions.filter((action) => action.placement === 'trailing')
	const hiddenActions = actions.filter((action) => hiddenKeySet.has(action.key))

	useMountEffect(() => {
		const root = rootRef.current
		if (!root) return

		const measure = () => {
			frameRef.current = null
			const items = Array.from(root.querySelectorAll<HTMLElement>('[data-artifact-tray-item]'))
			const itemsByKey = new Map(
				items.map((item) => [item.dataset.artifactTrayItem as ArtifactActionKey | undefined, item]),
			)
			const more = root.querySelector<HTMLElement>('[data-artifact-tray-more]')
			const fixed = root.querySelector<HTMLElement>('[data-artifact-tray-fixed]')
			const optional = root.querySelector<HTMLElement>('[data-artifact-tray-optional-leading]')
			if (!more || !fixed) return

			for (const item of items) item.style.display = 'flex'
			if (optional) optional.style.display = 'flex'
			more.style.display = 'none'

			const styles = getComputedStyle(root)
			const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0
			const paddingRight = Number.parseFloat(styles.paddingRight) || 0
			const available = root.clientWidth - paddingLeft - paddingRight
			if (available <= 0) return
			const gap = Number.parseFloat(styles.columnGap) || 0
			const widthOf = (element: HTMLElement) => element.getBoundingClientRect().width
			const fits = () => {
				const visibleItems = items.filter((item) => item.style.display !== 'none')
				const controls = [...visibleItems]
				if (optional && optional.style.display !== 'none') controls.unshift(optional)
				if (more.style.display !== 'none') controls.push(more)
				controls.push(fixed)
				return (
					controls.reduce((total, element) => total + widthOf(element), 0) +
						gap * Math.max(controls.length - 1, 0) <=
					available
				)
			}

			const nextHidden: ArtifactActionKey[] = []
			if (!fits()) {
				more.style.display = 'flex'
				for (const key of overflowOrder) {
					if (fits()) break
					const item = itemsByKey.get(key)
					if (!item) continue
					item.style.display = 'none'
					nextHidden.push(key)
				}
				if (!fits() && optional) optional.style.display = 'none'
			}

			const nextOptionalLeadingHidden = optional?.style.display === 'none'
			for (const item of items) item.style.removeProperty('display')
			optional?.style.removeProperty('display')
			more.style.removeProperty('display')
			setHiddenKeys((current) => (sameKeys(current, nextHidden) ? current : nextHidden))
			setIsOptionalLeadingHidden(nextOptionalLeadingHidden)
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

	const renderAction = (action: ArtifactActionDescriptor) => (
		<div
			key={action.key}
			data-artifact-tray-item={action.key}
			className={cn(
				'shrink-0',
				// Preserve the header height through the wrapper for underline tabs and dividers.
				action.placement === 'leading' && 'flex items-center self-stretch',
				hiddenKeySet.has(action.key) && 'hidden',
			)}
		>
			{action.inline}
		</div>
	)

	return (
		<div
			ref={rootRef}
			aria-label="Artifact action tray"
			className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 self-stretch overflow-hidden"
		>
			{optionalLeading ? (
				<div
					data-artifact-tray-optional-leading
					className={cn('min-w-0 shrink-0', isOptionalLeadingHidden && 'hidden')}
				>
					{optionalLeading}
				</div>
			) : null}
			{leadingActions.map(renderAction)}
			<div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
				{trailingActions.map(renderAction)}
				<div data-artifact-tray-more className={cn('shrink-0', hiddenActions.length === 0 && 'hidden')}>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className={size === 'sm' ? 'size-6' : 'size-8'}
								aria-label={`More artifact actions (${hiddenActions.length})`}
								title={`${hiddenActions.length} more artifact actions`}
							>
								<Ellipsis aria-hidden className={size === 'sm' ? 'size-3.5' : 'size-4'} />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="min-w-56">
							{hiddenActions.map((action) => (
								<Fragment key={action.key}>{action.overflow}</Fragment>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				<div data-artifact-tray-fixed className="shrink-0">
					{fixedAction}
				</div>
			</div>
		</div>
	)
}
