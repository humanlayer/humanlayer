import type { ReactNode } from 'react'
import type { SessionLabel } from '../session-label-badge'
import type { TaskStatus } from '../sidebar/types'

export interface KanbanCommenter {
  name: string
  avatarUrl: string
}

export interface KanbanOwner {
  id?: string
  initials: string
  avatarUrl?: string
}

export interface KanbanCard {
  id: string
  title: string
  ageTimestampMs?: number
  ownerInitials: string
  ownerAvatarUrl?: string
  owners?: KanbanOwner[]
  /** Draft task (not yet launched) — shown with a `[draft]` tag, opens the new-task form. */
  isDraft?: boolean
  workflowLabel: SessionLabel
  /** Live task status — same model/precedence as the left-nav sidebar. */
  status?: TaskStatus
  /** True when any of the task's sessions is unread — same calculation as the left-nav sidebar. */
  isUnread?: boolean
  commentCount?: number
  commenters?: KanbanCommenter[]
}

export interface KanbanColumn {
  id: string
  title: string
  cards: KanbanCard[]
}

export type KanbanColumns = KanbanColumn[]

export interface KanbanCardProps {
  card: KanbanCard
  /** Whether this card is currently focused (keyboard navigation). Used in Phase 4. */
  isFocused?: boolean
  onMouseEnter?: () => void
  /** Navigate to the card's task on click. */
  onClick?: () => void
  /**
   * "Create Session" context-menu item that opens a session draft for this task.
   * Required but nullable: the wired layer always decides (passing `null` for
   * drafts, which have no launched task yet), so the item never renders inert.
   * When non-null, the card is wrapped in a context menu (same as
   * `onForceArchiveTask`/`onForceRenameTask`).
   */
  onCreateSession: ((taskId: string) => void) | null
  /**
   * When provided, the card's root is wrapped in a right-click context menu with an
   * "Archive" item that calls this handler with the card's task id. When both this
   * and `onCopyTaskUrl` are omitted, the card renders with no context menu (keeps
   * pure story/other callers unaffected).
   */
  onArchiveTask?: (taskId: string) => void
  /**
   * When provided, the right-click context menu includes a neutral "Rename" item
   * (for a task the current user owns) that calls this handler with the card's
   * task id. Optional, mirroring `onArchiveTask` — the wired layer only passes it
   * for owners.
   */
  onRenameTask?: (taskId: string) => void
  /**
   * When provided, the right-click context menu includes a "Copy Task URL" item
   * that calls this handler with the card's task id.
   */
  onCopyTaskUrl?: (taskId: string) => void
  /**
   * Admin-only destructive "[Admin] Archive" context-menu item, for archiving a
   * task the current user does not own. Required but nullable: the wired layer
   * always decides (passing `null` when the user is not an admin-non-owner), so
   * the item never renders inert. When non-null, the card is wrapped in a context
   * menu (same as `onArchiveTask`/`onCopyTaskUrl`).
   */
  onForceArchiveTask: ((taskId: string) => void) | null
  /**
   * Admin-only destructive "[Admin] Rename" context-menu item, for renaming a
   * task the current user does not own. Required but nullable: the wired layer
   * always decides (passing `null` when the user is not an admin-non-owner), so
   * the item never renders inert. When non-null, the card is wrapped in a context
   * menu (same as `onForceArchiveTask`).
   */
  onForceRenameTask: ((taskId: string) => void) | null
}

export interface KanbanBoardProps {
  /** Column shells (and their cards) to lay out horizontally. */
  children: ReactNode
}

export interface KanbanColumnProps {
  title: string
  /** Card count shown in the column header badge. */
  count: number
  /** The cards rendered into the column's scrollable stack. */
  children: ReactNode
}
