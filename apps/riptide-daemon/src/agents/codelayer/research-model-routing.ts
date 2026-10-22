import type { ProviderType } from '@humanlayer/codelayer'
import type { HostModelCatalog } from '@humanlayer/schemas/zod/model-catalog'

type RiptideProviderType = ProviderType | 'firepass'

const CODEX_RESEARCH_MODEL_ID = 'gpt-5.6-terra'
const CODEX_MODELS_WITH_TERRA_RESEARCH = new Set([
	'gpt-6.1-sol',
	'gpt-6-astra',
	'gpt-6-sol',
	'gpt-6-luna',
	'gpt-5.6-sol',
	CODEX_RESEARCH_MODEL_ID,
	'gpt-5.6-luna',
])

function researchModelOffered(catalog: HostModelCatalog | undefined): boolean {
	if (catalog?.codex.status !== 'ok' || catalog.codex.models.length === 0) return true
	return catalog.codex.models.some((entry) => entry.value === CODEX_RESEARCH_MODEL_ID)
}

export function getResearchSubagentModelId(
	provider: RiptideProviderType,
	modelId: string,
	catalog: HostModelCatalog | undefined,
): string | undefined {
	if (provider !== 'codex' || !CODEX_MODELS_WITH_TERRA_RESEARCH.has(modelId)) return undefined
	return researchModelOffered(catalog) ? CODEX_RESEARCH_MODEL_ID : undefined
}
