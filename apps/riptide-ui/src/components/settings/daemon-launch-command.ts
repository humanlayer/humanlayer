import {
	getHumanLayerCliInstallCommand,
	getHumanLayerCliTarget,
	isHumanLayerCliStage,
	type HumanLayerCliStage,
} from '@humanlayer/ui/lib/humanlayer-cli'

const REMOTE_DAEMON_BUILD_TYPE_FALLBACK = 'prod'

export function resolveDaemonLaunchBuildType({
	remoteDaemonBuildType,
	uiBuildType,
}: {
	remoteDaemonBuildType?: string
	uiBuildType?: string
}): HumanLayerCliStage {
	if (isHumanLayerCliStage(remoteDaemonBuildType)) return remoteDaemonBuildType
	if (isHumanLayerCliStage(uiBuildType)) return uiBuildType
	return REMOTE_DAEMON_BUILD_TYPE_FALLBACK
}

export function buildDaemonLaunchCommand({
	remoteDaemonBuildType,
	token,
	uiBuildType,
}: {
	remoteDaemonBuildType?: string
	token: string
	uiBuildType?: string
}): string {
	const daemonBuildType = resolveDaemonLaunchBuildType({ remoteDaemonBuildType, uiBuildType })
	const isLocal = daemonBuildType === 'local'
	const target = getHumanLayerCliTarget(daemonBuildType)
	const executable = isLocal ? 'bun apps/cli/src/index.ts' : `npx ${target.packageSpecifier}`
	const commandParts = [executable, 'daemon', 'launch']

	if (target.environmentFlag) commandParts.push(target.environmentFlag)
	commandParts.push('--launch-token', token)

	const launchCommand = commandParts.join(' ')

	return isLocal ? launchCommand : `${getHumanLayerCliInstallCommand(daemonBuildType)} && ${launchCommand}`
}
