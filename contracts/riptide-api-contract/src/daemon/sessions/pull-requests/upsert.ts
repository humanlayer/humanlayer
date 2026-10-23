import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { PullRequestStateSchema } from '../../pull-requests/pull-request-state'

/**
 * @deprecated The server discovers pull requests itself from branch events and the GitHub App.
 * Kept so a daemon that still scans after a run gets an accepted no-op, not a missing route.
 */
export const UpsertSessionPullRequestInputSchema = z.object({
	sessionId: z.uuid(),
	repoFullName: z.string().min(3), // "owner/repo", server lowercases
	number: z.number().int().positive(),
	url: z.url(),
	title: z.string(),
	state: PullRequestStateSchema,
	isDraft: z.boolean().default(false),
	headRef: z.string(),
	baseRef: z.string().optional(),
	authorGithubLogin: z.string().optional(),
	/**
	 * GitHub's authoritative account type for the author (gh `author.is_bot`,
	 * GraphQL `__typename: Bot`) — true only for GitHub App bot accounts. When
	 * absent, the server falls back to the reserved `[bot]` login suffix.
	 */
	authorIsBot: z.boolean().optional(),
	authorGithubId: z.string().optional(),
	githubNodeId: z.string().optional(),
	openedAt: z.number().int().optional(), // epoch ms
	mergedAt: z.number().int().optional(),
	mergedByGithubLogin: z.string().optional(),
	closedAt: z.number().int().optional(),
	captureVersion: z.number().int().default(1),
})

/** Null: the report was accepted and discarded. */
export const UpsertSessionPullRequestOutputSchema = z.object({
	pullRequestId: z.uuid().nullable(),
})

export const upsertSessionPullRequestContract = contractBuilder
	.input(UpsertSessionPullRequestInputSchema)
	.output(UpsertSessionPullRequestOutputSchema)
