import type { Control } from 'react-hook-form'

import { describeHostState, hostAcceptsLaunch } from '@/lib/host-state'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'

import { LauncherHostStateNotice } from './LauncherHostStateNotice'
import { useLauncherSelectedHost } from './useLauncherSelectedHost'

export function LauncherHostStateNoticeWired({ control }: { control: Control<LauncherV3FormValues> }) {
	const host = useLauncherSelectedHost(control)
	if (!host) return null
	const { notice } = describeHostState({ ...host, acceptsLaunch: hostAcceptsLaunch(host) })
	if (!notice) return null
	return <LauncherHostStateNotice state={host.state} message={notice} />
}
