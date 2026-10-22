import type { UpdateInfo } from '@humanlayer/riptide-electron-rpc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, use, useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { checkForUpdate, downloadUpdate, installAndRelaunch } from '@/integrations/desktop/updater'
import { captureException } from '@/integrations/sentry/sentry'
import { buildConfig } from '@/lib/config'
import { logger } from '@/lib/logger'
import { isDesktop } from '@/lib/utils'

type AvailableUpdate = {
	version: string
	body: string
	currentVersion: string
	urgency: 'normal' | 'critical'
	rawJson: Record<string, unknown>
	changelogUrl: string | null
}

function mapUpdateInfoToAvailableUpdate(info: UpdateInfo): AvailableUpdate {
	return {
		version: info.version,
		body: info.notes,
		currentVersion: buildConfig.version,
		urgency: info.urgency,
		rawJson: info.rawJson,
		changelogUrl: 'https://docs.humanlayer.com/release-notes',
	}
}

interface UpdateContextValue {
	update: AvailableUpdate | null
	isChecking: boolean
	isDownloading: boolean
	lastCheckedAt: Date | null
	urgency: 'normal' | 'critical'
	changelogUrl: string | null
	checkNow: () => Promise<void>
	startUpdate: () => Promise<void>
	updateModalOpen: boolean
	setUpdateModalOpen: (open: boolean) => void
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

const UPDATE_CHECK_QUERY_KEY = ['desktop-update-check'] as const
const UPDATE_INSTALL_MUTATION_KEY = ['desktop-update-install'] as const
const CHECK_INTERVAL_MS = 5 * 60_000

export function UpdateProvider({ children }: { children: ReactNode }) {
	const [updateModalOpen, setUpdateModalOpen] = useState(false)
	const autoUpdateEnabled = useSettingsStore((s) => s.autoUpdateEnabled)
	const queryClient = useQueryClient()
	const installUpdate = useMutation({
		mutationKey: UPDATE_INSTALL_MUTATION_KEY,
		mutationFn: async () => {
			await downloadUpdate((event) => {
				logger.debug('Update progress', { event })
			})
			await installAndRelaunch()
		},
		networkMode: 'always',
		onError: (error) => {
			const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
			logger.error('Update failed', { error })
			captureException(error instanceof Error ? error : new Error(message), {
				tags: { action: 'installUpdate' },
			})
			toast.error(`Update failed: ${message}`)
		},
	})
	const updateCheck = useQuery({
		queryKey: UPDATE_CHECK_QUERY_KEY,
		queryFn: async () => {
			try {
				const result = await checkForUpdate()
				return result ? mapUpdateInfoToAvailableUpdate(result) : null
			} catch (error) {
				logger.error('Update check failed', { error })
				captureException(error instanceof Error ? error : new Error(String(error)), {
					tags: { action: 'checkForUpdate' },
				})
				throw error
			}
		},
		enabled: isDesktop() && autoUpdateEnabled && !installUpdate.isPending,
		refetchInterval: CHECK_INTERVAL_MS,
		refetchIntervalInBackground: true,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: false,
		networkMode: 'always',
	})
	const update = updateCheck.data ?? null
	const lastCheckedTimestamp = Math.max(updateCheck.dataUpdatedAt, updateCheck.errorUpdatedAt)
	const lastCheckedAt = lastCheckedTimestamp > 0 ? new Date(lastCheckedTimestamp) : null

	const { refetch: refetchUpdateCheck } = updateCheck
	const checkNow = useCallback(async () => {
		// Manual checks work with auto-update disabled, but must not interrupt
		// installation or cancel an automatic check already in flight.
		const isInstalling = queryClient.isMutating({ mutationKey: UPDATE_INSTALL_MUTATION_KEY }) > 0
		if (isInstalling) return
		await refetchUpdateCheck({ cancelRefetch: false })
	}, [queryClient, refetchUpdateCheck])

	const startUpdate = useCallback(async () => {
		if (!update || installUpdate.isPending) return
		await installUpdate.mutateAsync()
	}, [installUpdate, update])

	const value = useMemo<UpdateContextValue>(
		() => ({
			update,
			isChecking: updateCheck.isFetching,
			isDownloading: installUpdate.isPending,
			lastCheckedAt,
			urgency: update?.urgency ?? 'normal',
			changelogUrl: update?.changelogUrl ?? null,
			checkNow,
			startUpdate,
			updateModalOpen,
			setUpdateModalOpen,
		}),
		[
			update,
			updateCheck.isFetching,
			installUpdate.isPending,
			lastCheckedAt,
			checkNow,
			startUpdate,
			updateModalOpen,
		],
	)

	return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
}

export function useUpdate(): UpdateContextValue {
	const ctx = use(UpdateContext)
	if (!ctx) throw new Error('useUpdate must be used within UpdateProvider')
	return ctx
}
