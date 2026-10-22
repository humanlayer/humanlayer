import { cn } from '@humanlayer/ui/lib/utils'
import { type ReactNode, useId } from 'react'
import { Switch } from './switch'
import { UserMultiSelect, type UserOption } from './user-multi-select'

export type TaskViewLayout = 'list' | 'board'
export type TaskViewMode = 'mine' | 'everything'

export interface TaskViewControlsProps {
  /** Which layout the Tasks surface is rendering. */
  layout: TaskViewLayout
  /** Active scope. */
  mode: TaskViewMode
  /** Currently selected owner ids (Everything only). */
  selectedIds: Set<string>
  /** Candidate owners for the multi-select (Everything only). */
  users: UserOption[]
  /** Tasks shown by the active layout after eligibility and scope filtering. */
  taskCount: number
  /** Whether List groups rows by workflow phase. Ignored on Board. */
  grouped: boolean
  onLayoutChange: (layout: TaskViewLayout) => void
  onModeChange: (mode: TaskViewMode) => void
  onSelectionChange: (selectedIds: Set<string>) => void
  onGroupedChange: (grouped: boolean) => void
}

/**
 * Pure, controlled control row for the Tasks surface: the List/Board layout
 * choice, the Everything/Mine scope choice, a `UserMultiSelect` (Everything
 * only), and the filtered task count.
 *
 * Both choice groups use the understated text-and-underline treatment of the
 * top tabs rather than filled segments; spacing keeps the groups distinct.
 *
 * All state is owned by the caller (wired to `taskViewPreferencesStore` in
 * production).
 */
export function TaskViewControls({
  layout,
  mode,
  selectedIds,
  users,
  taskCount,
  grouped,
  onLayoutChange,
  onModeChange,
  onSelectionChange,
  onGroupedChange,
}: TaskViewControlsProps) {
  const isMine = mode === 'mine'
  const groupedSwitchId = useId()

  return (
    // Fixed height, not min-height: the owner picker mounts and unmounts with
    // the scope choice, and the row must not resize under it.
    <div
      className="flex h-[57px] items-center gap-7 px-4 py-3"
      style={{ borderBottom: '1px solid var(--terminal-border)' }}
    >
      {/* Layout: List / Board */}
      <div className="relative flex gap-3.5 after:absolute after:inset-x-0 after:bottom-0 after:z-0 after:h-0.5 after:bg-border/60 after:content-['']">
        <TaskViewChoice active={layout === 'list'} onClick={() => onLayoutChange('list')}>
          List
        </TaskViewChoice>
        <TaskViewChoice active={layout === 'board'} onClick={() => onLayoutChange('board')}>
          Board
        </TaskViewChoice>
      </div>

      {/* Scope: Everything / Mine */}
      <div className="relative flex gap-3.5 after:absolute after:inset-x-0 after:bottom-0 after:z-0 after:h-0.5 after:bg-border/60 after:content-['']">
        <TaskViewChoice active={!isMine} onClick={() => onModeChange('everything')}>
          Everything
        </TaskViewChoice>
        <TaskViewChoice active={isMine} onClick={() => onModeChange('mine')}>
          Mine
        </TaskViewChoice>
      </div>

      {/* Owner picker (only when Everything is selected) */}
      {!isMine && (
        <UserMultiSelect
          users={users}
          selectedIds={selectedIds}
          onSelectionChange={onSelectionChange}
          placeholder="Filter Users"
          className="h-8 min-w-[152px]"
        />
      )}

      {/* Grouping is a property of the table layout, so Board never offers it.
          A switch rather than a text choice: this is an on/off property, not a
          member of an exclusive set like the two choice groups to its left. */}
      {layout === 'list' && (
        <label
          htmlFor={groupedSwitchId}
          className="flex cursor-pointer items-center gap-2 text-xs uppercase tracking-wider"
        >
          <Switch id={groupedSwitchId} checked={grouped} onCheckedChange={onGroupedChange} />
          <span>Grouped</span>
        </label>
      )}

      {/* Filtered task count */}
      <div className="ml-auto text-xs uppercase tracking-wider" style={{ color: 'var(--terminal-fg-dim)' }}>
        {taskCount} task{taskCount !== 1 ? 's' : ''}
      </div>
    </div>
  )
}

function TaskViewChoice({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'relative z-10 inline-flex h-8 cursor-pointer items-center px-0.5 text-xs uppercase tracking-wider transition-colors',
        active
          ? 'text-foreground after:absolute after:inset-x-0.5 after:bottom-0 after:h-0.5 after:bg-[var(--terminal-accent)] after:content-[""]'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
