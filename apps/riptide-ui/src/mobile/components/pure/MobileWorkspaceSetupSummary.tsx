import type { WorkspaceSetupStage } from '@humanlayer/schemas/effect/workspace'
import { AlertTriangle, CheckCircle2, LoaderCircle, PauseCircle } from 'lucide-react'

export interface MobileWorkspaceSetupSummaryProps {
	state: 'queued' | 'running' | 'failed' | 'ready' | 'waiting'
	stage?: WorkspaceSetupStage
	message?: string
	hostName?: string | null
}

const COPY: Record<MobileWorkspaceSetupSummaryProps['state'], { title: string; detail: string }> = {
	queued: { title: 'Workspace setup queued', detail: 'The daemon will start repository setup shortly.' },
	running: { title: 'Preparing workspace', detail: 'Repository setup is running on your host.' },
	failed: {
		title: 'Workspace setup failed',
		detail: 'Open this task on desktop to retry, skip, or diagnose the failed step.',
	},
	ready: { title: 'Workspace ready', detail: 'Repository setup finished.' },
	waiting: {
		title: 'Session waiting for workspace',
		detail: 'This session will start when the required setup steps finish.',
	},
}

const ICONS = {
	queued: LoaderCircle,
	running: LoaderCircle,
	failed: AlertTriangle,
	ready: CheckCircle2,
	waiting: PauseCircle,
} satisfies Record<MobileWorkspaceSetupSummaryProps['state'], typeof LoaderCircle>

export function MobileWorkspaceSetupSummary({ state, stage, message, hostName }: MobileWorkspaceSetupSummaryProps) {
	const copy = COPY[state]
	const Icon = ICONS[state]
	return (
		<div
			className={`mx-4 mt-3 rounded-md border p-3 ${state === 'failed' ? 'border-destructive/50 bg-destructive/5' : 'border-border/70 bg-muted/20'}`}
			role={state === 'failed' ? 'alert' : 'status'}
		>
			<div className="flex items-start gap-2.5">
				<Icon
					className={`mt-0.5 size-4 shrink-0 ${state === 'failed' ? 'text-destructive' : state === 'ready' ? 'text-[var(--terminal-success)]' : 'text-muted-foreground'} ${state === 'running' ? 'animate-spin' : ''}`}
				/>
				<div className="min-w-0">
					<p className="text-sm font-medium">{copy.title}</p>
					<p className="mt-0.5 text-xs text-muted-foreground">{message ?? copy.detail}</p>
					{(stage || hostName) && (
						<p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
							{stage?.replaceAll('_', ' ')}
							{stage && hostName ? ' · ' : ''}
							{hostName}
						</p>
					)}
				</div>
			</div>
		</div>
	)
}
