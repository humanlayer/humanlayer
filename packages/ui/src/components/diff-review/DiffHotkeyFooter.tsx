import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, ExternalLink, Maximize2, MessageSquare, Minimize2, MousePointerClick, type LucideIcon } from 'lucide-react'

interface DiffHotkeyFooterProps {
	canExtendRange: boolean
	isFullscreen: boolean
}

interface HotkeyHint {
	key: string
	Icon: LucideIcon
}

const BASE_HINTS: readonly HotkeyHint[] = [
	{ key: 'j', Icon: ArrowDown },
	{ key: 'k', Icon: ArrowUp },
	{ key: 'h', Icon: ChevronRight },
	{ key: 'l', Icon: ChevronDown },
	{ key: 'c', Icon: MessageSquare },
	{ key: 'v', Icon: Check },
	{ key: 'o', Icon: ExternalLink },
]

/** Static reminder of the commands available at the keyboard-owned diff target. */
export function DiffHotkeyFooter({ canExtendRange, isFullscreen }: DiffHotkeyFooterProps) {
	const hints: readonly HotkeyHint[] = [
		...BASE_HINTS,
		{ key: 'f', Icon: isFullscreen ? Minimize2 : Maximize2 },
	]

	return (
		<div
			data-diff-hotkey-footer
			aria-hidden="true"
			className="flex shrink-0 select-none items-center gap-2.5 overflow-hidden border-t border-border bg-[color-mix(in_srgb,var(--terminal-bg)_82%,transparent)] px-2 py-1 text-[var(--terminal-fg-dim)]"
		>
			{hints.map((hint, index) => (
				<div key={hint.key} className="contents">
					<div className="inline-flex items-center gap-1 leading-none">
						<kbd className="min-w-3 bg-[color-mix(in_srgb,var(--terminal-fg)_12%,transparent)] px-[3px] text-center font-mono text-[10px] font-semibold text-[var(--terminal-fg)]">
							{hint.key}
						</kbd>
						<hint.Icon className="size-3" />
					</div>
					{index === 1 && canExtendRange ? (
						<div className="inline-flex items-center gap-1 leading-none" title="Shift-click or Shift-J/K extends the selected line range">
							<kbd className="min-w-3 bg-[color-mix(in_srgb,var(--terminal-fg)_12%,transparent)] px-[3px] text-center font-mono text-[10px] font-semibold text-[var(--terminal-fg)]">⇧</kbd>
							<MousePointerClick className="size-3" />
						</div>
					) : null}
				</div>
			))}
		</div>
	)
}
