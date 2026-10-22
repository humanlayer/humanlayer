import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps, getBezierPath } from '@xyflow/react'
import { type FC, useState } from 'react'
import { ARTIFACT_CATEGORY_COLORS } from './utils'

export interface ArtifactEdgeData extends Record<string, unknown> {
  fileName: string
  category: 'source' | 'edited' | 'new'
  onArtifactClick?: (fileName: string) => void
  onEdgeLabelHover?: () => void
  onEdgeLabelLeave?: () => void
  routeY?: number
  routeX?: number
}

type ArtifactGraphEdge = Edge<ArtifactEdgeData, 'artifact'>

export const ArtifactEdge: FC<EdgeProps<ArtifactGraphEdge>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}) => {
  if (!data) return null
  const { fileName, category, onArtifactClick, onEdgeLabelHover, onEdgeLabelLeave, routeY, routeX } = data
  const color = ARTIFACT_CATEGORY_COLORS[category] ?? 'var(--terminal-fg)'
  const [isHovered, setIsHovered] = useState(false)

  let edgePath: string
  let labelX: number
  let labelY: number

  if (routeY !== undefined) {
    // Two smooth bezier segments arcing above intermediate nodes
    const midX = (sourceX + targetX) / 2
    const cpX = Math.abs(targetX - sourceX) * 0.25
    edgePath = [
      `M ${sourceX} ${sourceY}`,
      `C ${sourceX + cpX} ${sourceY}, ${midX - cpX} ${routeY}, ${midX} ${routeY}`,
      `C ${midX + cpX} ${routeY}, ${targetX - cpX} ${targetY}, ${targetX} ${targetY}`,
    ].join(' ')
    labelX = midX
    labelY = routeY
  } else if (routeX !== undefined) {
    const midY = (sourceY + targetY) / 2
    const cpY = Math.abs(targetY - sourceY) * 0.25
    edgePath = [
      `M ${sourceX} ${sourceY}`,
      `C ${sourceX} ${sourceY + cpY}, ${routeX} ${midY - cpY}, ${routeX} ${midY}`,
      `C ${routeX} ${midY + cpY}, ${targetX} ${targetY - cpY}, ${targetX} ${targetY}`,
    ].join(' ')
    labelX = routeX
    labelY = midY
  } else {
    ;[edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    })
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: selected || isHovered ? 2 : 1.5,
          ...(selected || isHovered ? { opacity: 1 } : {}),
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className="nodrag nopan font-mono"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            fontSize: '10px',
            padding: '2px 6px',
            borderRadius: '0',
            border: `1px solid color-mix(in srgb, ${color} 50%, transparent)`,
            backgroundColor: `color-mix(in srgb, ${color} 10%, var(--terminal-bg))`,
            color: color,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            ...(isHovered ? { opacity: 1 } : {}),
          }}
          onMouseEnter={() => {
            setIsHovered(true)
            onEdgeLabelHover?.()
          }}
          onMouseLeave={() => {
            setIsHovered(false)
            onEdgeLabelLeave?.()
          }}
          onClick={(e) => {
            e.stopPropagation()
            onArtifactClick?.(fileName)
          }}
        >
          {fileName}
        </button>
      </EdgeLabelRenderer>
    </>
  )
}

export type ArtifactEdgeProps = EdgeProps
