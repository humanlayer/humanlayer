import { resolveDaemonLaunchBuildType } from '@/components/settings/daemon-launch-command'
import { buildConfig } from '@/lib/config'

export function useDaemonCliStage() {
	return resolveDaemonLaunchBuildType({
		remoteDaemonBuildType: import.meta.env.VITE_PUBLIC_REMOTE_DAEMON_BUILD_TYPE,
		uiBuildType: import.meta.env.VITE_PUBLIC_BUILD_TYPE,
	})
}

/**
 * The daemon version this app was built to target, capped at the CLI release
 * this app shipped with. `'dev'` or empty means the build carried no daemon
 * version, which callers render as an unknown state.
 */
export function useTargetDaemonVersion(): { targetDaemonVersion: string | null } {
	const daemonVersion = buildConfig.daemonVersion
	const targetDaemonVersion = daemonVersion && daemonVersion !== 'dev' ? daemonVersion : null
	return { targetDaemonVersion }
}
