export type DaemonCredentialSource = 'stored-session' | 'explicit-token' | 'launch-token'

export interface SelfUpdateCapability {
	packageSpecifier: string
	restart: { command: string; args: string[] }
	supervisor: 'systemd' | 'shim' | 'none'
}

export interface SelfUpdateCapabilityInput {
	platform: string
	execPath: string
	env: Record<string, string | undefined>
	credentialSource: DaemonCredentialSource
	environmentFlag: string | null
	npmGlobalPrefix: string | null
	disabled: boolean
}

const NPM_INSTALL_PATH_MARKER = 'node_modules/@humanlayer/cli-'

export const SHIM_RESTART_EXIT_CODE_ENV = 'HUMANLAYER_SHIM_RESTART_EXIT_CODE'
const SUPERVISOR_RESTART_EXIT_CODE = '75'

export const CLI_PACKAGE_SPECIFIER = '@humanlayer/cli'

export const DISABLE_SELF_UPDATE_ENV = 'HUMANLAYER_DISABLE_SELF_UPDATE'

// Image-managed hosts (e.g. sandboxes) own the CLI version, so the operator can opt out of in-app updates.
export function isSelfUpdateDisabled(noSelfUpdateFlag: boolean, env: Record<string, string | undefined>): boolean {
	const value = env[DISABLE_SELF_UPDATE_ENV]?.trim().toLowerCase()
	return noSelfUpdateFlag || value === '1' || value === 'true'
}

export function resolveSelfUpdateCapability(input: SelfUpdateCapabilityInput): SelfUpdateCapability | null {
	if (input.disabled) return null
	if (input.platform === 'win32') return null
	if (!input.execPath.includes(NPM_INSTALL_PATH_MARKER)) return null
	if (input.npmGlobalPrefix === null) return null

	// A launch token expires after 24h, so a restart from the unit file or argv cannot reuse it.
	const restartsFromArgv = input.credentialSource !== 'launch-token'
	if (input.env.INVOCATION_ID && !restartsFromArgv) return null
	const supervisor = input.env.INVOCATION_ID
		? 'systemd'
		: restartsFromArgv && input.env[SHIM_RESTART_EXIT_CODE_ENV] === SUPERVISOR_RESTART_EXIT_CODE
			? 'shim'
			: 'none'

	const restartArgs = ['daemon', 'launch']
	if (input.environmentFlag !== null) restartArgs.push(input.environmentFlag)

	return {
		packageSpecifier: CLI_PACKAGE_SPECIFIER,
		restart: { command: `${input.npmGlobalPrefix}/bin/humanlayer`, args: restartArgs },
		supervisor,
	}
}
