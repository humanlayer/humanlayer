import type { ArtifactDeliveryMode } from '@humanlayer/ui/artifact-viewer-v2'
import { useLocalStorage } from '@uidotdev/usehooks'

export const ARTIFACT_DELIVERY_MODE_KEY = 'riptide-artifact-v2-delivery-mode'

export function useDeliveryPreference(): [ArtifactDeliveryMode, (mode: ArtifactDeliveryMode) => void] {
	const [storedMode, setStoredMode] = useLocalStorage<ArtifactDeliveryMode>(
		ARTIFACT_DELIVERY_MODE_KEY,
		'send-and-resolve',
	)
	const mode: ArtifactDeliveryMode = storedMode === 'send' ? 'send' : 'send-and-resolve'
	return [mode, setStoredMode]
}
