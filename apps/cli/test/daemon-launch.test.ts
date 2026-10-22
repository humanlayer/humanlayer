import { ORPCError } from '@orpc/client'
import { describe, expect, it } from 'vitest'

import { formatDaemonLaunchError, loginCommandForEnvironment } from '../src/commands/daemon-launch'

describe('daemon launch errors', () => {
	it.each([
		['prod', 'humanlayer login'],
		['beta', 'humanlayer --beta login'],
		['dev', 'humanlayer --dev login'],
		['local', 'humanlayer --local login'],
	] as const)('shows the correct login command for %s', (environment, loginCommand) => {
		const error = new ORPCError('ORGANIZATION_REQUIRED', {
			status: 403,
			data: { message: 'Please select an organization to continue' },
		})

		expect(loginCommandForEnvironment(environment)).toBe(loginCommand)
		expect(formatDaemonLaunchError(error, environment)).toBe(
			`Could not launch daemon because the CLI is not signed in to an organization.\nRun \`${loginCommand}\`, then try again.`,
		)
	})

	it('leaves other errors unchanged', () => {
		expect(formatDaemonLaunchError(new Error('Connection failed'), 'prod')).toBe(
			'Failed to launch daemon: Connection failed',
		)
	})
})
