import { type FC, useState } from 'react'
import { createMidWorkflowData } from './mock-data'
import type { ArtifactFlow, LayoutDirection, WorkflowSession } from './types'
import { WorkflowGraph } from './workflow-graph'

const DEFAULT_DATA = createMidWorkflowData()

export interface WorkflowGraphWrapperProps {
	initialSessions?: WorkflowSession[]
	initialArtifactFlows?: ArtifactFlow[]
	direction?: LayoutDirection
}

export const WorkflowGraphWrapper: FC<WorkflowGraphWrapperProps> = ({
	initialSessions = DEFAULT_DATA.sessions,
	initialArtifactFlows = DEFAULT_DATA.artifactFlows,
	direction = 'TB',
}) => {
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

	return (
		<div className="flex flex-col h-full gap-4">
			<div className="flex items-center gap-4 text-sm font-mono">
				<span style={{ color: 'var(--terminal-fg-dim)' }}>
					Selected: <span style={{ color: 'var(--terminal-fg)' }}>{selectedNodeId ?? 'none'}</span>
				</span>
				<span style={{ color: 'var(--terminal-fg-dim)' }}>
					Direction: <span style={{ color: 'var(--terminal-fg)' }}>{direction}</span>
				</span>
			</div>
			<div className="flex-1 min-h-0">
				<WorkflowGraph
					sessions={initialSessions}
					artifactFlows={initialArtifactFlows}
					direction={direction}
					selectedNodeId={selectedNodeId}
					onSessionClick={(id) => {
						setSelectedNodeId(id)
						console.log('Session clicked:', id)
					}}
					onPhaseClick={(labelName) => {
						console.log('Phase placeholder clicked:', labelName)
					}}
					onArtifactClick={(fileName, from, to) => {
						console.log('Artifact clicked:', fileName, 'from:', from, 'to:', to)
					}}
				/>
			</div>
		</div>
	)
}
