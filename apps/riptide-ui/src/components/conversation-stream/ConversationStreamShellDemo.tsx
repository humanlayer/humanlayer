import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import {
	type ConversationEvent,
	ConversationStream,
	createToolResultsByKey,
	type AgentEventGroup,
} from '@humanlayer/ui/components/conversation-stream'
import { useCallback, useState } from 'react'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { openFileInEditor } from '@/lib/file-opener'
import { logger } from '@/lib/logger'

import { useConversationNavigation } from './hooks/useConversationNavigation'

interface ConversationStreamShellDemoProps {
	events: ConversationEvent[]
	agentGroups?: Map<string, AgentEventGroup>
	workingDir?: string
}

export function ConversationStreamShellDemo({
	events,
	agentGroups = new Map(),
	workingDir = '/Users/dev/project',
}: ConversationStreamShellDemoProps) {
	// Task expansion state
	const [expandedAgents, setExpandedAgents] = useState<Set<string>>(() => {
		// Auto-expand agents with pending approvals
		const expanded = new Set<string>()
		for (const [agentId, group] of agentGroups) {
			if (group.hasPendingApproval) {
				expanded.add(agentId)
			}
		}
		return expanded
	})

	// Approval state
	const [approvingApprovalId, setApprovingApprovalId] = useState<string | null>(null)
	const [denyingApprovalId, setDenyingApprovalId] = useState<string | null>(null)

	// Modal state
	const [modalEvent, setModalEvent] = useState<ConversationEvent | null>(null)

	const toolResultsByKey = createToolResultsByKey(events)

	const handleToggleAgentGroup = useCallback((agentId: string) => {
		setExpandedAgents((prev) => {
			const next = new Set(prev)
			if (next.has(agentId)) {
				next.delete(agentId)
			} else {
				next.add(agentId)
			}
			return next
		})
	}, [])

	const handleApprove = useCallback((approvalId: string) => {
		logger.info('[Demo] Approve:', approvalId)
		setApprovingApprovalId(approvalId)
		// Simulate API call
		setTimeout(() => {
			setApprovingApprovalId(null)
			logger.info('[Demo] Approved!')
		}, 1000)
	}, [])

	const handleStartDeny = useCallback((approvalId: string) => {
		logger.info('[Demo] Start deny:', approvalId)
		setDenyingApprovalId(approvalId)
		// In real app, this would focus the response editor
	}, [])

	const handleOpenFile = useCallback(
		(filePath: string) => {
			void openFileInEditor({
				filePath,
				workingDir,
			})
		},
		[workingDir],
	)

	const handleRequestModal = useCallback((event: ConversationEvent, _result?: ConversationEvent) => {
		logger.info('[Demo] Request modal:', event.toolName)
		setModalEvent(event)
	}, [])

	// Navigation hook. ConversationStreamShellDemo renders without a virtualizer, so the
	// shift+g / gg / scroll-into-view paths never fire — passing `events` here is just for type
	// completeness (those callbacks early-return when virtualizerRef is absent).
	const focusedEventId = useFocusStore((s) => s.focusedEventId)
	const { handleFocusChange } = useConversationNavigation({
		events,
		rootEvents: events,
		agentGroups,
		getExpandedAgents: () => expandedAgents,
		onToggleAgentGroup: handleToggleAgentGroup,
		onRequestModal: handleRequestModal,
		onOpenFile: handleOpenFile,
		toolResultsByKey,
		scopes: [HOTKEY_SCOPES.SESSION_DETAIL],
	})

	// Approval hotkeys
	useHotkeys('a', () => {
		if (!focusedEventId) return
		const event = events.find((e) => e.id === focusedEventId)
		if (event?.approvalStatus === 'pending' && event.approvalId) {
			handleApprove(event.approvalId)
		}
	})

	useHotkeys('d', () => {
		if (!focusedEventId) return
		const event = events.find((e) => e.id === focusedEventId)
		if (event?.approvalStatus === 'pending' && event.approvalId) {
			handleStartDeny(event.approvalId)
		}
	})

	// Escape to close modal
	useHotkeys('Escape', () => {
		if (modalEvent) {
			setModalEvent(null)
		} else if (denyingApprovalId) {
			setDenyingApprovalId(null)
		}
	})

	return (
		<div className="h-full flex flex-col">
			{/* Keyboard hint bar */}
			<div className="flex-shrink-0 p-2 bg-muted/20 border-b text-sm text-muted-foreground">
				<span className="mr-4">
					<kbd>j</kbd>/<kbd>k</kbd> navigate
				</span>
				<span className="mr-4">
					<kbd>h</kbd>/<kbd>l</kbd> collapse/expand
				</span>
				<span className="mr-4">
					<kbd>i</kbd> inspect
				</span>
				<span className="mr-4">
					<kbd>u</kbd> user message
				</span>
				<span className="mr-4">
					<kbd>o</kbd> open file
				</span>
				<span className="mr-4">
					<kbd>a</kbd> approve
				</span>
				<span>
					<kbd>d</kbd> deny
				</span>
			</div>

			{/* Stream */}
			<div className="flex-1 min-h-0">
				<ConversationStream
					events={events}
					agentGroups={agentGroups}
					toolResultsByKey={toolResultsByKey}
					workingDir={workingDir}
					focusedEventId={focusedEventId}
					onFocusChange={handleFocusChange}
					expandedAgents={expandedAgents}
					onToggleAgentGroup={handleToggleAgentGroup}
					onRequestModal={handleRequestModal}
					onOpenFile={handleOpenFile}
					onApprove={handleApprove}
					approvingApprovalId={approvingApprovalId}
					denyingApprovalId={denyingApprovalId}
					onStartDeny={handleStartDeny}
					onCancelDeny={() => setDenyingApprovalId(null)}
					className="h-full"
				/>
			</div>

			{/* Simple modal placeholder */}
			{modalEvent && (
				<div
					className="fixed inset-0 bg-black/50 flex items-center justify-center"
					onClick={() => setModalEvent(null)}
				>
					<div
						className="bg-background border rounded-lg p-4 max-w-2xl max-h-[80vh] overflow-auto"
						onClick={(e) => e.stopPropagation()}
					>
						<h2 className="font-semibold mb-2">{modalEvent.toolName}</h2>
						<pre className="text-sm bg-muted/20 p-2 rounded">
							{JSON.stringify(JSON.parse(modalEvent.toolInputJson || '{}'), null, 2)}
						</pre>
						<button
							type="button"
							className="mt-4 px-3 py-1 bg-primary text-primary-foreground rounded"
							onClick={() => setModalEvent(null)}
						>
							Close (Esc)
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
