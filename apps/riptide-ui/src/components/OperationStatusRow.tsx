import { Button } from '@humanlayer/ui/components/button'
import { MarkdownRenderer } from '@humanlayer/ui/components/markdown-renderer'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { Check, Clock, SkipForward, X } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ResolutionHint } from '@/hooks/stores/newTaskFormStore'
import { openExternal } from '@/lib/url-opener'

export type OperationStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped'

/** Module-scope lookup eliminates per-render conditional branches for the status icon. */
const STATUS_ICONS: Record<OperationStatus, ReactNode> = {
	pending: <Clock className="w-4 h-4 text-muted-foreground" />,
	running: <SyncGridAnimation variant="ring" synchronized size="sm" className="text-[var(--terminal-success)]" />,
	success: <Check className="w-4 h-4 text-[var(--terminal-success)]" />,
	error: <X className="w-4 h-4 text-destructive" />,
	skipped: <SkipForward className="w-4 h-4 text-muted-foreground" />,
}

function StatusActions({
	status,
	onRetry,
	onSkip,
}: {
	status: OperationStatus
	onRetry?: () => void
	onSkip?: () => void
}) {
	if (status === 'running' && onRetry) {
		return (
			<div className="flex gap-2">
				<Button type="button" variant="outline" size="sm" onClick={onRetry}>
					Retry
				</Button>
			</div>
		)
	}
	if (status === 'error' && (onRetry || onSkip)) {
		return (
			<div className="flex gap-2">
				{onSkip && (
					<Button type="button" variant="secondary" size="sm" onClick={onSkip}>
						Skip
					</Button>
				)}
				{onRetry && (
					<Button type="button" variant="outline" size="sm" onClick={onRetry}>
						Retry
					</Button>
				)}
			</div>
		)
	}
	return null
}

interface OperationStatusRowProps {
	name: string
	status: OperationStatus
	errorMessage?: string
	resolutionHint?: ResolutionHint
	command?: string
	onRetry?: () => void
	onSkip?: () => void
}

export function OperationStatusRow({
	name,
	status,
	errorMessage,
	resolutionHint,
	command,
	onRetry,
	onSkip,
}: OperationStatusRowProps) {
	const isMuted = status === 'pending' || status === 'skipped'
	const displayName = status === 'skipped' ? `${name} (Skipped)` : name

	return (
		<div className="py-2">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<div className="shrink-0 size-4 flex items-center justify-center">{STATUS_ICONS[status]}</div>
					<span className={isMuted ? 'text-muted-foreground' : ''}>{displayName}</span>
				</div>
				<StatusActions status={status} onRetry={onRetry} onSkip={onSkip} />
			</div>

			{status === 'error' && errorMessage && (
				<p className="text-sm text-destructive mt-1 ml-7 break-words">{errorMessage}</p>
			)}
			{status === 'error' && resolutionHint && (
				<p className="mt-1 ml-7 text-sm text-destructive">
					{resolutionHint.text}{' '}
					<button type="button" className="underline" onClick={() => openExternal(resolutionHint.url)}>
						{resolutionHint.anchorText}
					</button>
				</p>
			)}

			{status === 'error' && command && (
				<div className="mt-2 ml-7">
					<p className="text-sm text-muted-foreground mb-1">Command to run manually:</p>
					<MarkdownRenderer content={`\`\`\`bash\n${command}\n\`\`\``} />
				</div>
			)}

			{status === 'skipped' && command && (
				<div className="mt-2 ml-7">
					<p className="text-sm text-muted-foreground mb-1">Skipped. Run manually:</p>
					<MarkdownRenderer content={`\`\`\`bash\n${command}\n\`\`\``} />
				</div>
			)}
		</div>
	)
}
