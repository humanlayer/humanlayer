import { WorkOS } from '@workos-inc/node'

import { requireEnvironment } from './utils'

// Export environment variables for use in handlers
export const workosApiKey = requireEnvironment('WORKOS_API_KEY')
export const workosClientId = requireEnvironment('WORKOS_CLIENT_ID')
export const workosRedirectUri = requireEnvironment('WORKOS_REDIRECT_URI')

// Create and export singleton WorkOS client
export const workos = new WorkOS(workosApiKey)

// Export JWKS URL for the cache
export const jwksUrl = workos.userManagement.getJwksUrl(workosClientId)
