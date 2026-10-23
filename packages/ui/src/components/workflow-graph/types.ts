/** Session status values from the database */
export type SessionStatus =
  | 'ready_for_launch'
  | 'draft'
  | 'launching'
  | 'running'
  | 'failed'
  | 'lost'
  | 'ready_for_input'
  | 'needs_approval'
  | 'waiting_for_usage_limit'
  | 'interrupt_requested'
  | 'interrupted'
  | 'resuming'

/** User profile info for rendering avatar on session nodes */
export interface SessionUserProfile {
  /** User initials (e.g. 'KS') */
  initials: string
  /** Profile picture URL (optional) */
  profilePictureUrl?: string
}

/** A single session to render as a node in the graph */
export interface WorkflowSession {
  /** Session UUID */
  id: string
  /** Session title (may be null/empty) */
  title?: string
  /** Session status */
  status: SessionStatus
  /** The rpi: label name (e.g. 'rpi:research-questions') */
  labelName: string
  /** Human-readable label title (e.g. 'research-questions') */
  labelTitle: string
  /** Artifacts produced or consumed by this session */
  artifacts: SessionArtifact[]
  /** User who created this session (shown on shared tasks) */
  userProfile?: SessionUserProfile
}

export type WorkflowSessionNodeData = {
  kind: 'session'
  session: WorkflowSession
  attention?: boolean
}

export type WorkflowPhaseNodeData = {
  kind: 'phase'
  labelName: string
  labelTitle: string
  attention?: boolean
}

export type WorkflowGraphNodeData = WorkflowSessionNodeData | WorkflowPhaseNodeData
export type WorkflowSessionNode = Node<WorkflowSessionNodeData, 'session'>
export type WorkflowPhaseNode = Node<WorkflowPhaseNodeData, 'phasePlaceholder'>
export type WorkflowGraphNode = Node<WorkflowGraphNodeData>

/** An artifact associated with a session */
export interface SessionArtifact {
  /** Artifact filename (e.g. '02-research-feature-name.md') */
  fileName: string
  /** Artifact category */
  category: 'source' | 'edited' | 'new'
}

/** An artifact flowing between two sessions (producer → consumer) */
export interface ArtifactFlow {
  /** ID of the producing session */
  fromSessionId: string
  /** ID of the consuming session */
  toSessionId: string
  /** Artifact filename */
  fileName: string
  /** Artifact category at the consuming session */
  category: 'source' | 'edited' | 'new'
}

/** Layout direction */
export type LayoutDirection = 'LR' | 'TB'

/**
 * Auto-advance edge indicator: marks a phase transition as auto-advancing.
 * When the destination phase has no sessions yet, the edge is rendered with
 * an animated pulse to indicate the system will automatically proceed.
 */
export interface AutoAdvanceEdge {
  /** Source phase label name (e.g. 'rpi:research-questions') */
  fromLabel: string
  /** Target phase label name (e.g. 'rpi:research') */
  toLabel: string
}

/** Props for the main WorkflowGraph component */
export interface WorkflowGraphProps {
  /** Sessions to render as nodes, grouped by their label */
  sessions: WorkflowSession[]
  /** Artifact flows to render as labeled edges between sessions */
  artifactFlows?: ArtifactFlow[]
  /** Layout direction */
  direction?: LayoutDirection
  /** Currently selected node ID */
  selectedNodeId?: string | null
  /** Node ID that needs user attention (has next step recommendation) */
  attentionNodeId?: string | null
  /** Phase transitions where auto-advance is enabled */
  autoAdvanceEdges?: AutoAdvanceEdge[]
  /** Called when a session node is clicked */
  onSessionClick?: (sessionId: string) => void
  /** Called when a phase placeholder is clicked */
  onPhaseClick?: (labelName: string) => void
  /** Called when an artifact edge label is clicked */
  onArtifactClick?: (fileName: string, fromSessionId: string, toSessionId: string) => void
  /** Additional CSS class */
  className?: string
}
import type { Node } from '@xyflow/react'
