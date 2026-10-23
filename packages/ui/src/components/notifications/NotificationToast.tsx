import { X } from 'lucide-react'

import { KeyboardShortcut } from '../keyboard-shortcut'
import { NotificationKindIcon, type NotificationRowKind } from './NotificationRow'

export function NotificationToast({
	kind,
	headline,
	subject,
	moreCount,
	shortcut,
	onOpen,
	onShowAll,
	onClose,
}: {
	kind: NotificationRowKind
	headline: string
	subject: string
	moreCount: number
	shortcut: string
	onOpen: () => void
	onShowAll: () => void
	onClose: () => void
}) {
	return (
		<div
			data-notification-kind={kind}
			className="flex w-[356px] items-start gap-2.5 border-l-2 border-l-[var(--terminal-accent)] bg-[color-mix(in_oklab,var(--terminal-accent)_16%,var(--terminal-bg))] py-2.5 pl-3 pr-1.5 font-mono text-foreground shadow-lg"
		>
			<span className="flex h-4 w-3.5 shrink-0 items-center justify-center">
				<NotificationKindIcon kind={kind} />
			</span>
			<button type="button" onClick={onOpen} className="min-w-0 flex-1 cursor-pointer text-left">
				<span className="block truncate text-xs font-semibold">{headline}</span>
				<span className="block truncate text-[11.5px] text-muted-foreground">{subject}</span>
			</button>
			<span className="flex shrink-0 flex-col items-end gap-1">
				<button
					type="button"
					aria-label="Dismiss notification"
					onClick={onClose}
					className="flex size-4 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
				>
					<X className="size-3" />
				</button>
				{moreCount > 0 ? (
					<button
						type="button"
						onClick={onShowAll}
						className="cursor-pointer pr-0.5 text-[10px] text-muted-foreground hover:text-foreground"
					>
						+{moreCount} more
					</button>
				) : (
					<KeyboardShortcut size="xs">{shortcut}</KeyboardShortcut>
				)}
			</span>
		</div>
	)
}
