import { Check, ChevronDown, LoaderCircle, MessageSquareShare } from 'lucide-react'

import { Button } from '../../components/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/dropdown-menu'
import { cn } from '../../lib/utils'
import type { ArtifactDeliveryCapability, ArtifactDeliveryMode } from './types'

interface ThreadDeliveryControlBaseProps {
	pending?: boolean
	error?: string | null
	className?: string
	mode?: ArtifactDeliveryMode
	onModeChange?: (mode: ArtifactDeliveryMode) => void
	/**
	 * Keep the label on one line, and show only an icon when the nearest `@container`
	 * ancestor is narrower than 15rem. The label stays the accessible name and tooltip.
	 */
	compact?: boolean
}

export type ThreadDeliveryControlProps = ThreadDeliveryControlBaseProps &
	(
		| {
				capability: Extract<ArtifactDeliveryCapability, { kind: 'send' | 'queue' }>
				onDeliver: (mode: ArtifactDeliveryMode) => void
				onCopy?: never
		  }
		| {
				capability: Extract<ArtifactDeliveryCapability, { kind: 'copy' }>
				onCopy: () => void
				onDeliver?: never
		  }
	)

/** Quiet per-thread action for one open root thread. */
export function ThreadDeliveryControl({
	capability,
	pending = false,
	error,
	onDeliver,
	onCopy,
	className,
	mode = 'send',
	onModeChange,
	compact = false,
}: ThreadDeliveryControlProps) {
	const label = capability.kind === 'copy'
		? 'Copy for Agent'
		: mode === 'send-and-resolve'
			? 'Send to Agent & Resolve'
			: 'Send to Agent'
	if (capability.kind === 'copy' ? !onCopy : !onDeliver) return null
	const runAction = () => {
		if (capability.kind === 'copy') onCopy?.()
		else onDeliver?.(mode)
	}

	return (
		<div className={cn('space-y-1', className)}>
			<div className="flex items-stretch">
				<button
					type="button"
					disabled={pending}
					onClick={runAction}
					aria-label={compact ? label : undefined}
					title={compact ? label : undefined}
					className={cn('artifact-viewer-v2-comment-thread-action', compact && 'whitespace-nowrap')}
				>
					{pending ? (
						<LoaderCircle className="h-3 w-3 animate-spin" />
					) : compact ? (
						<MessageSquareShare aria-hidden="true" className="hidden h-3 w-3 @max-[15rem]:block" />
					) : null}
					{compact ? <span className="@max-[15rem]:hidden">{label}</span> : label}
				</button>
				{capability.kind !== 'copy' && onModeChange ? (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button type="button" variant="ghost" size="icon" className="size-6" aria-label="Choose thread delivery mode">
								<ChevronDown className="size-3" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{(['send', 'send-and-resolve'] as const).map((item) => (
								<DropdownMenuItem key={item} onSelect={() => onModeChange(item)}>
									{item === mode ? <Check className="size-3" /> : <span className="size-3" />}
									{item === 'send' ? 'Send to Agent' : 'Send to Agent & Resolve'}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				) : null}
			</div>
			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
		</div>
	)
}
