import { Handle, type NodeProps, Position } from '@xyflow/react'
import { MessageCircleQuestion, TriangleAlert } from 'lucide-react'
import type { FC } from 'react'
import { SyncGridAnimation } from '../sync-grid-animation'
import type { WorkflowPhaseNode, WorkflowSessionNode } from './types'
import { getPhaseColor, getStatusColor, getStatusLabel, stripDatePrefix } from './utils'

/** Session node — renders an individual session card in the graph */
export const SessionNode: FC<NodeProps<WorkflowSessionNode>> = ({ data, selected, sourcePosition, targetPosition }) => {
  const { session } = data
  const phaseColor = getPhaseColor(session.labelName)
  const statusColor = getStatusColor(session.status)
  const statusLabel = getStatusLabel(session.status)
  const hasAttention = !!data.attention

  return (
    <div
      className="font-mono text-xs relative cursor-pointer"
      style={{
        borderLeft: `3px solid ${phaseColor}`,
        border: `1px solid ${hasAttention ? 'var(--terminal-success)' : selected ? phaseColor : 'color-mix(in srgb, var(--terminal-fg) 20%, transparent)'}`,
        borderLeftWidth: '3px',
        borderLeftColor: hasAttention ? 'var(--terminal-success)' : phaseColor,
        backgroundColor: hasAttention
          ? 'color-mix(in srgb, var(--terminal-success) 8%, var(--terminal-bg))'
          : selected
            ? `color-mix(in srgb, ${phaseColor} 10%, var(--terminal-bg))`
            : 'var(--terminal-bg)',
        padding: '8px 12px',
        width: '275px',
      }}
    >
      <Handle type="target" position={targetPosition ?? Position.Top} style={{ visibility: 'hidden' }} />

      {hasAttention && (
        <div
          className="absolute -top-2.5 -right-2.5 animate-bounce flex items-center justify-center"
          style={{
            width: '14px',
            height: '14px',
            backgroundColor: 'var(--terminal-success)',
          }}
        >
          <span
            className="font-mono font-bold leading-none"
            style={{ fontSize: '10px', color: 'var(--terminal-bg)' }}
          >
            !
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 mb-1">
        {session.userProfile && (
          <div
            className="shrink-0 flex items-center justify-center overflow-hidden"
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '0',
              backgroundColor: 'color-mix(in srgb, var(--terminal-fg) 15%, transparent)',
              fontSize: '8px',
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
        <span style={{ color: phaseColor }} className="font-medium text-[10px]">
          {session.labelTitle}
        </span>
        <span
          className="text-[9px] ml-auto flex items-center gap-1"
          style={{ color: statusColor }}
        >
          {statusLabel}
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
            <MessageCircleQuestion className="w-2.5 h-2.5 animate-pulse" strokeWidth={2} />
          )}
          {(session.status === 'failed' || session.status === 'lost') && (
            <TriangleAlert className="w-2.5 h-2.5" strokeWidth={2} />
          )}
        </span>
      </div>

      {session.title && (
        <div
          className="text-[10px] truncate"
          style={{ color: 'var(--terminal-fg)' }}
          title={session.title}
        >
          {session.title}
        </div>
      )}

      {session.artifacts.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {session.artifacts.map((artifact) => (
            <span
              key={artifact.fileName}
              className="text-[8px] truncate max-w-[100px]"
              style={{
                padding: '0px 4px',
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

/** Placeholder node — renders a dimmed placeholder for phases with no sessions */
export const PhasePlaceholderNode: FC<NodeProps<WorkflowPhaseNode>> = ({ data, sourcePosition, targetPosition }) => {
  const { labelName, labelTitle } = data
  const phaseColor = getPhaseColor(labelName)

  return (
    <div
      className="font-mono text-xs"
      style={{
        borderLeft: `3px solid color-mix(in srgb, ${phaseColor} 30%, transparent)`,
        border: '1px dashed color-mix(in srgb, var(--terminal-fg) 15%, transparent)',
        borderLeftWidth: '3px',
        borderLeftColor: `color-mix(in srgb, ${phaseColor} 30%, transparent)`,
        backgroundColor: 'color-mix(in srgb, var(--terminal-bg) 80%, transparent)',
        padding: '8px 12px',
        minWidth: '160px',
        opacity: 0.5,
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={targetPosition ?? Position.Top} style={{ visibility: 'hidden' }} />

      <div className="flex items-center gap-2">
        <span style={{ color: 'var(--terminal-fg-dim)' }} className="font-medium text-[10px]">
          {labelTitle}
        </span>
      </div>

      <Handle type="source" position={sourcePosition ?? Position.Bottom} style={{ visibility: 'hidden' }} />
    </div>
  )
}

export type SessionNodeProps = NodeProps
export type PhasePlaceholderNodeProps = NodeProps
