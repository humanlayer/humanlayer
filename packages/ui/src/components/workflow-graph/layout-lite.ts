import { Position, type Edge } from '@xyflow/react'
import { RPI_LABELS } from '../../constants/rpi-skills'
import type {
  ArtifactFlow,
  AutoAdvanceEdge,
  LayoutDirection,
  WorkflowGraphNode,
  WorkflowPhase,
  WorkflowSession,
} from './types-lite'

const SESSION_NODE_WIDTH = 170
const SESSION_NODE_HEIGHT = 90
const PLACEHOLDER_NODE_WIDTH = 90
const PLACEHOLDER_NODE_HEIGHT = 28
const STATIC_PLACEHOLDER_NODE_WIDTH = 280
const STATIC_PLACEHOLDER_NODE_HEIGHT = 88
const COMPACT_STATIC_PLACEHOLDER_NODE_WIDTH = 128
const COMPACT_STATIC_PLACEHOLDER_NODE_HEIGHT = 40

/** Spacing between phase columns (LR) or rows (TB) */
const PHASE_GAP_LR = 32
const PHASE_GAP_TB = 44
const STATIC_PREVIEW_WIDTH = 720
const STATIC_PREVIEW_HEIGHT = 760
/** Spacing between sessions stacked vertically within a phase */
const SESSION_STACK_GAP = 8
/** Spacing between sessions spread horizontally within a phase */
const SESSION_SPREAD_GAP = 16
/** Outer margin */
const MARGIN = 16
/** Clearance above intermediate nodes for routed artifact edges */
const ROUTE_MARGIN = 40
/** Stagger between multiple routed edges */
const ROUTE_STAGGER = 12

export interface LayoutResult {
  nodes: WorkflowGraphNode[]
  edges: Edge[]
}

export function computeLayout(
  sessions: WorkflowSession[],
  artifactFlows: ArtifactFlow[],
  direction: LayoutDirection,
  autoAdvanceEdges?: AutoAdvanceEdge[],
  phases?: WorkflowPhase[],
  isStatic?: boolean,
  compactStaticPreview?: boolean,
): LayoutResult {
  const effectivePhases = phases ?? RPI_LABELS.filter((l) => l.name !== 'rpi:todo')
  if (direction === 'TB') {
    return computePhaseRowLayout(
      sessions,
      artifactFlows,
      autoAdvanceEdges,
      effectivePhases,
      isStatic,
      compactStaticPreview,
    )
  }
  // Default: LR
  return computePhaseColumnLayout(
    sessions,
    artifactFlows,
    autoAdvanceEdges,
    effectivePhases,
    isStatic,
    compactStaticPreview,
  )
}

/**
 * LR layout: each phase is a column, sessions stack vertically within the column.
 *
 *                        [research]
 * [research-questions] → [research] → [design] → [outline] → [plan] → [impl] → [pr]
 *                        [research]                                     [impl]
 */
function computePhaseColumnLayout(
  sessions: WorkflowSession[],
  artifactFlows: ArtifactFlow[],
  autoAdvanceEdges?: AutoAdvanceEdge[],
  phases?: WorkflowPhase[],
  isStatic?: boolean,
  compactStaticPreview?: boolean,
): LayoutResult {
  const orderedPhases: WorkflowPhase[] = phases ?? RPI_LABELS.filter((l) => l.name !== 'rpi:todo')

  const sessionsByPhase = new Map<string, WorkflowSession[]>()
  for (const s of sessions) {
    const arr = sessionsByPhase.get(s.labelName) ?? []
    arr.push(s)
    sessionsByPhase.set(s.labelName, arr)
  }

  // Show all phases (full pipeline)
  const visiblePhases = orderedPhases

  // Compute the max session count across all phases to determine total height
  const maxSessionsInPhase = Math.max(
    1,
    ...visiblePhases.map((p) => (sessionsByPhase.get(p.name) ?? []).length),
  )
	const totalStackHeight =
		maxSessionsInPhase * SESSION_NODE_HEIGHT + (maxSessionsInPhase - 1) * SESSION_STACK_GAP
  const centerY = MARGIN + totalStackHeight / 2

  // Build nodes
  const nodes: WorkflowGraphNode[] = []
  const allNodeIds = new Set<string>()
  const placeholderWidth = compactStaticPreview
    ? COMPACT_STATIC_PLACEHOLDER_NODE_WIDTH
    : isStatic
      ? STATIC_PLACEHOLDER_NODE_WIDTH
      : PLACEHOLDER_NODE_WIDTH
  const placeholderHeight = compactStaticPreview
    ? COMPACT_STATIC_PLACEHOLDER_NODE_HEIGHT
    : isStatic
      ? STATIC_PLACEHOLDER_NODE_HEIGHT
      : PLACEHOLDER_NODE_HEIGHT
  const phaseStep = compactStaticPreview
    ? COMPACT_STATIC_PLACEHOLDER_NODE_WIDTH + 20
    : getPhaseStep(visiblePhases.length, isStatic, SESSION_NODE_WIDTH, PHASE_GAP_LR, STATIC_PREVIEW_WIDTH)

  for (const [colIdx, phase] of visiblePhases.entries()) {
    const phaseSessions = sessionsByPhase.get(phase.name) ?? []
    const x = MARGIN + colIdx * phaseStep

    if (phaseSessions.length === 0) {
      // Placeholder node, centered vertically
      const id = `placeholder-${phase.title}`
      nodes.push({
        id,
        type: 'phasePlaceholder',
        position: {
          x: x + (SESSION_NODE_WIDTH - placeholderWidth) / 2,
          y: centerY - placeholderHeight / 2,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          kind: 'phase',
          labelName: phase.name,
          labelTitle: phase.title,
          isStatic,
          compactStaticPreview,
          synthetic: phase.synthetic,
        },
      })
      allNodeIds.add(id)
    } else {
      // Stack sessions vertically, centered around centerY
		const stackHeight =
			phaseSessions.length * SESSION_NODE_HEIGHT + (phaseSessions.length - 1) * SESSION_STACK_GAP
      const startY = centerY - stackHeight / 2

      for (const [i, session] of phaseSessions.entries()) {
        nodes.push({
          id: session.id,
          type: 'session',
          position: {
            x,
				y: startY + i * (SESSION_NODE_HEIGHT + SESSION_STACK_GAP),
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { kind: 'session', session, synthetic: phase.synthetic },
        })
        allNodeIds.add(session.id)
      }
    }
  }

  const edges = buildEdges(visiblePhases, sessionsByPhase, artifactFlows, autoAdvanceEdges, allNodeIds, nodes, 'LR', centerY, isStatic)

  return { nodes, edges }
}

function getPhaseStep(
  phaseCount: number,
  isStatic: boolean | undefined,
  nodeSize: number,
  phaseGap: number,
  staticPreviewSize: number,
): number {
  const defaultStep = nodeSize + phaseGap
  if (!isStatic || phaseCount <= 1) return defaultStep

  const spreadStep = (staticPreviewSize - nodeSize) / (phaseCount - 1)
  return Math.max(defaultStep, spreadStep)
}

/**
 * TB layout: each phase is a row, sessions spread horizontally within the row.
 *
 *              [research-questions]
 *                      |
 *       [research] [research] [research]
 *                      |
 *                  [design]
 *                      |
 *                  [outline]
 *                      |
 *                   [plan]
 *                      |
 *       [impl] [impl] [impl] [impl]
 *                      |
 *                    [pr]
 */
function computePhaseRowLayout(
  sessions: WorkflowSession[],
  artifactFlows: ArtifactFlow[],
  autoAdvanceEdges?: AutoAdvanceEdge[],
  phases?: WorkflowPhase[],
  isStatic?: boolean,
  compactStaticPreview?: boolean,
): LayoutResult {
  const orderedPhases: WorkflowPhase[] = phases ?? RPI_LABELS.filter((l) => l.name !== 'rpi:todo')

  const sessionsByPhase = new Map<string, WorkflowSession[]>()
  for (const s of sessions) {
    const arr = sessionsByPhase.get(s.labelName) ?? []
    arr.push(s)
    sessionsByPhase.set(s.labelName, arr)
  }

  // Show all phases (full pipeline)
  const visiblePhases = orderedPhases

  // Compute the max session count across all phases to determine total width
  const maxSessionsInPhase = Math.max(
    1,
    ...visiblePhases.map((p) => (sessionsByPhase.get(p.name) ?? []).length),
  )
	const totalSpreadWidth =
		maxSessionsInPhase * SESSION_NODE_WIDTH + (maxSessionsInPhase - 1) * SESSION_SPREAD_GAP
  const centerX = MARGIN + totalSpreadWidth / 2

  // Build nodes
  const nodes: WorkflowGraphNode[] = []
  const allNodeIds = new Set<string>()
  const placeholderWidth = compactStaticPreview
    ? COMPACT_STATIC_PLACEHOLDER_NODE_WIDTH
    : isStatic
      ? STATIC_PLACEHOLDER_NODE_WIDTH
      : PLACEHOLDER_NODE_WIDTH
  const placeholderHeight = compactStaticPreview
    ? COMPACT_STATIC_PLACEHOLDER_NODE_HEIGHT
    : isStatic
      ? STATIC_PLACEHOLDER_NODE_HEIGHT
      : PLACEHOLDER_NODE_HEIGHT
  const phaseStep = compactStaticPreview
    ? COMPACT_STATIC_PLACEHOLDER_NODE_HEIGHT + 20
    : getPhaseStep(visiblePhases.length, isStatic, SESSION_NODE_HEIGHT, PHASE_GAP_TB, STATIC_PREVIEW_HEIGHT)

  for (const [rowIdx, phase] of visiblePhases.entries()) {
    const phaseSessions = sessionsByPhase.get(phase.name) ?? []
    const y = MARGIN + rowIdx * phaseStep

    if (phaseSessions.length === 0) {
      const id = `placeholder-${phase.title}`
      nodes.push({
        id,
        type: 'phasePlaceholder',
        position: {
          x: centerX - placeholderWidth / 2,
          y: y + (SESSION_NODE_HEIGHT - placeholderHeight) / 2,
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        data: {
          kind: 'phase',
          labelName: phase.name,
          labelTitle: phase.title,
          isStatic,
          compactStaticPreview,
          synthetic: phase.synthetic,
        },
      })
      allNodeIds.add(id)
    } else {
      // Spread sessions horizontally, centered around centerX
		const spreadWidth =
			phaseSessions.length * SESSION_NODE_WIDTH + (phaseSessions.length - 1) * SESSION_SPREAD_GAP
      const startX = centerX - spreadWidth / 2

      for (const [i, session] of phaseSessions.entries()) {
        nodes.push({
          id: session.id,
          type: 'session',
          position: {
				x: startX + i * (SESSION_NODE_WIDTH + SESSION_SPREAD_GAP),
            y,
          },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
          data: { kind: 'session', session, synthetic: phase.synthetic },
        })
        allNodeIds.add(session.id)
      }
    }
  }

  const edges = buildEdges(visiblePhases, sessionsByPhase, artifactFlows, autoAdvanceEdges, allNodeIds, nodes, 'TB', centerX, isStatic)

  return { nodes, edges }
}

/**
 * Build edges shared by both layout modes:
 * 1. Structural edges ONLY between consecutive placeholder (un-started) phases
 * 2. Artifact flow edges between sessions (data-driven)
 */
function buildEdges(
  visiblePhases: Array<{ name: string; title: string }>,
  sessionsByPhase: Map<string, WorkflowSession[]>,
  artifactFlows: ArtifactFlow[],
  autoAdvanceEdges: AutoAdvanceEdge[] | undefined,
  allNodeIds: Set<string>,
  nodes: WorkflowGraphNode[],
  direction: LayoutDirection,
  layoutCenter: number,
  isStatic?: boolean,
): Edge[] {
  const edges: Edge[] = []

  const autoAdvanceSet = new Set(
    (autoAdvanceEdges ?? []).map((e) => `${e.fromLabel}->${e.toLabel}`),
  )

  // Structural edges between consecutive phases.
  // In static mode: always draw edges between all phases.
  // When no artifact flows are provided: always draw structural edges (show workflow direction).
  // Otherwise: only draw when target is a placeholder (artifact flows show real connections).
  const hasArtifactFlows = artifactFlows.length > 0
  for (let i = 0; i < visiblePhases.length - 1; i++) {
    const sourcePhase = visiblePhases[i]
    const targetPhase = visiblePhases[i + 1]
    if (sourcePhase === undefined || targetPhase === undefined) continue
    const sourceSessions = sessionsByPhase.get(sourcePhase.name) ?? []
    const targetSessions = sessionsByPhase.get(targetPhase.name) ?? []

    if (targetSessions.length > 0 && !isStatic && hasArtifactFlows) continue

    const lastSourceSession = sourceSessions.at(-1)
    const sourceId = lastSourceSession !== undefined
      ? lastSourceSession.id
      : `placeholder-${sourcePhase.title}`
    const firstTargetSession = targetSessions[0]
    const targetId = firstTargetSession !== undefined
      ? firstTargetSession.id
      : `placeholder-${targetPhase.title}`

    const isAutoAdvance =
      autoAdvanceSet.has(`${sourcePhase.name}->${targetPhase.name}`) &&
      targetSessions.length === 0

    edges.push({
      id: `structural-${sourceId}-${targetId}`,
      source: sourceId,
      target: targetId,
      type: isAutoAdvance ? 'autoAdvance' : 'default',
      style: isAutoAdvance ? undefined : {
        stroke: 'var(--terminal-fg)',
        strokeWidth: 1.5,
        strokeDasharray: targetSessions.length === 0 ? '4 3' : undefined,
        opacity: 0.5,
      },
      animated: false,
    })
  }

  // --- Routing for artifact edges that cross intermediate session nodes ---
  const phaseIdxByTitle = new Map<string, number>()
  for (const [i, phase] of visiblePhases.entries()) {
    phaseIdxByTitle.set(phase.title, i)
  }
  const sessionPhaseIdx = new Map<string, number>()
  for (const [title, sessions] of sessionsByPhase) {
    const idx = phaseIdxByTitle.get(title)
    if (idx !== undefined) {
      for (const s of sessions) sessionPhaseIdx.set(s.id, idx)
    }
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  let routeStaggerIdx = 0

  // Artifact flow edges between sessions (data-driven edges)
  for (const flow of artifactFlows) {
    if (!allNodeIds.has(flow.fromSessionId) || !allNodeIds.has(flow.toSessionId)) continue

    const fromIdx = sessionPhaseIdx.get(flow.fromSessionId)
    const toIdx = sessionPhaseIdx.get(flow.toSessionId)
    let routeData: Record<string, number> = {}

    if (fromIdx !== undefined && toIdx !== undefined && Math.abs(toIdx - fromIdx) > 1) {
      const minIdx = Math.min(fromIdx, toIdx)
      const maxIdx = Math.max(fromIdx, toIdx)

      const intermediatePositions: Array<{ x: number; y: number }> = []
      for (let p = minIdx + 1; p < maxIdx; p++) {
        const phase = visiblePhases[p]
        if (phase === undefined) continue
        const title = phase.title
        for (const s of (sessionsByPhase.get(title) ?? [])) {
          const node = nodeById.get(s.id)
          if (node) intermediatePositions.push(node.position)
        }
      }

      if (intermediatePositions.length > 0) {
        const sourceNode = nodeById.get(flow.fromSessionId)
        const targetNode = nodeById.get(flow.toSessionId)

        if (sourceNode && targetNode && direction === 'LR') {
          const srcHY = sourceNode.position.y + SESSION_NODE_HEIGHT / 2
          const tgtHY = targetNode.position.y + SESSION_NODE_HEIGHT / 2
          const corridorTop = Math.min(srcHY, tgtHY) - SESSION_NODE_HEIGHT
          const corridorBot = Math.max(srcHY, tgtHY) + SESSION_NODE_HEIGHT
          const blocking = intermediatePositions.filter(
            (p) => p.y < corridorBot && p.y + SESSION_NODE_HEIGHT > corridorTop,
          )
          if (blocking.length > 0) {
            const edgeMidY = (srcHY + tgtHY) / 2
            const routeBelow = edgeMidY > layoutCenter
            if (routeBelow) {
              const botY = Math.max(...blocking.map((p) => p.y + SESSION_NODE_HEIGHT))
              routeData = { routeY: botY + ROUTE_MARGIN + routeStaggerIdx * ROUTE_STAGGER }
            } else {
              const topY = Math.min(...blocking.map((p) => p.y))
              routeData = { routeY: topY - ROUTE_MARGIN - routeStaggerIdx * ROUTE_STAGGER }
            }
            routeStaggerIdx++
          }
        } else if (sourceNode && targetNode && direction === 'TB') {
          const srcHX = sourceNode.position.x + SESSION_NODE_WIDTH / 2
          const tgtHX = targetNode.position.x + SESSION_NODE_WIDTH / 2
          const corridorL = Math.min(srcHX, tgtHX) - SESSION_NODE_WIDTH
          const corridorR = Math.max(srcHX, tgtHX) + SESSION_NODE_WIDTH
          const blocking = intermediatePositions.filter(
            (p) => p.x < corridorR && p.x + SESSION_NODE_WIDTH > corridorL,
          )
          if (blocking.length > 0) {
            const edgeMidX = (srcHX + tgtHX) / 2
            const routeRight = edgeMidX > layoutCenter
            if (routeRight) {
              const rightX = Math.max(...blocking.map((p) => p.x + SESSION_NODE_WIDTH))
              routeData = { routeX: rightX + ROUTE_MARGIN + routeStaggerIdx * ROUTE_STAGGER }
            } else {
              const leftX = Math.min(...blocking.map((p) => p.x))
              routeData = { routeX: leftX - ROUTE_MARGIN - routeStaggerIdx * ROUTE_STAGGER }
            }
            routeStaggerIdx++
          }
        }
      }
    }

    edges.push({
      id: `artifact-${flow.fromSessionId}-${flow.toSessionId}-${flow.fileName}`,
      source: flow.fromSessionId,
      target: flow.toSessionId,
      type: 'artifact',
      data: {
        fileName: flow.fileName,
        category: flow.category,
        ...routeData,
      },
    })
  }

  return edges
}
