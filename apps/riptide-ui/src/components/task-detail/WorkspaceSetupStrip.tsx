import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { Button } from '@humanlayer/ui/components/button'
import { CheckCircle2, ChevronRight } from 'lucide-react'

function formatElapsed(elapsedMs: number | null): string | null {
	if (elapsedMs === null) return null
	if (elapsedMs < 1_000) return '<1s'
	const seconds = Math.round(elapsedMs / 1_000)
	if (seconds < 60) return `${seconds}s`
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function WorkspaceSetupStrip({
	row,
	elapsedMs,
	onViewWorkspace,
	embedded = false,
}: {
	row: TaskWorkspaceSetupForHost
	elapsedMs: number | null
	onViewWorkspace?: () => void
	embedded?: boolean
}) {
	const repoCount = row.workspace_setup_state.repos.length
	const skipCount = row.workspace_setup_state.acceptedSkips?.length ?? 0
	const elapsed = formatElapsed(elapsedMs)
	return (
		<div
			className={
				embedded
					? 'mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3'
					: 'flex flex-wrap items-center justify-between gap-2 border border-[var(--terminal-success)]/30 bg-[var(--terminal-success)]/5 px-3 py-1.5'
			}
		>
			<div className="flex min-w-0 items-center gap-2 font-mono text-xs">
				<CheckCircle2 className="size-3.5 shrink-0 text-[var(--terminal-success)]" />
				<span className="font-medium uppercase tracking-[0.06em]">Workspace ready</span>
				<span className="text-[11px] text-muted-foreground">
					{repoCount} {repoCount === 1 ? 'repo' : 'repos'}
					{elapsed ? ` · ${elapsed}` : ''}
					{skipCount ? ` · ${skipCount} accepted ${skipCount === 1 ? 'skip' : 'skips'}` : ''}
				</span>
			</div>
			{onViewWorkspace && (
				<Button
					size="sm"
					variant="secondary"
					className="h-7 rounded-none px-2 text-xs"
					onClick={onViewWorkspace}
				>
					View workspace
					<ChevronRight className="ml-1 size-4" />
				</Button>
			)}
		</div>
	)
}
