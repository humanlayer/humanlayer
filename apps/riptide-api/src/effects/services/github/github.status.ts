import type { GitHubStatus } from '@humanlayer/riptide-api-contract/api/integrations/github/get-status'

import type { GitHubStatusInput } from './github.persistence'

/**
 * `enabled` is false both before the first installation is claimed and after an admin switches an
 * existing one off; only the second is `disabled`. An organization with nothing installed is
 * `not_connected` whatever the switch says.
 */
export const deriveGitHubStatus = ({ enabled, connections }: GitHubStatusInput): GitHubStatus => {
	if (connections.length === 0) return 'not_connected'
	if (!enabled) return 'disabled'
	return connections.some((connection) => connection.status === 'active') ? 'connected' : 'not_connected'
}
