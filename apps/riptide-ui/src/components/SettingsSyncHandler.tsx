import type { IntegrationCapabilities } from '@humanlayer/riptide-api-contract/api/integrations/get-capabilities'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useRiptideApi } from '@/orpc/client'

type ServerSettings = Parameters<ReturnType<typeof useSettingsStore.getState>['applyServerSettings']>[0]

interface SettingsStoreSyncProps {
	scope: string | null
	data: ServerSettings | undefined
}

function SettingsStoreSync({ scope, data }: SettingsStoreSyncProps) {
	useMountEffect(() => {
		const settings = useSettingsStore.getState()
		settings.setServerSettingsScope(scope)
		if (data && scope) settings.applyServerSettings(data, scope)
	})

	return null
}

/** Writes the deployment's capabilities into the store; null (request failed) counts all as set up. */
function CapabilitiesStoreSync({ capabilities }: { capabilities: IntegrationCapabilities | null }) {
	useMountEffect(() => {
		useSettingsStore.getState().applyIntegrationCapabilities(capabilities)
	})

	return null
}

/**
 * Polls user settings every 10s and writes effective/org/user settings
 * into the Zustand settings store so they are available app-wide.
 * Also fetches which integrations this deployment has set up, once per auth scope: the server
 * fixes that answer at startup, so it never goes stale and is not retried.
 */
export function SettingsSyncHandler() {
	const { queryClient: api, authScope } = useRiptideApi()
	const { organizationId, user } = useAuth()
	const scope = user?.id && organizationId ? `${user.id}:${organizationId}` : null

	const options = api.auth.user.settings.get.queryOptions({ input: {} })
	const { data, dataUpdatedAt } = useQuery({
		...options,
		queryKey: [...options.queryKey, authScope],
		refetchInterval: 10_000,
		enabled: scope !== null,
	})

	const capabilitiesOptions = api.integrations.getCapabilities.queryOptions({
		input: {},
		context: { silent: true },
	})
	const capabilities = useQuery({
		...capabilitiesOptions,
		queryKey: [...capabilitiesOptions.queryKey, authScope],
		enabled: scope !== null,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
		retry: false,
	})

	return (
		<>
			<SettingsStoreSync key={`${scope ?? 'signed-out'}:${dataUpdatedAt}`} scope={scope} data={data} />
			{capabilities.isPending ? null : (
				<CapabilitiesStoreSync
					key={`${scope ?? 'signed-out'}:${capabilities.status}:${capabilities.dataUpdatedAt}`}
					capabilities={capabilities.data ?? null}
				/>
			)}
		</>
	)
}
