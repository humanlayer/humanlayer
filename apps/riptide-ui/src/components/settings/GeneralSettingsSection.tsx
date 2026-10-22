import { Button } from '@humanlayer/ui/components/button'
import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { isDefinedError } from '@orpc/client'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { Lock, LockOpen, Minus, Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { DirectorySearchInputWithFilesystem } from '@/components/DirectorySearchInputWithFilesystem'
import { EditorSelector } from '@/components/EditorSelector'
import { useSync } from '@/components/providers/SyncProvider'
import { useRecentDirectories } from '@/hooks/live-queries/useRecentDirectories'
import { type EditorType, useSettingsStore } from '@/hooks/stores/settingsStore'
import { validateDirectoryExists } from '@/integrations/desktop/filesystem'
import { DEFAULT_ZOOM_LEVEL, MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL, ZOOM_STEP } from '@/integrations/desktop/zoom'
import { isDesktop } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'

export function GeneralSettingsSection() {
	const defaultEditor = useSettingsStore((s) => s.defaultEditor)
	const setDefaultEditor = useSettingsStore((s) => s.setDefaultEditor)
	const showSessionCosts = useSettingsStore((s) => s.showSessionCosts)
	const setShowSessionCosts = useSettingsStore((s) => s.setShowSessionCosts)
	const contextWarningEnabled = useSettingsStore((s) => s.contextWarningEnabled)
	const setContextWarningEnabled = useSettingsStore((s) => s.setContextWarningEnabled)
	const notificationSoundsEnabled = useSettingsStore((s) => s.notificationSoundsEnabled)
	const setNotificationSoundsEnabled = useSettingsStore((s) => s.setNotificationSoundsEnabled)
	const notificationVolume = useSettingsStore((s) => s.notificationVolume)
	const setNotificationVolume = useSettingsStore((s) => s.setNotificationVolume)
	const diffStyle = useSettingsStore((s) => s.diffStyle)
	const setDiffStyle = useSettingsStore((s) => s.setDiffStyle)
	const zoomLevel = useSettingsStore((s) => s.zoomLevel)
	const setZoomLevel = useSettingsStore((s) => s.setZoomLevel)
	const zoomScrollLockEnabled = useSettingsStore((s) => s.zoomScrollLockEnabled)
	const setZoomScrollLockEnabled = useSettingsStore((s) => s.setZoomScrollLockEnabled)
	const streamingRenderingEnabled = useSettingsStore((s) => s.streamingRenderingEnabled)
	const setStreamingRenderingEnabled = useSettingsStore((s) => s.setStreamingRenderingEnabled)
	const preferBatchQueueDelivery = useSettingsStore((s) => s.preferBatchQueueDelivery)
	const setPreferBatchQueueDelivery = useSettingsStore((s) => s.setPreferBatchQueueDelivery)
	const defaultDirectory = useSettingsStore((s) => s.defaultDirectory)
	const setDefaultDirectory = useSettingsStore((s) => s.setDefaultDirectory)
	const applyServerSettings = useSettingsStore((s) => s.applyServerSettings)
	const markMutationInFlight = useSettingsStore((s) => s.markMutationInFlight)

	const { queryClient: api } = useRiptideApi()
	const { onlineHostsCollection } = useSync()
	const { user } = useAuth()

	const settingsHostsQuery = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => and(eq(hosts.user_id, user.id), eq(hosts.status, 'online')))
				.select(({ hosts }) => ({
					host_id: hosts.host_id,
				}))
				.orderBy(({ hosts }) => hosts.host_id, 'asc')
		},
		[onlineHostsCollection, user?.id],
	)
	const settingsHostId = settingsHostsQuery.data?.[0]?.host_id ?? null
	const recentDirectories = useRecentDirectories(settingsHostId ?? undefined, null)

	// Local state for directory input — only committed to store on blur when valid
	const [localDirectory, setLocalDirectory] = useState(defaultDirectory)

	const handleDirectoryBlur = async (path: string) => {
		if (!path.trim()) return
		const result = await validateDirectoryExists(path)
		if (result.valid) {
			setDefaultDirectory(path)
		} else {
			setLocalDirectory(defaultDirectory)
		}
	}

	const handleEditorChange = (value: EditorType) => {
		setDefaultEditor(value)
	}

	const handleSessionCostsChange = (checked: boolean) => {
		setShowSessionCosts(checked)
	}

	const updateSettingsMutation = useMutation(
		api.auth.user.settings.update.mutationOptions({
			onSuccess: (data) => {
				// Reset the guard before applying so the authoritative response is fully applied
				useSettingsStore.setState({ _lastMutationAt: 0 })
				applyServerSettings(data)
			},
			onError: (error) => {
				useSettingsStore.setState({ _lastMutationAt: 0 })
				if (isDefinedError(error) && error.code === 'FEATURE_DISABLED_BY_ORG') {
					toast.error('Feature disabled by organization')
				}
			},
		}),
	)

	const mutateUserSettings = useCallback(
		(input: Parameters<typeof updateSettingsMutation.mutate>[0]) => {
			updateSettingsMutation.mutate(input)
		},
		[updateSettingsMutation],
	)

	const handlePreferBatchQueueDeliveryToggle = (checked: boolean) => {
		setPreferBatchQueueDelivery(checked)
		markMutationInFlight()
		mutateUserSettings({ preferBatchQueueDelivery: checked })
	}

	return (
		<div className="flex flex-col gap-x-8 gap-y-8 2xl:flex-row 2xl:items-start">
			<section className="max-w-3xl space-y-4 2xl:flex-1">
				<h3 className="text-sm font-semibold">Defaults</h3>

				<div className="space-y-2">
					<Label className="text-sm font-medium">Default Editor</Label>
					<div className="flex items-center gap-4">
						<p className="text-sm text-muted-foreground">
							Set your default editor for opening session directories. Use{' '}
							<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">⌘+⇧+O</kbd> to quickly open the
							current session&apos;s directory.
						</p>

						<EditorSelector value={defaultEditor} onValueChange={handleEditorChange} />
					</div>
				</div>

				<div className="space-y-2">
					<Label className="text-sm font-medium">Default Directory</Label>
					<p className="text-sm text-muted-foreground">
						Default working directory for new tasks and one-off sessions.
					</p>
					<DirectorySearchInputWithFilesystem
						value={localDirectory}
						onChange={setLocalDirectory}
						onBlur={handleDirectoryBlur}
						recentDirectories={recentDirectories}
					/>
				</div>

				<div className="space-y-2">
					<Label className="text-sm font-medium">Batch Queue Delivery</Label>
					<div className="flex items-center justify-between gap-4">
						<p className="text-sm text-muted-foreground">
							Send all queued messages together as soon as the session is ready. Turn off to send them one
							at a time, waiting for the agent between each.
						</p>
						<Switch
							checked={preferBatchQueueDelivery}
							onCheckedChange={handlePreferBatchQueueDeliveryToggle}
						/>
					</div>
				</div>
			</section>

			<section className="max-w-3xl space-y-4 2xl:flex-1">
				<h3 className="text-sm font-semibold">Display & Interaction</h3>

				<div className="space-y-2">
					<Label className="text-sm font-medium">Show Agent Streaming</Label>
					<div className="flex items-center justify-between gap-4">
						<p className="text-sm text-muted-foreground">
							Show assistant output while it is still being generated. Turn off to only show completed
							messages.
						</p>
						<Switch checked={streamingRenderingEnabled} onCheckedChange={setStreamingRenderingEnabled} />
					</div>
				</div>

				<div className="space-y-2">
					<Label className="text-sm font-medium">Session Costs</Label>
					<div className="flex items-center justify-between gap-4">
						<p className="text-sm text-muted-foreground">
							Show session costs in the status bar next to the context gauge.
						</p>
						<Switch checked={showSessionCosts} onCheckedChange={handleSessionCostsChange} />
					</div>
				</div>

				<div className="space-y-2">
					<Label htmlFor="context-window-warning" className="text-sm font-medium">
						Context window warning
					</Label>
					<div className="flex items-center justify-between gap-4">
						<p className="text-sm text-muted-foreground">
							Warn in the status bar when a session&apos;s context window is filling up.
						</p>
						<Switch
							id="context-window-warning"
							checked={contextWarningEnabled}
							onCheckedChange={setContextWarningEnabled}
						/>
					</div>
				</div>

				<div className="space-y-2">
					<Label className="text-sm font-medium">Notification Sounds</Label>
					<div className="flex items-center justify-between gap-4">
						<p className="text-sm text-muted-foreground">
							Play a sound when a session needs your input or approval.
						</p>
						<Switch
							checked={notificationSoundsEnabled}
							onCheckedChange={(checked) => {
								setNotificationSoundsEnabled(checked)
								if (checked) {
									const audio = new Audio('/sounds/notification.mp3')
									audio.volume = notificationVolume
									audio.play().catch(() => {})
								}
							}}
						/>
					</div>
					{notificationSoundsEnabled && (
						<div className="flex items-center gap-3 pt-1">
							<span className="text-xs text-muted-foreground w-10">Volume</span>
							<input
								aria-label="Notification volume"
								type="range"
								min={0}
								max={1}
								step={0.05}
								value={notificationVolume}
								onChange={(e) => setNotificationVolume(Number.parseFloat(e.target.value))}
								onMouseUp={() => {
									const audio = new Audio('/sounds/notification.mp3')
									audio.volume = notificationVolume
									audio.play().catch(() => {})
								}}
								className="h-1 flex-1 appearance-none rounded-none bg-muted cursor-pointer accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:bg-primary"
							/>
							<span className="text-xs text-muted-foreground font-mono w-8 text-right">
								{Math.round(notificationVolume * 100)}%
							</span>
						</div>
					)}
				</div>

				<div className="space-y-2">
					<Label className="text-sm font-medium">Split Diff View</Label>
					<div className="flex items-center justify-between gap-4">
						<p className="text-sm text-muted-foreground">
							Show code diffs in a side-by-side split view instead of inline.
						</p>
						<Switch
							checked={diffStyle === 'split'}
							onCheckedChange={(checked) => setDiffStyle(checked ? 'split' : 'unified')}
						/>
					</div>
				</div>

				{isDesktop() && (
					<div className="space-y-2">
						<Label className="text-sm font-medium">Zoom Level</Label>
						<div className="flex items-center justify-between gap-4">
							<p className="text-sm text-muted-foreground">Adjust the interface zoom level.</p>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="icon"
									className="h-7 w-7"
									onClick={() =>
										setZoomLevel(
											Math.round(Math.max(zoomLevel - ZOOM_STEP, MIN_ZOOM_LEVEL) * 100) / 100,
										)
									}
									disabled={zoomLevel <= MIN_ZOOM_LEVEL}
									aria-label="Decrease zoom"
								>
									<Minus className="h-3 w-3" />
								</Button>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											className="text-sm font-mono w-12 text-center cursor-pointer hover:text-muted-foreground"
											onClick={() => setZoomLevel(DEFAULT_ZOOM_LEVEL)}
										>
											{Math.round(zoomLevel * 100)}%
										</button>
									</TooltipTrigger>
									<TooltipContent>
										<p>Reset to 100%</p>
									</TooltipContent>
								</Tooltip>
								<Button
									variant="outline"
									size="icon"
									className="h-7 w-7"
									onClick={() =>
										setZoomLevel(
											Math.round(Math.min(zoomLevel + ZOOM_STEP, MAX_ZOOM_LEVEL) * 100) / 100,
										)
									}
									disabled={zoomLevel >= MAX_ZOOM_LEVEL}
									aria-label="Increase zoom"
								>
									<Plus className="h-3 w-3" />
								</Button>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7"
											onClick={() => setZoomScrollLockEnabled(!zoomScrollLockEnabled)}
											aria-label={
												zoomScrollLockEnabled ? 'Allow scroll zoom' : 'Disable scroll-zoom'
											}
										>
											{zoomScrollLockEnabled ? (
												<Lock className="h-3 w-3" />
											) : (
												<LockOpen className="h-3 w-3" />
											)}
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p>{zoomScrollLockEnabled ? 'Allow scroll zoom' : 'Disable scroll-zoom'}</p>
									</TooltipContent>
								</Tooltip>
							</div>
						</div>
					</div>
				)}
			</section>
		</div>
	)
}
