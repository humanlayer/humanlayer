import * as Schema from 'effect/Schema'

import { NormalizedRepositoryIdentity } from './project-recipe'

export const RepositorySourcePreference = Schema.Union([
	Schema.Struct({ kind: Schema.tag('filesystem'), path: Schema.NonEmptyString }),
	Schema.Struct({ kind: Schema.tag('managed_clone') }),
])
export type RepositorySourcePreference = typeof RepositorySourcePreference.Type

export const RepositorySourceSelection = Schema.Union([
	Schema.Struct({ kind: Schema.tag('unknown') }),
	RepositorySourcePreference,
])
export type RepositorySourceSelection = typeof RepositorySourceSelection.Type

export const RepositorySourceSelections = Schema.Record(NormalizedRepositoryIdentity, RepositorySourceSelection)
export type RepositorySourceSelections = typeof RepositorySourceSelections.Type
