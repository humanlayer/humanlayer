import {
	type EffortCapability,
	type EffortLevel,
	getDefaultEffort,
	getEffortCapability,
	getFastModeCapability,
} from '@humanlayer/ai/config'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import {
	findHostModelCatalogEntry,
	type HostModelCatalog,
	type HostModelCatalogEntry,
	visibleHostModelCatalogEntries,
} from '@humanlayer/schemas/zod/model-catalog'
import {
	catalogProviderFor,
	getModelOptionsForAgentProvider,
	modelLabel,
	type ModelPickerOption,
} from '@humanlayer/ui/constants/models'
import type { ProviderOption } from '@humanlayer/ui/constants/providers'

import { type AutoModeCapability, shouldDefaultToAutoMode, supportsAutoMode } from '@/lib/model-permissions'

export interface ModelSelection {
	readonly agent?: CodingAgent | null
	readonly provider?: ProviderOption | null
}

export interface ModelChoice extends ModelSelection {
	readonly model: string | null | undefined
}

export interface ModelCapabilities {
	readonly effort: EffortCapability
	readonly defaultEffort: EffortLevel | undefined
	readonly fastMode: { readonly supported: boolean }
	readonly autoMode: AutoModeCapability
}

export interface ModelRegistry {
	optionsFor(selection: ModelSelection): ReadonlyArray<ModelPickerOption>
	offers(choice: ModelChoice): boolean
	labelOf(choice: ModelChoice): string
	hostModelFor(choice: ModelChoice): string | null
	capabilitiesOf(choice: ModelChoice): ModelCapabilities
}

interface OrderedRow {
	readonly option: ModelPickerOption
	readonly fromHost: boolean
}

const modelFamily = (value: string): string => value.replace(/^claude-/, '').match(/^[a-z]+/)?.[0] ?? value

const isVersionlessAlias = (value: string): boolean => !/\d/.test(value)

const hostRowCovers = (entry: HostModelCatalogEntry, option: ModelPickerOption): boolean =>
	option.value === entry.value || option.value === entry.resolvedModel

const toHostRow = (entry: HostModelCatalogEntry, provider: ProviderOption): OrderedRow => ({
	option: { value: entry.value, label: entry.label, provider },
	fromHost: true,
})

function insertionIndexForNewFamilyMember(
	rows: ReadonlyArray<OrderedRow>,
	entry: HostModelCatalogEntry,
	previousHostRow: OrderedRow | undefined,
): number {
	// The runtime lists a family newest first, so a new row follows the host row placed before it.
	const afterPreviousHostRow = previousHostRow ? rows.indexOf(previousHostRow) + 1 : -1
	if (afterPreviousHostRow > 0) return afterPreviousHostRow
	const familyFront = rows.findIndex((row) => modelFamily(row.option.value) === modelFamily(entry.value))
	return familyFront >= 0 ? familyFront : 0
}

const supersededByVersionedHostRow =
	(familiesReportedByHost: ReadonlySet<string>) =>
	(row: OrderedRow): boolean =>
		!row.fromHost &&
		isVersionlessAlias(row.option.value) &&
		familiesReportedByHost.has(modelFamily(row.option.value))

/**
 * The runtime only lists the models it currently recommends. Slotting its rows into the bundled
 * list, rather than replacing it, keeps every version we ship launchable while surfacing new ones.
 */
export function mergeHostRowsIntoBundledOrder(
	bundled: ReadonlyArray<ModelPickerOption>,
	entries: ReadonlyArray<HostModelCatalogEntry>,
	provider: ProviderOption,
): ReadonlyArray<ModelPickerOption> {
	let rows: OrderedRow[] = bundled.map((option) => ({ option, fromHost: false }))
	let previousHostRow: OrderedRow | undefined

	for (const entry of entries) {
		const hostRow = toHostRow(entry, provider)
		const coveredIndex = rows.findIndex((row) => !row.fromHost && hostRowCovers(entry, row.option))
		if (coveredIndex >= 0) {
			rows[coveredIndex] = hostRow
			rows = rows.filter((row) => row.fromHost || !hostRowCovers(entry, row.option))
		} else {
			rows.splice(insertionIndexForNewFamilyMember(rows, entry, previousHostRow), 0, hostRow)
		}
		previousHostRow = hostRow
	}

	const familiesReportedByHost = new Set(entries.map((entry) => modelFamily(entry.value)))
	return rows.filter((row) => !supersededByVersionedHostRow(familiesReportedByHost)(row)).map((row) => row.option)
}

export function createModelRegistry(catalog: HostModelCatalog | null): ModelRegistry {
	const entryFor = (choice: ModelChoice): HostModelCatalogEntry | null =>
		findHostModelCatalogEntry(catalog, catalogProviderFor(choice), choice.model)

	const optionsFor = (selection: ModelSelection): ReadonlyArray<ModelPickerOption> => {
		const bundled = getModelOptionsForAgentProvider(selection)
		const catalogProvider = catalogProviderFor(selection)
		const hostRows = catalogProvider ? visibleHostModelCatalogEntries(catalog, catalogProvider) : null
		if (!hostRows || hostRows.length === 0 || !catalogProvider) return bundled
		return mergeHostRowsIntoBundledOrder(bundled, hostRows, catalogProvider)
	}

	return {
		optionsFor,
		offers: (choice) => optionsFor(choice).some((option) => option.value === choice.model),
		labelOf: (choice) => modelLabel(choice.model ?? '', optionsFor(choice)),
		hostModelFor: (choice) => entryFor(choice)?.value ?? null,
		capabilitiesOf: (choice) => {
			const entry = entryFor(choice)
			return {
				effort: getEffortCapability(choice.agent, choice.provider, choice.model, entry),
				defaultEffort: getDefaultEffort(choice.agent, choice.provider, choice.model, entry),
				fastMode: getFastModeCapability(choice.agent, choice.provider, choice.model, entry),
				autoMode: {
					supported: supportsAutoMode(choice.model, entry),
					defaultsToAuto: shouldDefaultToAutoMode(choice.model, entry),
				},
			}
		},
	}
}

export const BUNDLED_MODEL_REGISTRY: ModelRegistry = createModelRegistry(null)
