import { Button } from '@humanlayer/ui/components/button'
import type { SessionLabel } from '@humanlayer/ui/components/session-label-badge'
import { Plus } from 'lucide-react'
import type { FC, ReactNode } from 'react'

import type { SessionStatus } from '@/components/session-table/types'
import { MobileBreadcrumb, type MobileBreadcrumbDetail } from '@/mobile/components/pure/MobileBreadcrumb'
import { MobileSessionRow } from '@/mobile/components/pure/MobileSessionRow'
import {
	MobileWorkspaceSetupSummary,
	type MobileWorkspaceSetupSummaryProps,
} from '@/mobile/components/pure/MobileWorkspaceSetupSummary'
import { MobileAppLayout } from '@/mobile/layouts/MobileAppLayout'

export interface MobileTaskDetailSession {
	sessionId: string
	title: string
	status?: SessionStatus
	label?: SessionLabel
	createdAt?: string
	archived?: boolean
}

export interface MobileTaskDetailPageProps {
	taskId: string
	taskName: string
	headerDetails?: MobileBreadcrumbDetail[]
	sessions: MobileTaskDetailSession[]
	workspaceSetup?: MobileWorkspaceSetupSummaryProps
	children?: ReactNode
	onBack: () => void
	onSessionClick: (sessionId: string) => void
	onNewSession: () => void
	/** Interleaved artifact controller slots (trigger in the header, sheet at root). */
	artifactTrigger?: ReactNode
	artifactSheet?: ReactNode
}

/**
 * Mobile task detail page — layout + breadcrumb + scrollable session rows + new session button.
 * When artifacts are present, the breadcrumb shows a hamburger menu that opens a slide-in
 * sheet with the artifact list + read-only viewer.
 */
export const MobileTaskDetailPage: FC<MobileTaskDetailPageProps> = ({
	taskId,
	taskName,
	headerDetails,
	sessions,
	workspaceSetup,
	children,
	onBack,
	onSessionClick,
	onNewSession,
	artifactTrigger,
	artifactSheet,
}) => {
	return (
		<MobileAppLayout>
			<MobileBreadcrumb
				key={taskId}
				title={taskName}
				details={headerDetails}
				showBackButton
				onBack={onBack}
				rightElement={artifactTrigger}
			/>
			{children}
			{workspaceSetup && <MobileWorkspaceSetupSummary {...workspaceSetup} />}

			<div className="flex-1 overflow-y-auto overscroll-contain">
				{sessions.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full px-6 text-center gap-4">
						<p className="text-sm text-muted-foreground">No sessions yet.</p>
						<Button onClick={onNewSession} size="sm">
							<Plus className="h-4 w-4 mr-1" />
							New Session
						</Button>
					</div>
				) : (
					<div className="divide-y divide-border">
						{sessions.map((session) => (
							<MobileSessionRow
								key={session.sessionId}
								sessionId={session.sessionId}
								title={session.title}
								status={session.status}
								label={session.label}
								createdAt={session.createdAt}
								archived={session.archived}
								onClick={() => onSessionClick(session.sessionId)}
							/>
						))}
					</div>
				)}
			</div>

			{sessions.length > 0 && (
				<div className="shrink-0 px-4 py-3 border-t border-border">
					<Button onClick={onNewSession} className="w-full" size="sm">
						<Plus className="h-4 w-4 mr-1" />
						New Session
					</Button>
				</div>
			)}

			{artifactSheet}
		</MobileAppLayout>
	)
}
