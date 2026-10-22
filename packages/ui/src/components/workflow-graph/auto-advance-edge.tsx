import { type EdgeProps, getBezierPath } from '@xyflow/react'
import type { FC } from 'react'

/**
 * Custom edge for auto-advance indicators between phases.
 * Uses SVG SMIL <animate> instead of CSS animation — SMIL animations
 * run in the SVG rendering pipeline and are immune to React re-renders,
 * so they don't restart when ReactFlow re-renders the edge on mouse events.
 */
export const AutoAdvanceEdge: FC<EdgeProps> = ({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}) => {
  const color = 'var(--terminal-success)'

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray="6 4"
        opacity={0.7}
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-20"
          dur="0.6s"
          repeatCount="indefinite"
        />
      </path>
    </>
  )
}
