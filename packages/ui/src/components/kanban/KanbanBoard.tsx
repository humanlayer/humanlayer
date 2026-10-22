import { useRef } from 'react'
import { useMountEffect } from '../../hooks/use-mount-effect'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../context-menu'
import { SessionLabelBadge } from '../session-label-badge'
import { renderTaskStatusIndicator, UnreadBullet } from '../sidebar/status-indicators'
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip'
import type {
  KanbanBoardProps,
  KanbanCard as KanbanCardModel,
  KanbanCardProps,
  KanbanColumnProps,
  KanbanOwner,
} from './types'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30 * DAY_MS
const OLD_TASK_AGE_MS = 14 * DAY_MS

export function formatKanbanCardAge(createdAtMs: number, nowMs = Date.now()): string {
  const ageMs = Math.max(0, nowMs - createdAtMs)

  if (ageMs < HOUR_MS) return `${Math.max(1, Math.floor(ageMs / MINUTE_MS))}m`
  if (ageMs < DAY_MS) return `${Math.floor(ageMs / HOUR_MS)}h`
  if (ageMs < MONTH_MS) return `${Math.floor(ageMs / DAY_MS)}d`
  return `${Math.floor(ageMs / MONTH_MS)}mo`
}

export function formatKanbanCardAgeLong(createdAtMs: number, nowMs = Date.now()): string {
  const ageMs = Math.max(0, nowMs - createdAtMs)

  if (ageMs < HOUR_MS) return formatAgeUnit(Math.max(1, Math.floor(ageMs / MINUTE_MS)), 'minute')
  if (ageMs < DAY_MS) return formatAgeUnit(Math.floor(ageMs / HOUR_MS), 'hour')
  if (ageMs < MONTH_MS) return formatAgeUnit(Math.floor(ageMs / DAY_MS), 'day')
  return formatAgeUnit(Math.floor(ageMs / MONTH_MS), 'month')
}

function formatAgeUnit(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`
}

/**
 * Pure presentational kanban card.
 *
 * Renders owner avatar/initials, title, workflow badge, live status indicator,
 * and (when present) an unresolved-comment indicator. No business logic, no
 * queries — the wired layer (`WiredKanbanCard`) supplies comment/focus data.
 */
export function KanbanCard({
  card,
  isFocused,
  onMouseEnter,
  onClick,
  onCreateSession,
  onArchiveTask,
  onRenameTask,
  onCopyTaskUrl,
  onForceArchiveTask,
  onForceRenameTask,
}: KanbanCardProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Scroll a card that mounts focused into view. Callers must key this
  // component by focus state (see WiredKanbanCard) so that gaining focus
  // re-mounts the card and re-runs this — keyboard navigation then scrolls
  // without a reactive effect.
  useMountEffect(() => {
    if (isFocused) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  })

  const cardRoot = (
    <div
      ref={ref}
      data-kanban-task-id={card.id}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`cursor-pointer border-l-2 p-3 transition-colors duration-200 ${
        isFocused ? 'border-l-[var(--terminal-accent)] bg-accent/10' : 'border-l-transparent bg-accent/5 hover:bg-accent/10'
      }`}
      style={{
        fontFamily: '"IBM Plex Mono", monospace',
        borderRadius: 0,
      }}
    >
      <KanbanCardContent card={card} />
    </div>
  )

  // Only wrap in a right-click context menu when a handler is supplied, so pure
  // stories and other callers that omit them render exactly as before.
  if (
    onCreateSession === null &&
    !onArchiveTask &&
    !onRenameTask &&
    !onCopyTaskUrl &&
    onForceArchiveTask === null &&
    onForceRenameTask === null
  ) {
    return cardRoot
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{cardRoot}</ContextMenuTrigger>
      <ContextMenuContent className="w-fit">
        {onCreateSession !== null && (
          <ContextMenuItem className="whitespace-nowrap" onSelect={() => onCreateSession(card.id)}>
            Create Session
          </ContextMenuItem>
        )}
        {onCopyTaskUrl && (
          <ContextMenuItem className="whitespace-nowrap" onSelect={() => onCopyTaskUrl(card.id)}>
            Copy Task URL
          </ContextMenuItem>
        )}
        {onRenameTask && (
          <ContextMenuItem className="whitespace-nowrap" onSelect={() => onRenameTask(card.id)}>
            Rename
          </ContextMenuItem>
        )}
        {onArchiveTask && (
          <ContextMenuItem className="whitespace-nowrap" onSelect={() => onArchiveTask(card.id)}>
            Archive
          </ContextMenuItem>
        )}
        {onForceArchiveTask !== null && (
          <ContextMenuItem
            variant="destructive"
            className="whitespace-nowrap"
            onSelect={() => onForceArchiveTask(card.id)}
          >
            Archive
          </ContextMenuItem>
        )}
        {onForceRenameTask !== null && (
          <ContextMenuItem
            variant="destructive"
            className="whitespace-nowrap"
            onSelect={() => onForceRenameTask(card.id)}
          >
            Rename
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function KanbanCardContent({ card }: { card: KanbanCardModel }) {
  const owners = card.owners && card.owners.length > 0 ? card.owners : [{ initials: card.ownerInitials, avatarUrl: card.ownerAvatarUrl }]
  const ageLabel = card.ageTimestampMs === undefined ? null : formatKanbanCardAge(card.ageTimestampMs)
  const ageTooltip = card.ageTimestampMs === undefined ? null : `Last updated ${formatKanbanCardAgeLong(card.ageTimestampMs)} ago`
  const isOld = card.ageTimestampMs !== undefined && Date.now() - card.ageTimestampMs >= OLD_TASK_AGE_MS

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span
          className="line-clamp-2 min-w-0 flex-1 text-sm leading-tight [overflow-wrap:anywhere]"
          title={card.title}
          style={{ color: 'var(--terminal-fg)' }}
        >
          {card.title}
        </span>
        <OwnerAvatarStack owners={owners} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {ageLabel && ageTooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={isOld ? 'px-1 py-0.5 text-[10px] leading-none' : 'text-xs leading-none'}
                  style={
                    isOld
                      ? {
                          border: '1px solid color-mix(in srgb, var(--terminal-warning) 35%, transparent)',
                          backgroundColor: 'color-mix(in srgb, var(--terminal-warning) 8%, transparent)',
                          color: 'color-mix(in srgb, var(--terminal-warning) 80%, var(--terminal-fg))',
                        }
                      : { color: 'color-mix(in srgb, var(--terminal-fg) 80%, transparent)' }
                  }
                >
                  {ageLabel}
                </span>
              </TooltipTrigger>
              <TooltipContent>{ageTooltip}</TooltipContent>
            </Tooltip>
          )}
          {card.isDraft ? (
            <SessionLabelBadge label={{ name: 'rpi:todo', title: 'draft' }} />
          ) : (
            <SessionLabelBadge label={card.workflowLabel} />
          )}
        </div>

        <div className="flex items-center gap-2">
          {card.isUnread === true && <UnreadBullet />}
          {renderTaskStatusIndicator(card.status)}

          {card.commentCount !== undefined && card.commentCount > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="flex -space-x-1.5">
                {(card.commenters ?? []).slice(0, 3).map((commenter, i) => (
                  <img
                    // biome-ignore lint/suspicious/noArrayIndexKey: commenter avatars are positional
                    key={i}
                    src={commenter.avatarUrl}
                    alt={commenter.name}
                    className="h-4 w-4 object-cover"
                    style={{ border: '1px solid var(--terminal-bg)' }}
                  />
                ))}
              </div>
              <span className="text-xs" style={{ color: 'var(--terminal-fg-dim)' }}>
                {card.commentCount}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OwnerAvatarStack({ owners }: { owners: KanbanOwner[] }) {
  const visibleOwners = owners.slice(0, 3)
  const extraCount = Math.max(owners.length - visibleOwners.length, 0)

  return (
    <div className="flex shrink-0 -space-x-1.5" aria-label={`${owners.length} task owner${owners.length === 1 ? '' : 's'}`}>
      {visibleOwners.map((owner, index) =>
        owner.avatarUrl ? (
          <img
            key={owner.id ?? `${owner.initials}-${index}`}
            src={owner.avatarUrl}
            alt={owner.initials}
            className="h-6 w-6 shrink-0 object-cover"
            style={{ border: '1px solid var(--terminal-bg)' }}
          />
        ) : (
          <div
            key={owner.id ?? `${owner.initials}-${index}`}
            className="flex h-6 w-6 shrink-0 items-center justify-center text-xs font-medium"
            style={{
              backgroundColor: 'var(--terminal-bg-alt)',
              border: '1px solid var(--terminal-border)',
              color: 'var(--terminal-fg)',
            }}
          >
            {owner.initials}
          </div>
        ),
      )}
      {extraCount > 0 && (
        <div
          className="flex h-6 w-6 shrink-0 items-center justify-center text-[10px] font-medium"
          style={{
            backgroundColor: 'var(--terminal-bg-alt)',
            border: '1px solid var(--terminal-border)',
            color: 'var(--terminal-fg-dim)',
          }}
        >
          +{extraCount}
        </div>
      )}
    </div>
  )
}

/**
 * Pure column shell: a header (title + count badge) over a vertical, scrollable
 * stack of cards passed as `children`. Card composition is owned by the caller,
 * so wired callers can pass connected cards without a render-prop.
 */
export function KanbanColumn({ title, count, children }: KanbanColumnProps) {
  return (
    <div className="flex h-full min-w-72 flex-1 flex-col" style={{ fontFamily: '"IBM Plex Mono", monospace' }}>
      <div className="flex items-center justify-between px-2 pb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--terminal-fg)' }}>
          {title}
        </h3>
        <span
          className="flex h-5 min-w-5 items-center justify-center px-1 text-xs"
          style={{
            backgroundColor: 'var(--terminal-bg)',
            color: 'var(--terminal-fg-dim)',
          }}
        >
          {count}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 py-0.5">{children}</div>
    </div>
  )
}

/**
 * Pure read-only kanban board: a horizontal, scrollable row of {@link KanbanColumn}
 * shells passed as `children`. Layout only — no data, no drag, no state. The wired
 * layer (`WiredBoardTasksView`) composes columns and cards from `useKanbanColumns`.
 */
export function KanbanBoard({ children }: KanbanBoardProps) {
  return (
    <div
      className="flex h-full gap-2 overflow-x-auto p-4"
      style={{ backgroundColor: 'var(--terminal-bg)', fontFamily: '"IBM Plex Mono", monospace' }}
    >
      {children}
    </div>
  )
}
