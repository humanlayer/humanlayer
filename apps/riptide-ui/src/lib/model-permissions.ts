import type { HostModelCatalogEntry } from '@humanlayer/schemas/zod/model-catalog'
import type { PermissionsMode } from '@humanlayer/ui/constants/permission-modes'

export type ModelPermissionsChange = {
	nextPermissionsMode: PermissionsMode
	changed: boolean
}

export interface AutoModeCapability {
	readonly supported: boolean
	/** The host's recommended model promotes a fresh launch from default to auto mode. */
	readonly defaultsToAuto: boolean
}

export function shouldDefaultToAutoMode(
	model: string | null | undefined,
	catalogEntry?: HostModelCatalogEntry | null,
): boolean {
	if (catalogEntry) return catalogEntry.isDefault && catalogEntry.supportsAutoMode
	return model === 'claude-opus-4-8'
}

export function supportsAutoMode(
	model: string | null | undefined,
	catalogEntry?: HostModelCatalogEntry | null,
): boolean {
	if (catalogEntry) return catalogEntry.supportsAutoMode
	return (
		model === 'opus' ||
		model === 'claude-opus-5-5' ||
		model === 'claude-opus-5' ||
		model === 'claude-opus-4-8' ||
		model === 'claude-opus-4-7' ||
		model === 'claude-opus-4-6' ||
		model === 'claude-opus-4-6-1m'
	)
}

export function resolvePermissionsModeForSelectedModel(input: {
	model: string | null | undefined
	currentPermissionsMode: PermissionsMode
	/** From the host's registry when one is in scope; the bundled rules apply otherwise. */
	autoMode?: AutoModeCapability
}): ModelPermissionsChange {
	if (input.currentPermissionsMode === 'bypass') {
		return { nextPermissionsMode: 'bypass', changed: false }
	}
	const autoMode = input.autoMode ?? {
		supported: supportsAutoMode(input.model),
		defaultsToAuto: shouldDefaultToAutoMode(input.model),
	}

	if (autoMode.defaultsToAuto) {
		const shouldEnableAuto =
			input.currentPermissionsMode === 'default' || input.currentPermissionsMode === 'accept_edits'

		return {
			nextPermissionsMode: shouldEnableAuto ? 'auto' : input.currentPermissionsMode,
			changed: shouldEnableAuto,
		}
	}

	// If the selected model does not support auto mode, repair auto back to default.
	if (input.currentPermissionsMode === 'auto' && !autoMode.supported) {
		return { nextPermissionsMode: 'default', changed: true }
	}

	return { nextPermissionsMode: input.currentPermissionsMode, changed: false }
}
