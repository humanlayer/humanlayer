import { HotkeysProvider } from '@humanlayer/react-hotkeys-hook'
import { DiffStyleProvider } from '@humanlayer/ui/components/diff-style-provider'
import { ThemeProvider } from '@humanlayer/ui/components/theme-provider'
import { useLocation } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { ArtifactSharingDialogHost } from '@/components/artifact-sharing/ArtifactSharingDialogHost'
import { DaemonUpdateNoticeHandler } from '@/components/DaemonUpdateNoticeHandler'
import { DeepLinkHandler } from '@/components/DeepLinkHandler'
import { WiredDiffWorkerPoolProvider } from '@/components/diffs/WiredDiffWorkerPoolProvider'
import { FocusDebugHud } from '@/components/FocusDebugHud'
import { FocusSourceHandler } from '@/components/FocusSourceHandler'
import { GlobalHotkeys } from '@/components/GlobalHotkeys'
import { HorizontalTabsProvider } from '@/components/horizontal-tabs/HorizontalTabsProvider'
import { HotkeyScopeDebugger } from '@/components/HotkeyScopeDebugger'
import { PreloadServiceProvider } from '@/components/providers/PreloadServiceProvider'
import { SyncProvider } from '@/components/providers/SyncProvider'
import { ReadyForInputNotificationHandler } from '@/components/ReadyForInputNotificationHandler'
import { RootScopeHotkeysProvider } from '@/components/RootScopeHotkeysProvider'
import { SettingsSyncHandler } from '@/components/SettingsSyncHandler'
import { SharedArtifactProviders } from '@/components/shared-artifact/SharedArtifactProviders'
import { TaskDiffReviewMarksPruner } from '@/components/TaskDiffReviewMarksPruner'
import { UndoNotificationHandler } from '@/components/UndoNotificationHandler'
import { UnreadSessionsTracker } from '@/components/UnreadSessionsTracker'
import { UpdateCheckHandler } from '@/components/UpdateCheckHandler'
import { UpdateDetailsDialog } from '@/components/UpdateDetailsDialog'
import { WindowStateHandler } from '@/components/WindowStateHandler'
import { ZoomHandler } from '@/components/ZoomHandler'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useDaemonManager } from '@/hooks/use-daemon-manager'
import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { UpdateProvider } from '@/hooks/use-update'
import { setWindowTheme } from '@/integrations/desktop/theme'
import { PostHogHandler } from '@/integrations/posthog/PostHogHandler'
import { AuthProvider } from '@/integrations/workos/AuthProvider'
import { providerModeForPath } from '@/lib/auth-routing'

export function ProviderProvider({ children }: { children: ReactNode }) {
	const diffStyle = useSettingsStore((s) => s.diffStyle)
	const setDiffStyle = useSettingsStore((s) => s.setDiffStyle)
	const pathname = useLocation({ select: (location) => location.pathname })
	const providerMode = providerModeForPath(pathname)

	return (
		<AuthProvider>
			<ThemeProvider defaultTheme="rose-pine" storageKey="riptide-theme" onThemeChange={setWindowTheme}>
				{providerMode === 'shared' ? (
					<SharedArtifactProviders>{children}</SharedArtifactProviders>
				) : (
					<AuthenticatedProviders diffStyle={diffStyle} setDiffStyle={setDiffStyle}>
						{children}
					</AuthenticatedProviders>
				)}
			</ThemeProvider>
		</AuthProvider>
	)
}

function AuthenticatedProviders({
	children,
	diffStyle,
	setDiffStyle,
}: {
	children: ReactNode
	diffStyle: ReturnType<typeof useSettingsStore.getState>['diffStyle']
	setDiffStyle: ReturnType<typeof useSettingsStore.getState>['setDiffStyle']
}) {
	useDaemonManager()
	const minimalist = useMinimalistLayout()
	return (
		<SyncProvider>
			<HorizontalTabsProvider>
				<DeepLinkHandler />
				<PreloadServiceProvider>
					<DiffStyleProvider diffStyle={diffStyle} onDiffStyleChange={setDiffStyle}>
						<UpdateProvider>
							<HotkeysProvider initiallyActiveScopes={['*', '.']}>
								{!minimalist && <RootScopeHotkeysProvider />}
								<FocusSourceHandler />
								{!minimalist && <GlobalHotkeys />}
								{/* The minimalist UI never toasts session events; its sidebar dots and OS notifications cover them. */}
								{!minimalist && <ReadyForInputNotificationHandler />}
								<UnreadSessionsTracker />
								<TaskDiffReviewMarksPruner />
								<UndoNotificationHandler />
								<SettingsSyncHandler />
								<PostHogHandler />
								<WindowStateHandler />
								<ZoomHandler />
								{/* The minimalist frame has its own update toast, dialog and daemon notice. */}
								{!minimalist && <UpdateCheckHandler />}
								{!minimalist && <DaemonUpdateNoticeHandler />}
								{!minimalist && <UpdateDetailsDialog />}
								<ArtifactSharingDialogHost />
								<WiredDiffWorkerPoolProvider>{children}</WiredDiffWorkerPoolProvider>
								{import.meta.env.DEV ? <FocusDebugHud /> : null}
								<HotkeyScopeDebugger />
							</HotkeysProvider>
						</UpdateProvider>
					</DiffStyleProvider>
				</PreloadServiceProvider>
			</HorizontalTabsProvider>
		</SyncProvider>
	)
}
