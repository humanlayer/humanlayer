import { Button } from '@humanlayer/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@humanlayer/ui/components/popover'
import { AlertTriangle } from 'lucide-react'

export function UpdateCliPopover({
	message,
	onOpenDaemonSettings,
}: {
	message: string
	onOpenDaemonSettings: () => void
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="flex items-center gap-1 bg-[var(--terminal-warning)]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--terminal-warning)] hover:bg-[var(--terminal-warning)]/20"
				>
					<AlertTriangle className="size-3" /> Update CLI
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 space-y-3 text-sm">
				<p>{message}</p>
				<Button type="button" variant="secondary" size="xs" onClick={onOpenDaemonSettings}>
					Open host settings
				</Button>
			</PopoverContent>
		</Popover>
	)
}
