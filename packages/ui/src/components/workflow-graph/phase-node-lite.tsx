import { Handle, type NodeProps, Position } from '@xyflow/react'
import { MessageCircleQuestion, TriangleAlert } from 'lucide-react'
import type { FC } from 'react'
import { SyncGridAnimation } from '../sync-grid-animation'
import type { WorkflowPhaseNode, WorkflowSessionNode } from './types-lite'
import { getPhaseColor, getStatusColor, getStatusLabel, stripDatePrefix } from './utils'

/** Session node — narrow but tall version for LR layout */
export const SessionNode: FC<NodeProps<WorkflowSessionNode>> = ({ data, selected, sourcePosition, targetPosition }) => {
  const { session } = data
  const phaseColor = getPhaseColor(session.labelName)
  const statusColor = getStatusColor(session.status)
  const statusLabel = getStatusLabel(session.status)
  const hasAttention = !!data.attention
  const isSynthetic = !!data.synthetic

  return (
    <div
      className={`font-mono relative ${isSynthetic ? '' : 'cursor-pointer'}`}
      style={{
        borderLeft: `2px ${isSynthetic ? 'dotted' : 'solid'} ${isSynthetic ? 'color-mix(in srgb, var(--terminal-fg) 35%, transparent)' : phaseColor}`,
        border: `1px ${isSynthetic ? 'dotted' : 'solid'} ${
          isSynthetic
            ? 'color-mix(in srgb, var(--terminal-fg) 35%, transparent)'
            : hasAttention
              ? 'var(--terminal-success)'
              : selected
                ? phaseColor
                : 'color-mix(in srgb, var(--terminal-fg) 20%, transparent)'
        }`,
        borderLeftWidth: '2px',
        borderLeftColor: isSynthetic
          ? 'color-mix(in srgb, var(--terminal-fg) 35%, transparent)'
          : hasAttention
            ? 'var(--terminal-success)'
            : phaseColor,
        backgroundColor: isSynthetic
          ? 'transparent'
          : hasAttention
            ? 'color-mix(in srgb, var(--terminal-success) 8%, var(--terminal-bg))'
            : selected
              ? `color-mix(in srgb, ${phaseColor} 10%, var(--terminal-bg))`
              : 'var(--terminal-bg)',
        padding: '6px 8px',
        width: '170px',
        cursor: isSynthetic ? 'default' : undefined,
      }}
    >
      <Handle type="target" position={targetPosition ?? Position.Top} style={{ visibility: 'hidden' }} />

      {hasAttention && (
        <div
          className="absolute -top-2 -right-2 animate-bounce flex items-center justify-center"
          style={{
            width: '12px',
            height: '12px',
            backgroundColor: 'var(--terminal-success)',
          }}
        >
          <span
            className="font-mono font-bold leading-none"
            style={{ fontSize: '9px', color: 'var(--terminal-bg)' }}
          >
            !
          </span>
        </div>
      )}

      <div className="flex items-center gap-1 mb-1">
        {session.userProfile && (
          <div
            className="shrink-0 flex items-center justify-center overflow-hidden"
            style={{
              width: '12px',
              height: '12px',
              backgroundColor: 'color-mix(in srgb, var(--terminal-fg) 15%, transparent)',
              fontSize: '7px',
              color: 'var(--terminal-fg-dim)',
            }}
            title={session.userProfile.initials}
          >
            {session.userProfile.profilePictureUrl ? (
              <img
                src={session.userProfile.profilePictureUrl}
                alt={session.userProfile.initials}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="font-medium leading-none">{session.userProfile.initials}</span>
            )}
          </div>
        )}
        <span
          style={{ color: isSynthetic ? 'var(--terminal-fg-dim)' : phaseColor }}
          className="font-medium text-[9px] truncate"
        >
          {session.labelTitle}
        </span>
      </div>

      <div className="flex items-center gap-1" style={{ color: statusColor }}>
        <span className="text-[8px]">{statusLabel}</span>
        {session.status === 'running' && (
          <SyncGridAnimation
            variant="ring"
            synchronized
            size="xs"
            className="text-[var(--terminal-success)]"
          />
        )}
        {session.status === 'interrupt_requested' && (
          <SyncGridAnimation
            variant="ring"
            synchronized
            size="xs"
            className="text-[var(--terminal-warning)]"
          />
        )}
        {session.status === 'needs_approval' && (
          <MessageCircleQuestion className="w-2 h-2 animate-pulse" strokeWidth={2} />
        )}
        {(session.status === 'failed' || session.status === 'lost') && (
          <TriangleAlert className="w-2 h-2" strokeWidth={2} />
        )}
      </div>

      {session.title && (
        <div
          className="text-[9px] mt-1"
          style={{
            color: 'var(--terminal-fg)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={session.title}
        >
          {session.title}
        </div>
      )}

      {session.artifacts.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-1">
          {session.artifacts.map((artifact) => (
            <span
              key={artifact.fileName}
              className="text-[7px] truncate"
              style={{
                padding: '0px 3px',
                border: `1px solid color-mix(in srgb, var(--terminal-fg) 15%, transparent)`,
                color: 'var(--terminal-fg-dim)',
              }}
              title={artifact.fileName}
            >
              {stripDatePrefix(artifact.fileName)}
            </span>
          ))}
        </div>
      )}

      <Handle type="source" position={sourcePosition ?? Position.Bottom} style={{ visibility: 'hidden' }} />
    </div>
  )
}

/** Placeholder node — compact version for LR layout */
export const PhasePlaceholderNode: FC<NodeProps<WorkflowPhaseNode>> = ({ data, sourcePosition, targetPosition }) => {
  const { labelName, labelTitle, isStatic, compactStaticPreview, synthetic } = data
  const phaseColor = getPhaseColor(labelName)
  const width = compactStaticPreview ? '128px' : isStatic ? '280px' : '90px'
  const padding = compactStaticPreview ? '10px 12px' : isStatic ? '20px 24px' : '6px 8px'
  const fontSizeClass = compactStaticPreview ? 'text-xs' : isStatic ? 'text-base' : 'text-[9px]'

  if (synthetic) {
    return (
      <div
        className="font-mono nodrag"
        style={{
          border: '1px dotted color-mix(in srgb, var(--terminal-fg) 35%, transparent)',
          backgroundColor: 'transparent',
          padding,
          width,
          cursor: 'default',
        }}
      >
        <Handle type="target" position={targetPosition ?? Position.Top} style={{ visibility: 'hidden' }} />

        <div className="flex items-center justify-center">
          <span style={{ color: 'var(--terminal-fg-dim)' }} className={`font-medium ${fontSizeClass} truncate`}>
            {labelTitle}
          </span>
        </div>

        <Handle type="source" position={sourcePosition ?? Position.Bottom} style={{ visibility: 'hidden' }} />
      </div>
    )
  }

  return (
    <div
      className="font-mono"
      style={{
        borderLeft: `2px solid ${isStatic ? phaseColor : `color-mix(in srgb, ${phaseColor} 70%, transparent)`}`,
        border: `1px ${isStatic ? 'solid' : 'dashed'} ${isStatic ? 'var(--terminal-fg-dim)' : 'color-mix(in srgb, var(--terminal-fg) 40%, transparent)'}`,
        borderLeftWidth: '2px',
        borderLeftColor: isStatic ? phaseColor : `color-mix(in srgb, ${phaseColor} 70%, transparent)`,
        backgroundColor: 'var(--terminal-bg)',
        padding,
        width,
        opacity: isStatic ? 1 : 0.8,
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={targetPosition ?? Position.Top} style={{ visibility: 'hidden' }} />

      <div className="flex items-center justify-center">
        <span style={{ color: 'var(--terminal-fg)' }} className={`font-medium ${fontSizeClass} truncate`}>
          {labelTitle}
        </span>
      </div>

      <Handle type="source" position={sourcePosition ?? Position.Bottom} style={{ visibility: 'hidden' }} />
    </div>
  )
}

export type SessionNodeProps = NodeProps
export type PhasePlaceholderNodeProps = NodeProps
