import { toast } from 'sonner'

import { openExternal } from '@/lib/url-opener'
import { isTauri } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'

export type ConnectableIntegration = 'linear' | 'jira' | 'github'

export type ConnectIntegrationOutcome = 'already-connected' | 'started' | 'failed'

const INTEGRATION_NAMES: Record<ConnectableIntegration, string> = {
	linear: 'Linear',
	jira: 'Jira',
	github: 'GitHub',
}

/**
 * Start the OAuth/install flow for a ticket integration from any launch
 * surface. Linear and Jira first re-check the server settings so a stale
 * local store does not restart OAuth for an already connected provider.
 */
export function useConnectIntegrationAction() {
	const { client } = useRiptideApi()

	return async (provider: ConnectableIntegration): Promise<ConnectIntegrationOutcome> => {
		try {
			if (provider === 'linear' || provider === 'jira') {
				const latest = await client.auth.user.settings.get({}, { context: { silent: true } })
				const needsReauth =
					provider === 'linear' ? latest.linearNeedsReauth === true : latest.jiraNeedsReauth === true
				if (latest.effective[`${provider}Enabled`] && !needsReauth) return 'already-connected'
			}
			const returnClient = isTauri() ? 'native' : 'ui'
			const { url } =
				provider === 'linear'
					? await client.integrations.linear.createInstallUrl({ client: returnClient })
					: provider === 'jira'
						? await client.integrations.jira.createInstallUrl({ client: returnClient })
						: await client.integrations.github.createInstallUrl({})
			await openExternal(url)
			return 'started'
		} catch {
			toast.error(`Unable to start the ${INTEGRATION_NAMES[provider]} connection. Open settings to try again.`)
			return 'failed'
		}
	}
}
