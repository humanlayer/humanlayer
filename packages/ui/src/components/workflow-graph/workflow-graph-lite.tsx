import { applyNodeChanges, type OnMove, type OnNodesChange, ReactFlow, ReactFlowProvider, useReactFlow, type Viewport } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './workflow-graph.css'
import { Expand, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import { type FC, useCallback, useMemo, useRef, useState } from 'react'
import { useMountEffect } from '../../hooks/use-mount-effect'
import { Button } from '../button'
import { Dialog, DialogContent } from '../dialog'
import { RPI_LABELS } from '../../constants/rpi-skills'
import { ArtifactEdge } from './artifact-edge'
import { AutoAdvanceEdge } from './auto-advance-edge'
import { computeLayout } from './layout-lite'
import { PhasePlaceholderNode, SessionNode } from './phase-node-lite'
import type {
  ArtifactFlow,
  AutoAdvanceEdge as AutoAdvanceEdgeType,
  WorkflowGraphProps,
  WorkflowGraphNode,
  WorkflowPhase,
  WorkflowSession,
} from './types-lite'
import { snapViewportToDevicePixels } from './viewport'

const nodeTypes = { session: SessionNode, phasePlaceholder: PhasePlaceholderNode }
const edgeTypes = { artifact: ArtifactEdge, autoAdvance: AutoAdvanceEdge }

function getFitViewPadding(direction: 'LR' | 'TB', isStatic?: boolean): number {
  if (isStatic && direction === 'TB') return 0.14
  if (isStatic) return 0.06
  return 0.02
}

/**
 * Produce a stable fingerprint for sessions + flows so we only re-layout
 * when the data structurally changes, not just when the reference changes.
 */
function dataFingerprint(
  sessions: WorkflowSession[],
  flows: ArtifactFlow[],
  autoAdvance?: AutoAdvanceEdgeType[],
  phases?: WorkflowPhase[],
  isStatic?: boolean,
  compactStaticPreview?: boolean,
): string {
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
  const p = (phases ?? [])
    .map((p) => `${p.name}:${p.title}:${p.synthetic ? 'synthetic' : 'phase'}`)
    .join('|')
  return `${s};;${f};;${a};;${p};;${isStatic ? 'static' : 'interactive'};;${compactStaticPreview ? 'compact' : 'default'}`
}

const WorkflowGraphInner: FC<WorkflowGraphProps & { onOpenFullscreen?: () => void }> = ({
  sessions,
  artifactFlows = [],
  direction = 'TB',
  selectedNodeId,
  attentionNodeId,
  autoAdvanceEdges,
  phases,
  static: isStatic,
  compactStaticPreview,
  onSessionClick,
  onPhaseClick,
  onArtifactClick,
  showFullscreenButton = true,
  controlsLayout = 'horizontal',
  controlsPosition = 'bottom-right',
  onOpenFullscreen,
  className,
}) => {
  // Store callbacks in refs so they never cause edge/node recomputation
  const onArtifactClickRef = useRef(onArtifactClick)
  onArtifactClickRef.current = onArtifactClick

  // Only recompute layout when the data structurally changes
  const fingerprintRef = useRef('')
  const layoutRef = useRef(
    computeLayout(sessions, artifactFlows, direction, autoAdvanceEdges, phases, isStatic, compactStaticPreview),
  )
  const prevDirectionRef = useRef(direction)

  const layout = useMemo(() => {
    const fp = dataFingerprint(sessions, artifactFlows, autoAdvanceEdges, phases, isStatic, compactStaticPreview)
    if (fp === fingerprintRef.current && direction === prevDirectionRef.current) {
      return layoutRef.current
    }
    fingerprintRef.current = fp
    prevDirectionRef.current = direction
    const newLayout = computeLayout(
      sessions,
      artifactFlows,
      direction,
      autoAdvanceEdges,
      phases,
      isStatic,
      compactStaticPreview,
    )
    layoutRef.current = newLayout
    return newLayout
  }, [sessions, artifactFlows, direction, autoAdvanceEdges, phases, isStatic, compactStaticPreview])

  // Structural fingerprint of everything that affects node *positions* (the node
  // and edge set + direction), deliberately excluding styling-only fields like
  // status. Used as the ReactFlow `key` so the graph remounts and refits only on
  // genuine layout changes, and to reset user-dragged positions at the same time.
  const structureKey = useMemo(() => {
    const s = sessions
      .map((session) => `${session.id}:${session.labelName}`)
      .sort()
      .join('|')
    const f = artifactFlows
      .map((flow) => `${flow.fromSessionId}->${flow.toSessionId}:${flow.fileName}`)
      .sort()
      .join('|')
    const a = (autoAdvanceEdges ?? [])
      .map((edge) => `${edge.fromLabel}->${edge.toLabel}`)
      .sort()
      .join('|')
    const p = (phases ?? []).map((phase) => `${phase.name}:${phase.synthetic ? 'synthetic' : 'phase'}`).join('|')
    return `${s};;${f};;${a};;${p};;${direction};;${isStatic ? 'static' : 'interactive'};;${compactStaticPreview ? 'compact' : 'default'}`
  }, [sessions, artifactFlows, autoAdvanceEdges, phases, direction, isStatic, compactStaticPreview])

  const [viewportState, setViewportState] = useState<{
    structureKey: string
    viewport?: Viewport
  }>({ structureKey })
  const viewport = viewportState.structureKey === structureKey ? viewportState.viewport : undefined
  const handleViewportChange = useCallback((nextViewport: Viewport) => {
    setViewportState({ structureKey, viewport: nextViewport })
  }, [structureKey])
  const handleMoveEnd = useCallback<OnMove>((_event, nextViewport) => {
    const pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio
    setViewportState({
      structureKey,
      viewport: snapViewportToDevicePixels(nextViewport, pixelRatio),
    })
  }, [structureKey])

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

    const orderedPhases = phases ?? RPI_LABELS.filter((l) => l.name !== 'rpi:todo')

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
  }, [sessions, phases])

  const { fitView: rfFitView, zoomIn: rfZoomIn, zoomOut: rfZoomOut } = useReactFlow()
  const fitViewPadding = getFitViewPadding(direction, isStatic)
  // Interactive graphs should fill the canvas on fit; static previews keep their
  // deliberate (maxZoom 1) sizing. fitView never zooms past what's needed to fit
  // all nodes, so this just lifts the artificial clamp that was leaving slack.
  const fitMaxZoom = isStatic ? 1 : 2
  const containerRef = useRef<HTMLDivElement>(null)

  const [nodeState, setNodeState] = useState<{
    structureKey: string
    baseNodes: WorkflowGraphNode[]
    nodes: WorkflowGraphNode[]
  }>(() => ({ structureKey, baseNodes: nodesWithSelection, nodes: nodesWithSelection }))

  let nodes = nodeState.nodes
  if (nodeState.baseNodes !== nodesWithSelection) {
    const structureChanged = nodeState.structureKey !== structureKey
    const prevById = new Map(nodeState.nodes.map((node) => [node.id, node]))
    nodes = structureChanged
      ? nodesWithSelection
      : nodesWithSelection.map((node) => {
          const existing = prevById.get(node.id)
          return existing ? { ...node, position: existing.position, dragging: existing.dragging } : node
        })
    setNodeState({ structureKey, baseNodes: nodesWithSelection, nodes })
  }

  const onNodesChange = useCallback<OnNodesChange<WorkflowGraphNode>>((changes) => {
    setNodeState((current) => ({ ...current, nodes: applyNodeChanges(changes, current.nodes) }))
  }, [])

  const fitToViewport = useCallback(() => {
    requestAnimationFrame(() => {
      rfFitView({ maxZoom: fitMaxZoom, padding: fitViewPadding, duration: 0 })
    })
  }, [rfFitView, fitViewPadding, fitMaxZoom])

  // Manual "fit to view" toolbar action — animated to match the zoom buttons.
  const handleFitView = useCallback(() => {
    rfFitView({ maxZoom: fitMaxZoom, padding: fitViewPadding, duration: 200 })
  }, [rfFitView, fitViewPadding, fitMaxZoom])

  // Keep the graph fitted as the window / container resizes. fitToViewport's
  // identity changes with padding/zoom, so the subscriptions read the latest
  // via a ref and only need to attach once.
  const fitToViewportRef = useRef(fitToViewport)
  fitToViewportRef.current = fitToViewport

  useMountEffect(() => {
    if (typeof window === 'undefined') return
    const handleResize = () => fitToViewportRef.current()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  })

  useMountEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const resizeObserver = new ResizeObserver(() => fitToViewportRef.current())
    resizeObserver.observe(el)
    return () => resizeObserver.disconnect()
  })

  return (
    <div
      ref={containerRef}
      className={`wf-graph relative ${className ?? ''} ${hoveredEdge ? 'edge-highlight-active' : ''}`.trim()}
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
        key={structureKey}
        viewport={viewport}
        onViewportChange={handleViewportChange}
        onMoveEnd={handleMoveEnd}
        nodes={nodes}
        edges={edgesWithCallbacks}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_event, node) => {
          if (node.data.synthetic) return
          if (node.data.kind === 'phase') onPhaseClick?.(node.data.labelName)
          if (node.data.kind === 'session') onSessionClick?.(node.data.session.id)
        }}
        fitView
        fitViewOptions={{ maxZoom: fitMaxZoom, padding: fitViewPadding }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
      />
      <div
        className={`absolute right-2 z-10 flex gap-1 ${
          controlsPosition === 'header-right'
            ? '-top-4'
            : controlsPosition === 'top-right'
              ? 'top-2'
              : 'bottom-2'
        } ${
          controlsLayout === 'vertical-fullscreen-first' ? 'flex-col' : 'items-center'
        }`}
      >
        {showFullscreenButton && onOpenFullscreen && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 bg-background/80 hover:bg-background"
            onClick={(e) => {
              e.stopPropagation()
              onOpenFullscreen()
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Expand className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 bg-background/80 hover:bg-background"
          onClick={handleFitView}
        >
          <Scan className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 bg-background/80 hover:bg-background"
          onClick={() => rfZoomIn({ duration: 200 })}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 bg-background/80 hover:bg-background"
          onClick={() => rfZoomOut({ duration: 200 })}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

export const WorkflowGraphLite: FC<WorkflowGraphProps> = (props) => {
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false)
  const { fullscreenDirection, showFullscreenButton = true } = props

  return (
    <>
      <ReactFlowProvider>
        <WorkflowGraphInner
          {...props}
          onOpenFullscreen={showFullscreenButton ? () => setIsFullscreenOpen(true) : undefined}
        />
      </ReactFlowProvider>

		<Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
			<DialogContent
				className="!max-w-[95vw] !w-[95vw] !h-[85vh] !p-4 !gap-0 overflow-hidden [&>button]:z-20"
				onEscapeKeyDown={(e) => e.stopPropagation()}
			>
          <ReactFlowProvider>
            <WorkflowGraphInner
              {...props}
              direction={fullscreenDirection ?? props.direction}
              controlsLayout="horizontal"
              controlsPosition="bottom-right"
              showFullscreenButton={false}
            />
          </ReactFlowProvider>
        </DialogContent>
      </Dialog>
    </>
  )
}

export type { WorkflowGraphProps }
