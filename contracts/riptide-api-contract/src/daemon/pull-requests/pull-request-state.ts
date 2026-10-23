import z from 'zod/v4'

/**
 * The PR state lattice. Mirrored as a plain string union in `@humanlayer/db/tables/pull-requests`
 * (db cannot depend on contracts).
 */
export const PullRequestStateSchema = z.enum(['open', 'closed', 'merged'])
export type PullRequestState = z.infer<typeof PullRequestStateSchema>
