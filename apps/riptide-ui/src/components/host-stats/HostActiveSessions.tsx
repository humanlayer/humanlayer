import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@humanlayer/ui/components/collapsible'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'

export interface HostActiveSession {
	id: string
	title: string
}

const LABEL_CLASS = 'font-mono text-[10px] uppercase tracking-wider'

function formatUnlistedSessions(count: number): string {
	return `${count} more active ${count === 1 ? 'session' : 'sessions'} you cannot open`
}

export function HostActiveSessions({
	sessionCount,
	sessions,
}: {
	sessionCount: number
	/** Absent when the daemon does not report which sessions it runs. */
	sessions: readonly HostActiveSession[] | undefined
}) {
	const activeSummary = sessionCount === 0 ? 'No active sessions' : `${sessionCount} active`
	if (sessionCount === 0 || sessions === undefined) {
		return (
			<div className="mt-3 flex items-center gap-1 text-muted-foreground">
				<span aria-hidden className="size-3" />
				<span className={LABEL_CLASS}>Sessions</span>
				<span className="ml-2 font-mono text-[10px]">{activeSummary}</span>
			</div>
		)
	}
	const unlistedCount = Math.max(0, sessionCount - sessions.length)

	return (
		<Collapsible defaultOpen={false} className="mt-3">
			<CollapsibleTrigger className="group/sessions flex items-center gap-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
				<ChevronRight
					aria-hidden
					className="size-3 transition-transform group-data-[state=open]/sessions:rotate-90"
				/>
				<span className={LABEL_CLASS}>Sessions</span>
				<span className="ml-2 font-mono text-[10px]">{activeSummary}</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<ul className="mt-1 max-h-48 overflow-y-auto pl-4 pr-2">
					{sessions.map((session) => (
						<li key={session.id} className="py-0.5 font-mono text-[11px]">
							<Link
								to="/sessions/$sessionId"
								params={{ sessionId: session.id }}
								preload="intent"
								className="block truncate text-[var(--terminal-accent)] no-underline outline-none hover:underline focus-visible:underline"
							>
								{session.title}
							</Link>
						</li>
					))}
				</ul>
				{unlistedCount > 0 && (
					<p className="mt-1 pl-4 font-mono text-[10px] text-muted-foreground">
						{formatUnlistedSessions(unlistedCount)}
					</p>
				)}
			</CollapsibleContent>
		</Collapsible>
	)
}
