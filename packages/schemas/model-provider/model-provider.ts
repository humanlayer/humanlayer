import * as Schema from 'effect/Schema'
import z from 'zod/v4'

export const SELECTABLE_MODEL_PROVIDER_VALUES = ['anthropic', 'copilot', 'codex', 'firepass', 'xai'] as const

export const SelectableModelProvider = Schema.Literals(SELECTABLE_MODEL_PROVIDER_VALUES)
export type SelectableModelProvider = typeof SelectableModelProvider.Type
export const SelectableModelProviderZodSchema = z.enum(SELECTABLE_MODEL_PROVIDER_VALUES)

export const FOLD_MODEL_PROVIDER_VALUES = ['codex', 'xai'] as const satisfies readonly SelectableModelProvider[]

export const FoldModelProvider = Schema.Literals(FOLD_MODEL_PROVIDER_VALUES)
export type FoldModelProvider = typeof FoldModelProvider.Type
export const FoldModelProviderZodSchema = z.enum(FOLD_MODEL_PROVIDER_VALUES)
