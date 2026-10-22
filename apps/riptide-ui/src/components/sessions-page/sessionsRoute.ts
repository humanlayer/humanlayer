import z from 'zod/v4'

/**
 * One URL serves both the desktop and mobile trees, so this schema is the union
 * of what either accepts; each tree narrows it to its own tabs.
 *
 * Live values: `tasks` / `sessions` / `drafts` (desktop) and `tasks` /
 * `shared-tasks` (mobile).
 *
 * TODO(2026-07-29): `kanban` has no producer. Nothing in the tree navigates to
 * it and neither tree renders it — it is accepted only so bookmarks and pasted
 * links from before the Tasks tab absorbed the board still pass validation
 * instead of failing this schema. Drop it once those links have aged out; both
 * trees already fall through to `tasks`, so removal is a one-line change here.
 */
export const sessionsSearchSchema = z.object({
	task: z.string().optional(),
	tab: z.enum(['tasks', 'kanban', 'sessions', 'drafts', 'context-shards', 'shared-tasks']).optional(),
})

export type SessionsRouteTab = z.infer<typeof sessionsSearchSchema>['tab']
export type SessionsRouteTo = '/' | '/sessions'
