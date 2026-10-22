import { useNavigate } from '@tanstack/react-router'
import { Download } from 'lucide-react'

import { useOutdatedHosts } from '@/hooks/live-queries/use-outdated-hosts'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useUpdate } from '@/hooks/use-update'
import { useMountEffect } from '@/hooks/useMountEffect'
import { buildConfig } from '@/lib/config'
import { useUi } from '@/minimalist/lib/ui-state'

import { UpdateDialog } from './UpdateDialog'

// The frame remounts when you pass through a standard page; announce each version once.
const announced = new Set<string>()

function UpdateToast({ version, critical }: { version: string; critical: boolean }) {
	const { setUpdateModalOpen } = useUpdate()
	const { showToast } = useUi()
	useMountEffect(() => {
		if (announced.has(version)) return
		announced.add(version)
		if (critical) setUpdateModalOpen(true)
		else
			showToast(`HumanLayer ${version} is ready to install`, {
				label: 'View',
				run: () => setUpdateModalOpen(true),
			})
	})
	return null
}

function DaemonNotice({ count }: { count: number }) {
	const navigate = useNavigate()
	const { showToast } = useUi()
	useMountEffect(() => {
		useSettingsStore.getState().setLastNoticedAppVersion(buildConfig.version)
		showToast(
			count === 1
				? '1 daemon runs an older version than this app'
				: `${count} daemons run an older version than this app`,
			{ label: 'View', run: () => void navigate({ to: '/settings/daemons' }) },
		)
	})
	return null
}

/** App and daemon update notices for the minimalist frame: one toast each, and the update dialog. */
export function WiredUpdateNotices() {
	const { update, urgency, updateModalOpen } = useUpdate()
	const noticed = useSettingsStore((state) => state.lastNoticedAppVersion === buildConfig.version)
	const { outdatedHosts, isReady } = useOutdatedHosts()
	return (
		<>
			{update ? (
				<UpdateToast key={update.version} version={update.version} critical={urgency === 'critical'} />
			) : null}
			{update && updateModalOpen ? <UpdateDialog /> : null}
			{!noticed && isReady && outdatedHosts.length > 0 ? <DaemonNotice count={outdatedHosts.length} /> : null}
		</>
	)
}

/** A sidebar footer line while an app update waits, so it outlasts the toast. */
export function UpdateLine() {
	const { update, setUpdateModalOpen } = useUpdate()
	if (!update) return null
	return (
		<button type="button" className="sync-line update-line" onClick={() => setUpdateModalOpen(true)}>
			<Download className="i sm" strokeWidth={1.6} />
			Update to {update.version}
		</button>
	)
}
