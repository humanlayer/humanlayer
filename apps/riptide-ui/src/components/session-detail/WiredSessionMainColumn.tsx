import type { ReactNode } from 'react'

import { TerminalPanel } from '@/components/Terminal/TerminalPanel'
import { useSessionUiStore } from '@/hooks/stores/sessionUiStore'
import { isDesktop } from '@/lib/utils'

import { useSessionDetail } from './session-detail-context'

/** Own the terminal's layout subscription without reconstructing conversation/composer children. */
export function WiredSessionMainColumn({ children }: { children: ReactNode }) {
	const { sessionId, session, canManageSession, host, autoAdvance } = useSessionDetail()
	const isTerminalOpen = useSessionUiStore((state) => state.isTerminalOpen)
	const setIsTerminalOpen = useSessionUiStore((state) => state.setIsTerminalOpen)
	const { terminalWorkingDirectory } = autoAdvance
	const showTaskTerminalPanel = isDesktop() && host.isColocated && canManageSession && !!terminalWorkingDirectory
	const storageKey = session.task_id ? `task-${session.task_id}` : sessionId

	return (
		<div
			className={`relative flex h-full min-h-0 flex-col overflow-hidden [contain:layout] ${showTaskTerminalPanel && !isTerminalOpen ? 'pb-0' : 'pb-4'}`}
		>
			{children}
			{showTaskTerminalPanel && (
				<div className={isTerminalOpen ? 'shrink-0' : 'h-4 shrink-0 overflow-visible'}>
					<TerminalPanel
						storageKey={storageKey}
						workingDirectory={terminalWorkingDirectory}
						isOpen={isTerminalOpen}
						onClose={() => setIsTerminalOpen(false)}
						onOpen={() => setIsTerminalOpen(true)}
					/>
				</div>
			)}
		</div>
	)
}
