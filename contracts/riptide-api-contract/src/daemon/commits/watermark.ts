import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

// Per-(host, repo) resume watermark for the daemon's commit HEAD-watch. The daemon
// reads these on startup to re-derive last_seen_sha..HEAD, and advances them only
// after a successful record. Host is taken from the daemon token (context.auth.hostId).

// Watermark shas are re-embedded in `git rev-list` ranges daemon-side, so the WRITE boundary
// rejects anything that isn't sha-shaped — garbage must never enter the table. Directory paths
// share CommitSchema's repoDirectory cap.
const WatermarkShaSchema = z.string().regex(/^[0-9a-f]{40,64}$/)
const RepoDirectorySchema = z.string().min(1).max(2048)

export const GetWatermarksInputSchema = z.object({
	// Bounded well above the daemon's current one-directory-per-scan usage, leaving room to
	// batch the reconcile fetch without inviting unbounded payloads.
	repoDirectories: z.array(RepoDirectorySchema).min(1).max(500),
})

export const GetWatermarksOutputSchema = z.object({
	watermarks: z.array(
		z.object({
			repoDirectory: z.string(),
			// null when no scan has landed yet for this repo (or no row exists). Deliberately
			// NOT sha-validated on the read side: the daemon re-validates before use, and a
			// legacy row must degrade to "never scanned", not fail the whole read.
			lastSeenSha: z.string().nullable(),
		}),
	),
})

export const SetWatermarkInputSchema = z.object({
	repoDirectory: RepoDirectorySchema,
	lastSeenSha: WatermarkShaSchema,
})

export const SetWatermarkOutputSchema = z.object({
	ok: z.boolean(),
})

export const getCommitWatermarksContract = contractBuilder
	.input(GetWatermarksInputSchema)
	.output(GetWatermarksOutputSchema)

export const setCommitWatermarkContract = contractBuilder
	.input(SetWatermarkInputSchema)
	.output(SetWatermarkOutputSchema)
