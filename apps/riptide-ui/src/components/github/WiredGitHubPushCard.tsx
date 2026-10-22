import { GitHubPushCard } from '@humanlayer/ui/components/conversation-stream'
import { type FC, useEffect } from 'react'

import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { useOptionalSessionDiff } from '@/components/session-detail/session-diff-context'
import { useGitHubPanelStore, useReportGitHubPanelAttention } from '@/hooks/stores/githubPanelStore'
import { useGitHubPushCardStore } from '@/hooks/stores/githubPushCardStore'
import { useConnectIntegrationAction } from '@/hooks/useConnectIntegrationAction'
import { useGitHubStatus } from '@/hooks/useGitHubStatus'

import { pullRequestScopeKey } from './pull-request-branch'
import { isGitPushToolCall, type PushDetectionEvent } from './push-detection'
import { type GitHubPushCardInput, useGitHubPushCardState } from './useGitHubPushCardState'

const WiredGitHubPushCardBody: FC<GitHubPushCardInput> = ({ sessionId, toolCallId }) => {
	const state = useGitHubPushCardState({ sessionId, toolCallId })
	const { artifactPanel } = useSessionDetail()
	const taskDiffReview = useOptionalSessionDiff()
	const connect = useConnectIntegrationAction()
	const dismiss = useGitHubPushCardStore((store) => store.dismiss)
	const take = useGitHubPushCardStore((store) => store.take)
	if (!state) return null

	const openGitHubTab = () => {
		take(toolCallId)
		useGitHubPanelStore.getState().clearAttention(pullRequestScopeKey({ sessionId }))
		taskDiffReview?.closeSidebar()
		artifactPanel.handleSidebarTabChange('github')
		artifactPanel.expandSidebar()
	}

	return (
		<GitHubPushCard
			state={state}
			onConnect={() => void connect('github')}
			onLater={() => dismiss(sessionId)}
			onOpenGitHubTab={openGitHubTab}
		/>
	)
}

export const WiredGitHubPushCard: FC<GitHubPushCardInput> = (props) => {
	const github = useGitHubStatus()
	if (github === null) return null
	return <WiredGitHubPushCardBody {...props} />
}

/** The stream's seat for the card: an event that is not the push it belongs under renders nothing. */
export const WiredGitHubPushCardForEvent: FC<{
	sessionId: string
	event: PushDetectionEvent & { toolId?: string }
	show: boolean
}> = ({ sessionId, event, show }) => {
	if (!show || !event.toolId || !isGitPushToolCall(event)) return null
	return <WiredGitHubPushCard sessionId={sessionId} toolCallId={event.toolId} />
}

/**
 * Leaving the session ends the pull request notice, but StrictMode unmounts and remounts every
 * effect once in development, so the end waits a tick and the remount cancels it.
 */
const endingNotices = new Map<string, ReturnType<typeof setTimeout>>()

const cancelEndOfNotice = (toolCallId: string) => {
	clearTimeout(endingNotices.get(toolCallId))
	endingNotices.delete(toolCallId)
}

const endNoticeAfterThisCommit = (toolCallId: string) => {
	endingNotices.set(
		toolCallId,
		setTimeout(() => {
			endingNotices.delete(toolCallId)
			useGitHubPushCardStore.getState().markSeen(toolCallId)
		}),
	)
}

const WiredGitHubPushAttentionBody: FC<GitHubPushCardInput> = ({ sessionId, toolCallId }) => {
	const state = useGitHubPushCardState({ sessionId, toolCallId })
	const { artifactPanel } = useSessionDetail()
	useReportGitHubPanelAttention(
		pullRequestScopeKey({ sessionId }),
		state === null ? null : state.kind === 'not_connected' ? 'warning' : 'accent',
	)
	const pullRequestNoticeShowing = state?.kind === 'pull_request'
	const pullRequestNoticeFollowed =
		pullRequestNoticeShowing && artifactPanel.sidebarTab === 'github' && !artifactPanel.isSidebarCollapsed
	useEffect(() => {
		if (!pullRequestNoticeShowing) return
		cancelEndOfNotice(toolCallId)
		return () => endNoticeAfterThisCommit(toolCallId)
	}, [pullRequestNoticeShowing, toolCallId])
	useEffect(() => {
		if (pullRequestNoticeFollowed) useGitHubPushCardStore.getState().take(toolCallId)
	}, [pullRequestNoticeFollowed, toolCallId])
	return null
}

/** Mounted outside the virtualized stream, where scrolling the push row away cannot unmount it. */
export const WiredGitHubPushAttention: FC<GitHubPushCardInput> = (props) => {
	const github = useGitHubStatus()
	if (github === null) return null
	return <WiredGitHubPushAttentionBody {...props} />
}
