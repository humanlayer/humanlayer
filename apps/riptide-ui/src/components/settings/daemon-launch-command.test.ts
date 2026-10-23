import { describe, expect, test } from 'vitest'

import { buildDaemonLaunchCommand, resolveDaemonLaunchBuildType } from './daemon-launch-command'

describe('resolveDaemonLaunchBuildType', () => {
	test('prefers the explicit remote daemon build type over the UI build type', () => {
		expect(resolveDaemonLaunchBuildType({ remoteDaemonBuildType: 'beta', uiBuildType: 'prod' })).toBe('beta')
	})

	test('falls back to the UI build type when the remote daemon build type is missing', () => {
		expect(resolveDaemonLaunchBuildType({ remoteDaemonBuildType: undefined, uiBuildType: 'prod' })).toBe('prod')
	})

	test('falls back to production when both build types are missing', () => {
		expect(resolveDaemonLaunchBuildType({ remoteDaemonBuildType: undefined, uiBuildType: undefined })).toBe('prod')
	})

	test('ignores unsupported build types', () => {
		expect(resolveDaemonLaunchBuildType({ remoteDaemonBuildType: 'preview', uiBuildType: 'beta' })).toBe('beta')
	})
})

describe('buildDaemonLaunchCommand', () => {
	test('omits the environment flag for explicit production daemon launch tokens', () => {
		expect(buildDaemonLaunchCommand({ remoteDaemonBuildType: 'prod', token: 'tok_prod' })).toBe(
			'npm install -g @humanlayer/cli@latest && npx @humanlayer/cli@latest daemon launch --launch-token tok_prod',
		)
	})

	test('omits the environment flag for production UI builds missing the remote daemon build type', () => {
		expect(
			buildDaemonLaunchCommand({ remoteDaemonBuildType: undefined, uiBuildType: 'prod', token: 'tok_prod' }),
		).toBe(
			'npm install -g @humanlayer/cli@latest && npx @humanlayer/cli@latest daemon launch --launch-token tok_prod',
		)
	})

	test.each([
		[
			'beta',
			'npm install -g @humanlayer/cli@beta && npx @humanlayer/cli@beta daemon launch --beta --launch-token tok',
		],
		['dev', 'npm install -g @humanlayer/cli@dev && npx @humanlayer/cli@dev daemon launch --dev --launch-token tok'],
		['local', 'bun apps/cli/src/index.ts daemon launch --local --launch-token tok'],
	] as const)('includes the expected flag for %s daemon launch tokens', (remoteDaemonBuildType, expected) => {
		expect(buildDaemonLaunchCommand({ remoteDaemonBuildType, token: 'tok' })).toBe(expected)
	})
})
