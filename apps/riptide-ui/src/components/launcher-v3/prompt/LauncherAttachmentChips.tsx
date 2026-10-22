import { Button } from '@humanlayer/ui/components/button'
import { File, Github, Loader2, Ticket, X } from 'lucide-react'

import { TICKET_PROVIDER_LABELS, type LauncherAttachmentChipsProps } from './launcher-attachment-types'

/** Attached-file chips lined up along the bottom of the composer, above the tray. */
export function LauncherAttachmentChips({
	ticket,
	attachments,
	uploadingFileNames,
	disabled = false,
	onRemoveTicket,
	onRemoveFile,
}: LauncherAttachmentChipsProps) {
	if (!ticket && attachments.length === 0 && uploadingFileNames.length === 0) return null
	return (
		<ul aria-label="Attached files" aria-live="polite" className="flex min-w-0 flex-wrap items-center gap-1.5">
			{ticket && (
				<li
					className="flex h-7 min-w-0 items-center gap-1.5 border bg-foreground/5 px-2 text-xs"
					title={`${TICKET_PROVIDER_LABELS[ticket.provider]} ticket ${ticket.ticketId}`}
				>
					{ticket.provider === 'github' ? (
						<Github aria-hidden className="size-3.5 shrink-0" />
					) : (
						<Ticket aria-hidden className="size-3.5 shrink-0" />
					)}
					<span className="min-w-0 max-w-64 truncate">{ticket.name.trim() || ticket.ticketId}</span>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-6 shrink-0"
						aria-label={`Remove ${ticket.ticketId}`}
						disabled={disabled}
						onClick={onRemoveTicket}
					>
						<X aria-hidden className="size-3" />
					</Button>
				</li>
			)}
			{uploadingFileNames.map((fileName) => (
				<li
					key={`uploading:${fileName}`}
					className="flex h-7 min-w-0 items-center gap-1.5 border bg-foreground/5 px-2 text-xs"
					aria-label={`Uploading ${fileName}`}
				>
					<File aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="min-w-0 max-w-40 truncate" title={fileName}>
						{fileName}
					</span>
					<span className="flex items-center gap-1 text-muted-foreground">
						<Loader2 aria-hidden className="size-3 animate-spin" /> Uploading
					</span>
				</li>
			))}
			{attachments.map((attachment) => (
				<li
					key={attachment.fileName}
					className="flex h-7 min-w-0 items-center gap-1.5 border bg-foreground/5 px-2 text-xs"
				>
					<File aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="min-w-0 max-w-40 truncate" title={attachment.fileName}>
						{attachment.fileName}
					</span>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-6 shrink-0"
						aria-label={`Remove ${attachment.fileName}`}
						disabled={disabled}
						onClick={() => onRemoveFile(attachment.fileName)}
					>
						<X aria-hidden className="size-3" />
					</Button>
				</li>
			))}
		</ul>
	)
}
