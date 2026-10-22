import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

// Input schema - the daemon reports the user's own GitHub identity, captured
// once at startup from their authenticated `gh api user`. The WorkOS user and
// org are ALWAYS taken from the daemon token server-side, never from input
// (anti-spoofing — identity drives merged-PR credit).
export const SetGithubIdentityInputSchema = z.object({
	login: z.string().min(1),
	externalId: z.string().min(1), // GitHub numeric id as text — stable across renames
	email: z.string().optional(),
})

// No transactionId: the table is not Electric-synced, nothing consumes a txid.
export const SetGithubIdentityOutputSchema = z.object({
	ok: z.boolean(),
})

export const setGithubIdentityContract = contractBuilder
	.input(SetGithubIdentityInputSchema)
	.output(SetGithubIdentityOutputSchema)
