import { Check, ChevronDown, Clipboard, LoaderCircle, MessageSquareShare } from 'lucide-react'

import { Button } from '../../components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/dropdown-menu'
import { KeyboardShortcut } from '../../components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/tooltip'
import { cn } from '../../lib/utils'
import type { ArtifactDeliveryCapability, ArtifactDeliveryMode } from './types'

interface BulkDeliveryControlBaseProps {
	mode: ArtifactDeliveryMode
	count: number
	pending?: boolean
	error?: string | null
	onResolveSentComments?: (() => void) | null
	isNarrow?: boolean
	menuOnly?: boolean
	showShortcut?: boolean
	primaryLabel?: string
	className?: string
}

export type BulkDeliveryControlProps = BulkDeliveryControlBaseProps &
	(
		| {
				capability: Extract<ArtifactDeliveryCapability, { kind: 'send' | 'queue' }>
				onDeliver: (mode: ArtifactDeliveryMode) => void
				onModeChange: (mode: ArtifactDeliveryMode) => void
				onCopy?: never
		  }
		| {
				capability: Extract<ArtifactDeliveryCapability, { kind: 'copy' }>
				onCopy: () => void
				onDeliver?: never
				onModeChange?: never
		  }
	)

export function BulkDeliveryControl({
	capability,
	mode,
	count,
	pending = false,
	error,
	onDeliver,
	onModeChange,
	onCopy,
	onResolveSentComments,
	isNarrow = false,
	menuOnly = false,
	showShortcut = true,
	primaryLabel,
	className,
}: BulkDeliveryControlProps) {
	if (count === 0) return null
	const disabled = pending || count === 0
	if (capability.kind === 'copy') {
		return (
			<div className={cn('artifact-viewer-v2-bulk-delivery space-y-1', className)}>
				<Button size="sm" variant="outline" disabled={disabled} onClick={onCopy} className="w-full justify-center">
					<Clipboard className="h-3.5 w-3.5" /> Copy for Agent ({count})
				</Button>
				{error ? (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				) : null}
			</div>
		)
	}
	if (!onDeliver || !onModeChange) return null

	const label = primaryLabel ?? (mode === 'send-and-resolve' ? 'Send + Resolve' : 'Send to Agent')
	const selectMode = (selectedMode: ArtifactDeliveryMode) => {
		onModeChange(selectedMode)
		if (menuOnly) onDeliver(selectedMode)
	}
	const modeMenu = (
		<DropdownMenuContent align="end" className="min-w-[260px]">
			{(['send', 'send-and-resolve'] as const).map((item) => (
				<DropdownMenuItem
					key={item}
					onSelect={() => selectMode(item)}
					className="flex items-center justify-between focus:[&_svg]:!text-background"
				>
					<div className="flex items-center gap-2">
						<MessageSquareShare className="h-3.5 w-3.5" />
						<span>{item === 'send' ? 'Send all Comments to Agent' : 'Send all Comments to Agent & Resolve'}</span>
					</div>
					{item === mode ? <Check className="h-3.5 w-3.5 text-muted-foreground" /> : null}
				</DropdownMenuItem>
			))}
		</DropdownMenuContent>
	)

	if (menuOnly) {
		return (
			<div className={cn('artifact-viewer-v2-bulk-delivery', className)}>
				<DropdownMenu>
					<Tooltip>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									disabled={disabled}
									aria-label={`${label}: ${count} open ${count === 1 ? 'comment' : 'comments'}`}
									className="h-8 min-w-8 gap-1 px-2 text-xs"
								>
									{pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <MessageSquareShare className="h-3.5 w-3.5" />}
									<span className="opacity-70">{count}</span>
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent>{label} ({count})</TooltipContent>
					</Tooltip>
					{modeMenu}
				</DropdownMenu>
			</div>
		)
	}

	return (
		<div className={cn('artifact-viewer-v2-bulk-delivery space-y-1', className)}>
			<div role="group" aria-label="Send comments actions" className="flex items-stretch">
				<Button
					variant="default"
					disabled={disabled}
					onClick={() => onDeliver(mode)}
					aria-label={`${label}: ${count} open ${count === 1 ? 'comment' : 'comments'}`}
					className="h-auto min-w-0 flex-1 rounded-r-none px-2 py-0.5 text-xs"
				>
					{pending ? (
						<LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
					) : (
						<MessageSquareShare className="mr-1 h-3 w-3" />
					)}
					{isNarrow ? null : <span className="artifact-viewer-v2-bulk-delivery-label">{label}</span>}
					<span className="artifact-viewer-v2-bulk-delivery-count opacity-70">
						{isNarrow ? count : `(${count})`}
					</span>
					{showShortcut ? (
						<KeyboardShortcut size="xs" className="artifact-viewer-v2-bulk-delivery-shortcut ml-1">
							⌥+C
						</KeyboardShortcut>
					) : null}
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
								variant="default"
								disabled={disabled}
								aria-label="Choose delivery mode"
								className="h-auto rounded-l-none border-l-0 px-1.5 py-0.5 text-xs"
						>
							<ChevronDown className="h-3.5 w-3.5" />
						</Button>
					</DropdownMenuTrigger>
					{modeMenu}
				</DropdownMenu>
			</div>
			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
			{onResolveSentComments ? (
				<Button size="sm" variant="outline" disabled={pending} onClick={onResolveSentComments}>
					Resolve Sent Comments
				</Button>
			) : null}
		</div>
	)
}
