import { makeWorkosServiceLive } from './effects/services/workos/workos.service'
import { requireEnvironment } from './lib/environment'
import { getWorkosClientId, getWorkosRedirectUri } from './lib/workos'
import { WorkosSdkAdapterLive } from './lib/workos-service'

export const workosSdkAdapter = new WorkosSdkAdapterLive(
	requireEnvironment('WORKOS_API_KEY'),
	getWorkosClientId(),
	getWorkosRedirectUri(),
	process.env.WORKOS_WEBHOOK_SECRET,
)

export const WorkosServiceLive = makeWorkosServiceLive(workosSdkAdapter)
