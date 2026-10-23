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

/**
 * Polls user settings every 10s and writes effective/org/user settings
 * into the Zustand settings store so they are available app-wide.
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

	return <SettingsStoreSync key={`${scope ?? 'signed-out'}:${dataUpdatedAt}`} scope={scope} data={data} />
}
