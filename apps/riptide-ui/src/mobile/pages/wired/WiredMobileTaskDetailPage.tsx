import type { SessionLabel } from '@humanlayer/ui/components/session-label-badge'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import type { SessionStatus } from '@/components/session-table/types'
import { useTaskWorkspaceSetup } from '@/hooks/live-queries/useTaskWorkspaceSetup'
import { compareSessionsByActivityMinute } from '@/lib/activitySorting'
import type { MobileArtifactItem } from '@/mobile/components/pure/MobileArtifactSheet'
import type { MobileBreadcrumbDetail } from '@/mobile/components/pure/MobileBreadcrumb'
import type { MobileWorkspaceSetupSummaryProps } from '@/mobile/components/pure/MobileWorkspaceSetupSummary'
import { WiredMobileArtifactsController } from '@/mobile/components/wired/WiredMobileArtifactsController'
import { WiredMobileTaskOwnerControl } from '@/mobile/components/wired/WiredMobileTaskOwnerControl'
import { useMobileTaskComments } from '@/mobile/hooks/useMobileTaskComments'
import type { MobileTaskDetailSession } from '@/mobile/pages/pure/MobileTaskDetailPage'
import { MobileTaskDetailPage } from '@/mobile/pages/pure/MobileTaskDetailPage'
import { formatTimestamp } from '@/utils/formatting'
import { timestampToISOString } from '@/utils/session-transforms'

interface WiredMobileTaskDetailPageProps {
	taskId: string
}

/**
 * Wired mobile task detail page.
 * Fetches task name and sessions from TanStack DB and wires all navigation and actions.
 */
export function WiredMobileTaskDetailPage({ taskId }: WiredMobileTaskDetailPageProps) {
	const navigate = useNavigate()
	const { tasksCollection, sessionsCollection, artifactsMetadataCollection } = useSync()

	// Fetch task
	const { data: taskData } = useLiveQuery(
		(q) => q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, taskId)),
		[tasksCollection, taskId],
	)
	const task = taskData?.[0]
	const workspaceSetup = useTaskWorkspaceSetup(taskId, null, task?.workspace_spec?.setupBlocksFirstSession ?? false)

	// Fetch sessions for this task, including archived ones (archived rows render
	// dimmed with an Archived marker, sorted after active sessions)
	const { data: sessionData, isReady: sessionsReady } = useLiveQuery(
		(q) => q.from({ sessions: sessionsCollection }).where(({ sessions }) => eq(sessions.task_id, taskId)),
		[sessionsCollection, taskId],
	)

	// Fetch non-deleted artifacts for this task
	const { data: dbArtifacts } = useLiveQuery(
		(q) =>
			q
				.from({ artifacts: artifactsMetadataCollection })
				.where(({ artifacts }) => and(eq(artifacts.task_id, taskId), eq(artifacts.is_deleted, false)))
				.select(({ artifacts }) => ({
					id: artifacts.id,
					file_name: artifacts.file_name,
					task_slug: artifacts.task_slug,
					resource_owner_user_id: artifacts.resource_owner_user_id,
					share_key: artifacts.share_key,
					share_enabled: artifacts.share_enabled,
					storage_type: artifacts.storage_type,
				}))
				.orderBy(({ artifacts }) => artifacts.last_updated_at, 'desc'),
		[artifactsMetadataCollection, taskId],
	)

	// Unread comment awareness for the artifact list (no send from this page —
	// there's no session context, so only the unread markers are used).
	const { unreadArtifactIds, unreadCount } = useMobileTaskComments(taskId)

	const artifacts: MobileArtifactItem[] = useMemo(() => {
		if (!dbArtifacts?.length) return []
		return dbArtifacts.map((artifact) => ({
			artifactId: artifact.id,
			filename: artifact.file_name,
			category: 'unreferenced',
			hasUnreadComments: unreadArtifactIds.has(artifact.id),
		}))
	}, [dbArtifacts, unreadArtifactIds])

	// Sort sessions: active before archived, then most recent activity minute first.
	const sessions: MobileTaskDetailSession[] = useMemo(() => {
		if (!sessionsReady || !sessionData) return []
		return [...sessionData]
			.sort((a, b) => {
				const archivedA = a.archived ? 1 : 0
				const archivedB = b.archived ? 1 : 0
				if (archivedA !== archivedB) return archivedA - archivedB
				return compareSessionsByActivityMinute(a, b)
			})
			.map((s): MobileTaskDetailSession => {
				const createdAtIso = timestampToISOString(s.created_at)
				const sessionLabels = s.labels as SessionLabel[] | null
				const label = Array.isArray(sessionLabels) && sessionLabels.length > 0 ? sessionLabels[0] : undefined

				return {
					sessionId: s.id,
					title: s.title ?? s.summary ?? s.prompt ?? 'Untitled Session',
					status: s.status as SessionStatus | undefined,
					label,
					createdAt: createdAtIso ? formatTimestamp(createdAtIso) : undefined,
					archived: s.archived ?? false,
				}
			})
	}, [sessionData, sessionsReady])

	const headerDetails: MobileBreadcrumbDetail[] = useMemo(() => {
		const details: MobileBreadcrumbDetail[] = []
		if (task?.default_working_directory) {
			details.push({ label: 'Directory', value: task.default_working_directory, mono: true })
		}
		if (task?.ticket_id || task?.ticket_url) {
			details.push({ label: 'Ticket', value: task.ticket_id ?? task.ticket_url ?? '' })
		}
		const createdAtIso = timestampToISOString(task?.created_at)
		if (createdAtIso) {
			details.push({ label: 'Created', value: formatTimestamp(createdAtIso) })
		}
		if (sessionsReady && sessionData) {
			const activeCount = sessionData.filter((s) => !s.archived).length
			const archivedCount = sessionData.length - activeCount
			const base = `${activeCount} ${activeCount === 1 ? 'session' : 'sessions'}`
			details.push({
				label: 'Sessions',
				value: archivedCount > 0 ? `${base} · ${archivedCount} archived` : base,
			})
		}
		return details
	}, [
		task?.created_at,
		task?.default_working_directory,
		task?.ticket_id,
		task?.ticket_url,
		sessionsReady,
		sessionData,
	])

	const handleBack = () => {
		navigate({ to: '/sessions' })
	}

	const handleSessionClick = (sessionId: string) => {
		navigate({ to: '/sessions/$sessionId', params: { sessionId } })
	}

	const handleNewSession = () => {
		navigate({ to: '/sessions/draft', search: { taskId } })
	}
	const mobileWorkspaceSetup = useMemo<MobileWorkspaceSetupSummaryProps | undefined>(() => {
		const row = workspaceSetup.activeRow
		if (!row) return undefined
		if (row.error) {
			return {
				state: 'failed',
				stage: row.error.stage,
				message: row.error.message,
				hostName: workspaceSetup.activeHostName,
			}
		}
		if (row.status === 'done') return { state: 'ready', stage: 'done', hostName: workspaceSetup.activeHostName }
		if (workspaceSetup.isBlockingFirstSession)
			return { state: 'waiting', stage: row.status, hostName: workspaceSetup.activeHostName }
		return {
			state: row.status === 'setup_requested' ? 'queued' : 'running',
			stage: row.status,
			hostName: workspaceSetup.activeHostName,
		}
	}, [workspaceSetup])

	return (
		<WiredMobileArtifactsController artifacts={artifacts} unreadCount={unreadCount}>
			{({ trigger, sheet }) => (
				<MobileTaskDetailPage
					taskId={taskId}
					taskName={task?.name ?? ''}
					headerDetails={headerDetails}
					sessions={sessions}
					workspaceSetup={mobileWorkspaceSetup}
					onBack={handleBack}
					onSessionClick={handleSessionClick}
					onNewSession={handleNewSession}
					artifactTrigger={trigger}
					artifactSheet={sheet}
				>
					{task && (
						<WiredMobileTaskOwnerControl
							taskId={taskId}
							taskName={task.name}
							resourceOwnerUserId={task.resource_owner_user_id}
						/>
					)}
				</MobileTaskDetailPage>
			)}
		</WiredMobileArtifactsController>
	)
}
