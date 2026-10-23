import type {
	RepositorySourcePreference,
	RepositorySourceSelection,
	RepositorySourceSelections,
} from '@humanlayer/schemas/effect/project-workspace/repository-source-preference'
import z from 'zod/v4'

import { NormalizedRepositoryIdentitySchema } from './project-recipe'

export const RepositorySourcePreferenceSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('filesystem'), path: z.string().trim().min(1) }),
	z.object({ kind: z.literal('managed_clone') }),
])

export const RepositorySourceSelectionSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('unknown') }),
	z.object({ kind: z.literal('filesystem'), path: z.string().trim().min(1) }),
	z.object({ kind: z.literal('managed_clone') }),
])

export const RepositorySourceSelectionsSchema = z.record(
	NormalizedRepositoryIdentitySchema,
	RepositorySourceSelectionSchema,
)

export type { RepositorySourcePreference, RepositorySourceSelection, RepositorySourceSelections }
