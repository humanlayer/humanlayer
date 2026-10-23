import { describe, expect, it } from 'vitest'

import {
	isSelfUpdateDisabled,
	resolveSelfUpdateCapability,
	type SelfUpdateCapabilityInput,
} from '../src/commands/self-update-capability'

const npmInstallExecPath = '/usr/lib/node_modules/@humanlayer/cli-linux-x64/bin/humanlayer'

const input = (overrides: Partial<SelfUpdateCapabilityInput> = {}): SelfUpdateCapabilityInput => ({
	platform: 'linux',
	execPath: npmInstallExecPath,
	env: {},
	credentialSource: 'stored-session',
	environmentFlag: null,
	npmGlobalPrefix: '/usr',
	disabled: false,
	...overrides,
})

describe('resolveSelfUpdateCapability', () => {
	it('describes an npm install without a supervisor', () => {
		expect(resolveSelfUpdateCapability(input())).toEqual({
			packageSpecifier: '@humanlayer/cli',
			restart: { command: '/usr/bin/humanlayer', args: ['daemon', 'launch'] },
			supervisor: 'none',
		})
	})

	it('appends the environment flag to the restart arguments', () => {
		expect(resolveSelfUpdateCapability(input({ environmentFlag: '--beta' }))?.restart.args).toEqual([
			'daemon',
			'launch',
			'--beta',
		])
	})

	it('reports systemd when the process was started by a unit', () => {
		expect(resolveSelfUpdateCapability(input({ env: { INVOCATION_ID: 'abc' } }))?.supervisor).toBe('systemd')
	})

	it.each(['stored-session', 'explicit-token'] as const)(
		'allows a systemd restart with a %s credential',
		(credentialSource) => {
			expect(
				resolveSelfUpdateCapability(input({ env: { INVOCATION_ID: 'abc' }, credentialSource })),
			).not.toBeNull()
		},
	)

	it('refuses a systemd restart with a launch token', () => {
		expect(
			resolveSelfUpdateCapability(input({ env: { INVOCATION_ID: 'abc' }, credentialSource: 'launch-token' })),
		).toBeNull()
	})

	it('reports the shim when bin/humanlayer restarts the daemon on exit 75', () => {
		expect(
			resolveSelfUpdateCapability(input({ env: { HUMANLAYER_SHIM_RESTART_EXIT_CODE: '75' } }))?.supervisor,
		).toBe('shim')
	})

	it('ignores a shim that restarts on another exit code', () => {
		expect(
			resolveSelfUpdateCapability(input({ env: { HUMANLAYER_SHIM_RESTART_EXIT_CODE: '1' } }))?.supervisor,
		).toBe('none')
	})

	it('prefers systemd over the shim', () => {
		expect(
			resolveSelfUpdateCapability(
				input({ env: { INVOCATION_ID: 'abc', HUMANLAYER_SHIM_RESTART_EXIT_CODE: '75' } }),
			)?.supervisor,
		).toBe('systemd')
	})

	it('respawns a launch-token daemon itself even under the shim', () => {
		expect(
			resolveSelfUpdateCapability(
				input({ env: { HUMANLAYER_SHIM_RESTART_EXIT_CODE: '75' }, credentialSource: 'launch-token' }),
			)?.supervisor,
		).toBe('none')
	})

	it('allows a launch-token daemon to respawn itself without a supervisor', () => {
		expect(resolveSelfUpdateCapability(input({ credentialSource: 'launch-token' }))).not.toBeNull()
	})

	it('refuses Windows', () => {
		expect(resolveSelfUpdateCapability(input({ platform: 'win32' }))).toBeNull()
	})

	it('refuses an install that is not from npm', () => {
		expect(resolveSelfUpdateCapability(input({ execPath: '/opt/homebrew/bin/humanlayer' }))).toBeNull()
	})

	it('refuses when the npm global prefix is unknown', () => {
		expect(resolveSelfUpdateCapability(input({ npmGlobalPrefix: null }))).toBeNull()
	})

	it('refuses when the operator turned self-update off', () => {
		expect(resolveSelfUpdateCapability(input({ disabled: true }))).toBeNull()
	})
})

describe('isSelfUpdateDisabled', () => {
	it('is off by default', () => {
		expect(isSelfUpdateDisabled(false, {})).toBe(false)
	})

	it('honors the --no-self-update flag', () => {
		expect(isSelfUpdateDisabled(true, {})).toBe(true)
	})

	it.each(['1', 'true', 'TRUE', ' 1 '])('honors HUMANLAYER_DISABLE_SELF_UPDATE=%j', (value) => {
		expect(isSelfUpdateDisabled(false, { HUMANLAYER_DISABLE_SELF_UPDATE: value })).toBe(true)
	})

	it.each(['', '0', 'false', 'no'])('ignores HUMANLAYER_DISABLE_SELF_UPDATE=%j', (value) => {
		expect(isSelfUpdateDisabled(false, { HUMANLAYER_DISABLE_SELF_UPDATE: value })).toBe(false)
	})
})
