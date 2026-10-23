import { type OnMove, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, type Viewport } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './workflow-graph.css'
import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RPI_LABELS } from '../../constants/rpi-skills'
import { ArtifactEdge } from './artifact-edge'
import { AutoAdvanceEdge } from './auto-advance-edge'
import { computeLayout } from './layout'
import { PhasePlaceholderNode, SessionNode } from './phase-node'
import {
  type ArtifactFlow,
  type AutoAdvanceEdge as AutoAdvanceEdgeType,
  type WorkflowGraphProps,
  type WorkflowSession,
} from './types'
import { snapViewportToDevicePixels } from './viewport'

const nodeTypes = { session: SessionNode, phasePlaceholder: PhasePlaceholderNode }
const edgeTypes = { artifact: ArtifactEdge, autoAdvance: AutoAdvanceEdge }

/**
 * Produce a stable fingerprint for sessions + flows so we only re-layout
 * when the data structurally changes, not just when the reference changes.
 */
function dataFingerprint(sessions: WorkflowSession[], flows: ArtifactFlow[], autoAdvance?: AutoAdvanceEdgeType[]): string {
  const s = sessions
    .map((s) => `${s.id}:${s.status}:${s.labelName}:${s.userProfile?.initials ?? ''}`)
    .sort()
    .join('|')
  const f = flows
    .map((f) => `${f.fromSessionId}->${f.toSessionId}:${f.fileName}`)
    .sort()
    .join('|')
  const a = (autoAdvance ?? [])
    .map((e) => `${e.fromLabel}->${e.toLabel}`)
    .sort()
    .join('|')
  return `${s};;${f};;${a}`
}

const WorkflowGraphInner: FC<WorkflowGraphProps> = ({
  sessions,
  artifactFlows = [],
  direction = 'TB',
  selectedNodeId,
  attentionNodeId,
  autoAdvanceEdges,
  onSessionClick,
  onPhaseClick,
  onArtifactClick,
  className,
}) => {
  // Store callbacks in refs so they never cause edge/node recomputation
  const onArtifactClickRef = useRef(onArtifactClick)
  onArtifactClickRef.current = onArtifactClick

  // Only recompute layout when the data structurally changes
  const fingerprintRef = useRef('')
  const layoutRef = useRef(computeLayout(sessions, artifactFlows, direction, autoAdvanceEdges))
  const prevDirectionRef = useRef(direction)

  const layout = useMemo(() => {
    const fp = dataFingerprint(sessions, artifactFlows, autoAdvanceEdges)
    if (fp === fingerprintRef.current && direction === prevDirectionRef.current) {
      return layoutRef.current
    }
    fingerprintRef.current = fp
    prevDirectionRef.current = direction
    const newLayout = computeLayout(sessions, artifactFlows, direction, autoAdvanceEdges)
    layoutRef.current = newLayout
    return newLayout
  }, [sessions, artifactFlows, direction, autoAdvanceEdges])

  // Stable callback that reads from ref — never changes identity
  const handleArtifactClick = useCallback((fileName: string, source: string, target: string) => {
    onArtifactClickRef.current?.(fileName, source, target)
  }, [])

  // Edge label hover highlight — dims everything except the hovered edge and its connected nodes
  const [hoveredEdge, setHoveredEdge] = useState<{ source: string; target: string } | null>(null)

  const handleEdgeLabelEnter = useCallback((source: string, target: string) => {
    setHoveredEdge({ source, target })
  }, [])

  const handleEdgeLabelLeave = useCallback(() => {
    setHoveredEdge(null)
  }, [])

  // Edges only recompute when layout.edges changes (not on callback changes)
  const edgesWithCallbacks = useMemo(() => {
    return layout.edges.map((edge) => {
      if (edge.type === 'artifact' && edge.data) {
        return {
          ...edge,
          data: {
            ...edge.data,
            onArtifactClick: (fileName: string) =>
              handleArtifactClick(fileName, edge.source, edge.target),
            onEdgeLabelHover: () => handleEdgeLabelEnter(edge.source, edge.target),
            onEdgeLabelLeave: handleEdgeLabelLeave,
          },
        }
      }
      return edge
    })
  }, [layout.edges, handleArtifactClick, handleEdgeLabelEnter, handleEdgeLabelLeave])

  const nodesWithSelection = useMemo(() => {
    return layout.nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: {
        ...node.data,
        attention: node.id === attentionNodeId,
      },
    }))
  }, [layout.nodes, selectedNodeId, attentionNodeId])

  // Compute the node IDs to focus on: the most recent phase + its neighbors
  const focusNodeIds = useMemo(() => {
    if (sessions.length === 0) return null

    const orderedPhases = RPI_LABELS.filter((l) => l.name !== 'rpi:todo')

    // Find the latest phase that has actual sessions
    let latestPhaseIdx = -1
    for (const session of sessions) {
      const idx = orderedPhases.findIndex((p) => p.name === session.labelName)
      if (idx > latestPhaseIdx) latestPhaseIdx = idx
    }
    if (latestPhaseIdx === -1) return null

    // Collect nodes from [latestPhaseIdx - 1, latestPhaseIdx, latestPhaseIdx + 1]
    const sessionsByLabel = new Map<string, WorkflowSession[]>()
    for (const s of sessions) {
      const arr = sessionsByLabel.get(s.labelName) ?? []
      arr.push(s)
      sessionsByLabel.set(s.labelName, arr)
    }

    const ids: string[] = []
    for (let i = Math.max(0, latestPhaseIdx - 1); i <= Math.min(orderedPhases.length - 1, latestPhaseIdx + 1); i++) {
      const phase = orderedPhases[i]
      if (phase === undefined) continue
      const phaseSessions = sessionsByLabel.get(phase.name)
      if (phaseSessions && phaseSessions.length > 0) {
        for (const s of phaseSessions) ids.push(s.id)
      } else {
        ids.push(`placeholder-${phase.title}`)
      }
    }
    return ids
  }, [sessions])

  const { fitView: rfFitView } = useReactFlow()

  const [nodes, setNodes, onNodesChange] = useNodesState(nodesWithSelection)
  const [edges, setEdges, onEdgesChange] = useEdgesState(edgesWithCallbacks)
  const [viewport, setViewport] = useState<Viewport>()

  const handleViewportChange = useCallback((nextViewport: Viewport) => {
    setViewport(nextViewport)
  }, [])
  const handleMoveEnd = useCallback<OnMove>((_event, nextViewport) => {
    const pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio
    setViewport(snapViewportToDevicePixels(nextViewport, pixelRatio))
  }, [])

  // Track the previous layout identity to detect structural changes
  const prevLayoutRef = useRef(layout)
  const prevEdgesRef = useRef(edgesWithCallbacks)
  const hasFittedRef = useRef(false)

  useEffect(() => {
    const layoutChanged = layout !== prevLayoutRef.current
    prevLayoutRef.current = layout

    if (layoutChanged) {
      // Layout structurally changed (direction switch, new/removed nodes) — use fresh positions
      setNodes(nodesWithSelection)
      // Re-fit viewport on structural layout change
      hasFittedRef.current = false
    } else {
      // Only selection or data changed — preserve user-dragged positions
      setNodes((prev) => {
        const prevById = new Map(prev.map((n) => [n.id, n]))
        return nodesWithSelection.map((node) => {
          const existing = prevById.get(node.id)
          if (existing) {
            return { ...node, position: existing.position }
          }
          return node
        })
      })
    }

    // Only update edges when they actually changed
    if (edgesWithCallbacks !== prevEdgesRef.current) {
      prevEdgesRef.current = edgesWithCallbacks
      setEdges(edgesWithCallbacks)
    }
  }, [layout, edgesWithCallbacks, nodesWithSelection, setNodes, setEdges])

  // Focus viewport on the most recent phase + neighbors after nodes are initialized
  const handleInit = useCallback(() => {
    if (hasFittedRef.current) return
    hasFittedRef.current = true

    if (focusNodeIds && focusNodeIds.length > 0) {
      rfFitView({
        nodes: focusNodeIds.map((id) => ({ id })),
        maxZoom: 1.5,
        padding: 0.1,
        duration: 300,
      })
    } else {
      rfFitView({ maxZoom: 1.5, padding: 0.05, duration: 300 })
    }
  }, [focusNodeIds, rfFitView])

  return (
    <div
      className={`wf-graph ${className ?? ''} ${hoveredEdge ? 'edge-highlight-active' : ''}`.trim()}
      style={{
        width: '100%',
        height: '100%',
        '--xy-background-color': 'transparent',
        '--xy-node-border-radius': '0',
        '--xy-node-boxshadow-hover': 'none',
        '--xy-node-boxshadow-selected': 'none',
      } as React.CSSProperties}
    >
      {hoveredEdge && (
        <style>{`
          .edge-highlight-active .react-flow__node { opacity: 0.3; }
          .edge-highlight-active .react-flow__node[data-id="${hoveredEdge.source}"],
          .edge-highlight-active .react-flow__node[data-id="${hoveredEdge.target}"] { opacity: 1; }
          .edge-highlight-active .react-flow__edge path { opacity: 0.15; }
          .edge-highlight-active .react-flow__edgelabel-renderer button { opacity: 0.3; }
        `}</style>
      )}
      <ReactFlow
        viewport={viewport}
        onViewportChange={handleViewportChange}
        onMoveEnd={handleMoveEnd}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_event, node) => {
          if (node.data.kind === 'phase') onPhaseClick?.(node.data.labelName)
          if (node.data.kind === 'session') onSessionClick?.(node.data.session.id)
        }}
        onInit={handleInit}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  )
}

export const WorkflowGraph: FC<WorkflowGraphProps> = (props) => (
  <ReactFlowProvider>
    <WorkflowGraphInner {...props} />
  </ReactFlowProvider>
)

export type { WorkflowGraphProps }
