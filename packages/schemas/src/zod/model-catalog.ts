import z from 'zod/v4'

export const HOST_MODEL_CATALOG_PROVIDERS = ['anthropic', 'codex'] as const
export const HostModelCatalogProviderSchema = z.enum(HOST_MODEL_CATALOG_PROVIDERS)
export type HostModelCatalogProvider = z.infer<typeof HostModelCatalogProviderSchema>

export const HostModelEffortLevelSchema = z.string().min(1)

export const HostModelCatalogEntrySchema = z.object({
	provider: HostModelCatalogProviderSchema,
	value: z.string().min(1),
	resolvedModel: z.string().min(1).optional(),
	label: z.string().min(1),
	description: z.string().optional(),
	isDefault: z.boolean(),
	hidden: z.boolean(),
	effortLevels: z.array(HostModelEffortLevelSchema),
	defaultEffort: HostModelEffortLevelSchema.optional(),
	supportsFastMode: z.boolean(),
	supportsAutoMode: z.boolean(),
	contextWindow: z.number().int().positive().optional(),
})
export type HostModelCatalogEntry = z.infer<typeof HostModelCatalogEntrySchema>

export const HostModelCatalogProviderResultSchema = z.discriminatedUnion('status', [
	z.object({ status: z.literal('ok'), models: z.array(HostModelCatalogEntrySchema) }),
	z.object({ status: z.literal('unavailable'), reason: z.string(), models: z.array(HostModelCatalogEntrySchema) }),
])
export type HostModelCatalogProviderResult = z.infer<typeof HostModelCatalogProviderResultSchema>

export const HostModelCatalogSchema = z.object({
	probedAt: z.number().int().nonnegative(),
	anthropic: HostModelCatalogProviderResultSchema,
	codex: HostModelCatalogProviderResultSchema,
})
export type HostModelCatalog = z.infer<typeof HostModelCatalogSchema>

export function unavailableHostModelCatalogProvider(reason: string): HostModelCatalogProviderResult {
	return { status: 'unavailable', reason, models: [] }
}

export function visibleHostModelCatalogEntries(
	catalog: HostModelCatalog | null | undefined,
	provider: HostModelCatalogProvider,
): HostModelCatalogEntry[] | null {
	const result = catalog?.[provider]
	if (!result || result.status !== 'ok') return null
	return result.models.filter((entry) => !entry.hidden)
}

export function findHostModelCatalogEntry(
	catalog: HostModelCatalog | null | undefined,
	provider: HostModelCatalogProvider | null | undefined,
	model: string | null | undefined,
): HostModelCatalogEntry | null {
	if (!model || !provider) return null
	const result = catalog?.[provider]
	if (!result || result.status !== 'ok') return null
	return (
		result.models.find((entry) => entry.value === model) ??
		result.models.find((entry) => entry.resolvedModel === model) ??
		null
	)
}
