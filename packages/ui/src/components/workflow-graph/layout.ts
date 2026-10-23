import { Position, type Edge } from '@xyflow/react'
import { RPI_LABELS } from '../../constants/rpi-skills'
import type {
  ArtifactFlow,
  AutoAdvanceEdge,
  LayoutDirection,
  WorkflowGraphNode,
  WorkflowSession,
} from './types'

const SESSION_NODE_WIDTH = 275
const SESSION_NODE_HEIGHT = 70
const PLACEHOLDER_NODE_WIDTH = 180
const PLACEHOLDER_NODE_HEIGHT = 50

/** Spacing between phase columns (LR) or rows (TB) */
const PHASE_GAP_LR = 160
const PHASE_GAP_TB = 80
/** Spacing between sessions stacked within a phase */
const SESSION_GAP = 96
/** Outer margin */
const MARGIN = 40
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
): LayoutResult {
  if (direction === 'TB') {
    return computePhaseRowLayout(sessions, artifactFlows, autoAdvanceEdges)
  }
  // Default: LR
  return computePhaseColumnLayout(sessions, artifactFlows, autoAdvanceEdges)
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
): LayoutResult {
  const orderedPhases = RPI_LABELS.filter((l) => l.name !== 'rpi:todo')

  const sessionsByPhase = new Map<string, WorkflowSession[]>()
  for (const s of sessions) {
    const arr = sessionsByPhase.get(s.labelTitle) ?? []
    arr.push(s)
    sessionsByPhase.set(s.labelTitle, arr)
  }

  // Show all phases (full pipeline)
  const visiblePhases = orderedPhases

  // Compute the max session count across all phases to determine total height
  const maxSessionsInPhase = Math.max(
    1,
    ...visiblePhases.map((p) => (sessionsByPhase.get(p.title) ?? []).length),
  )
  const totalStackHeight =
    maxSessionsInPhase * SESSION_NODE_HEIGHT + (maxSessionsInPhase - 1) * SESSION_GAP
  const centerY = MARGIN + totalStackHeight / 2

  // Build nodes
  const nodes: WorkflowGraphNode[] = []
  const allNodeIds = new Set<string>()

  for (const [colIdx, phase] of visiblePhases.entries()) {
    const phaseSessions = sessionsByPhase.get(phase.title) ?? []
    const x = MARGIN + colIdx * (SESSION_NODE_WIDTH + PHASE_GAP_LR)

    if (phaseSessions.length === 0) {
      // Placeholder node, centered vertically
      const id = `placeholder-${phase.title}`
      nodes.push({
        id,
        type: 'phasePlaceholder',
        position: {
          x: x + (SESSION_NODE_WIDTH - PLACEHOLDER_NODE_WIDTH) / 2,
          y: centerY - PLACEHOLDER_NODE_HEIGHT / 2,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { kind: 'phase', labelName: phase.name, labelTitle: phase.title },
      })
      allNodeIds.add(id)
    } else {
      // Stack sessions vertically, centered around centerY
      const stackHeight =
        phaseSessions.length * SESSION_NODE_HEIGHT + (phaseSessions.length - 1) * SESSION_GAP
      const startY = centerY - stackHeight / 2

      for (const [i, session] of phaseSessions.entries()) {
        nodes.push({
          id: session.id,
          type: 'session',
          position: {
            x,
            y: startY + i * (SESSION_NODE_HEIGHT + SESSION_GAP),
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { kind: 'session', session },
        })
        allNodeIds.add(session.id)
      }
    }
  }

  const edges = buildEdges(visiblePhases, sessionsByPhase, artifactFlows, autoAdvanceEdges, allNodeIds, nodes, 'LR', centerY)

  return { nodes, edges }
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
): LayoutResult {
  const orderedPhases = RPI_LABELS.filter((l) => l.name !== 'rpi:todo')

  const sessionsByPhase = new Map<string, WorkflowSession[]>()
  for (const s of sessions) {
    const arr = sessionsByPhase.get(s.labelTitle) ?? []
    arr.push(s)
    sessionsByPhase.set(s.labelTitle, arr)
  }

  // Show all phases (full pipeline)
  const visiblePhases = orderedPhases

  // Compute the max session count across all phases to determine total width
  const maxSessionsInPhase = Math.max(
    1,
    ...visiblePhases.map((p) => (sessionsByPhase.get(p.title) ?? []).length),
  )
  const totalSpreadWidth =
    maxSessionsInPhase * SESSION_NODE_WIDTH + (maxSessionsInPhase - 1) * SESSION_GAP
  const centerX = MARGIN + totalSpreadWidth / 2

  // Build nodes
  const nodes: WorkflowGraphNode[] = []
  const allNodeIds = new Set<string>()

  for (const [rowIdx, phase] of visiblePhases.entries()) {
    const phaseSessions = sessionsByPhase.get(phase.title) ?? []
    const y = MARGIN + rowIdx * (SESSION_NODE_HEIGHT + PHASE_GAP_TB)

    if (phaseSessions.length === 0) {
      const id = `placeholder-${phase.title}`
      nodes.push({
        id,
        type: 'phasePlaceholder',
        position: {
          x: centerX - PLACEHOLDER_NODE_WIDTH / 2,
          y: y + (SESSION_NODE_HEIGHT - PLACEHOLDER_NODE_HEIGHT) / 2,
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        data: { kind: 'phase', labelName: phase.name, labelTitle: phase.title },
      })
      allNodeIds.add(id)
    } else {
      // Spread sessions horizontally, centered around centerX
      const spreadWidth =
        phaseSessions.length * SESSION_NODE_WIDTH + (phaseSessions.length - 1) * SESSION_GAP
      const startX = centerX - spreadWidth / 2

      for (const [i, session] of phaseSessions.entries()) {
        nodes.push({
          id: session.id,
          type: 'session',
          position: {
            x: startX + i * (SESSION_NODE_WIDTH + SESSION_GAP),
            y,
          },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
          data: { kind: 'session', session },
        })
        allNodeIds.add(session.id)
      }
    }
  }

  const edges = buildEdges(visiblePhases, sessionsByPhase, artifactFlows, autoAdvanceEdges, allNodeIds, nodes, 'TB', centerX)

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
): Edge[] {
  const edges: Edge[] = []

  const autoAdvanceSet = new Set(
    (autoAdvanceEdges ?? []).map((e) => `${e.fromLabel}->${e.toLabel}`),
  )

  // Structural edges between consecutive phases where at least one side is a placeholder
  // This shows the "pipeline ahead" for un-started phases
  for (let i = 0; i < visiblePhases.length - 1; i++) {
    const sourcePhase = visiblePhases[i]
    const targetPhase = visiblePhases[i + 1]
    if (sourcePhase === undefined || targetPhase === undefined) continue
    const sourceSessions = sessionsByPhase.get(sourcePhase.title) ?? []
    const targetSessions = sessionsByPhase.get(targetPhase.title) ?? []

    // Only draw structural edges when the target is a placeholder (un-started phase)
    if (targetSessions.length > 0) continue

    const lastSourceSession = sourceSessions.at(-1)
    const sourceId = lastSourceSession !== undefined
      ? lastSourceSession.id
      : `placeholder-${sourcePhase.title}`
    const targetId = `placeholder-${targetPhase.title}`

    const isAutoAdvance =
      autoAdvanceSet.has(`${sourcePhase.name}->${targetPhase.name}`) &&
      targetSessions.length === 0

    edges.push({
      id: `structural-${sourceId}-${targetId}`,
      source: sourceId,
      target: targetId,
      type: isAutoAdvance ? 'autoAdvance' : 'default',
      style: isAutoAdvance ? undefined : {
        stroke: 'var(--terminal-fg-dim)',
        strokeWidth: 1,
        opacity: 0.3,
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
