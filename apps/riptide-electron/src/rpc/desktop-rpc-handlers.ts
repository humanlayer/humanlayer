import { DesktopRpc } from '@humanlayer/riptide-electron-rpc'
import type * as Layer from 'effect/Layer'

import { attachPtyHandler } from './handlers/attach-pty'
import { checkClaudeInstalledHandler } from './handlers/check-claude-installed'
import { checkForUpdateHandler } from './handlers/check-for-update'
import { createPtyHandler } from './handlers/create-pty'
import { daemonLifecycleEventsHandler } from './handlers/daemon-lifecycle-events'
import { deepLinkEventsHandler, takePendingDeepLinkHandler } from './handlers/deep-links'
import { detachPtyHandler } from './handlers/detach-pty'
import { downloadUpdateHandler } from './handlers/download-update'
import {
	browseDirectoriesHandler,
	fuzzySearchFilesHandler,
	getHomeDirectoryHandler,
	listDirectoryHandler,
	readFileHandler,
	readTextFileHandler,
	statPathHandler,
} from './handlers/filesystem'
import { getAppVersionHandler } from './handlers/get-app-version'
import { getCurrentLogFilesHandler } from './handlers/get-current-log-files'
import { getEditorEnvironmentHandler } from './handlers/get-editor-environment'
import { getHostIdHandler } from './handlers/get-host-id'
import { getLogDirectoryHandler } from './handlers/get-log-directory'
import { isDaemonRunningHandler } from './handlers/is-daemon-running'
import { killPtyHandler } from './handlers/kill-pty'
import { listPtysHandler } from './handlers/list-ptys'
import { openExternalUrlHandler } from './handlers/open-external-url'
import { openInEditorHandler } from './handlers/open-in-editor'
import { openNewWindowHandler } from './handlers/open-new-window'
import { pickDirectoryHandler } from './handlers/pick-directory'
import { probeCodingAgentHandler } from './handlers/probe-coding-agent'
import { quitAndInstallHandler } from './handlers/quit-and-install'
import { discoverGitRepositoriesHandler } from './handlers/repository-discovery'
import { resizePtyHandler } from './handlers/resize-pty'
import { setDaemonManagementHandler } from './handlers/set-daemon-management'
import { setSentryIdentityHandler } from './handlers/set-sentry-identity'
import { setWindowThemeHandler } from './handlers/set-window-theme'
import { setZoomHandler } from './handlers/set-zoom'
import { startDaemonHandler } from './handlers/start-daemon'
import { stopDaemonHandler } from './handlers/stop-daemon'
import { updateClaudeCodeHandler } from './handlers/update-claude-code'
import { updateCliHandler } from './handlers/update-cli'
import { updateDownloadProgressHandler } from './handlers/update-download-progress'
import {
	ensureWorkspaceConfigIgnoredHandler,
	openWorkspaceConfigHandler,
	readWorkspaceConfigHandler,
	writeWorkspaceConfigHandler,
} from './handlers/workspace-config'
import { writeHostLogHandler } from './handlers/write-host-log'
import { writePtyHandler } from './handlers/write-pty'

// DragWindow is bound separately by the transport once the requester window exists.
export const DesktopRpcHandlers = DesktopRpc.omit('DragWindow').toLayer({
	GetHostId: getHostIdHandler,
	OpenInEditor: openInEditorHandler,
	OpenExternalUrl: openExternalUrlHandler,
	GetAppVersion: getAppVersionHandler,
	SetWindowTheme: setWindowThemeHandler,
	SetZoom: setZoomHandler,
	WriteHostLog: writeHostLogHandler,
	GetLogDirectory: getLogDirectoryHandler,
	GetCurrentLogFiles: getCurrentLogFilesHandler,
	UpdateCli: updateCliHandler,
	CheckClaudeInstalled: checkClaudeInstalledHandler,
	ProbeCodingAgent: probeCodingAgentHandler,
	UpdateClaudeCode: updateClaudeCodeHandler,
	StartDaemon: startDaemonHandler,
	StopDaemon: stopDaemonHandler,
	IsDaemonRunning: isDaemonRunningHandler,
	SetDaemonManagement: setDaemonManagementHandler,
	DaemonLifecycleEvents: daemonLifecycleEventsHandler,
	OpenNewWindow: openNewWindowHandler,
	CreatePty: createPtyHandler,
	AttachPty: attachPtyHandler,
	DetachPty: detachPtyHandler,
	WritePty: writePtyHandler,
	ResizePty: resizePtyHandler,
	KillPty: killPtyHandler,
	ListPtys: listPtysHandler,
	GetHomeDirectory: getHomeDirectoryHandler,
	StatPath: statPathHandler,
	ReadTextFile: readTextFileHandler,
	ReadFile: readFileHandler,
	BrowseDirectories: browseDirectoriesHandler,
	ListDirectory: listDirectoryHandler,
	FuzzySearchFiles: fuzzySearchFilesHandler,
	GetEditorEnvironment: getEditorEnvironmentHandler,
	ReadWorkspaceConfig: readWorkspaceConfigHandler,
	WriteWorkspaceConfig: writeWorkspaceConfigHandler,
	EnsureWorkspaceConfigIgnored: ensureWorkspaceConfigIgnoredHandler,
	OpenWorkspaceConfig: openWorkspaceConfigHandler,
	TakePendingDeepLink: takePendingDeepLinkHandler,
	DeepLinkEvents: deepLinkEventsHandler,
	SetSentryIdentity: setSentryIdentityHandler,
	CheckForUpdate: checkForUpdateHandler,
	DownloadUpdate: downloadUpdateHandler,
	UpdateDownloadProgress: updateDownloadProgressHandler,
	QuitAndInstall: quitAndInstallHandler,
	DiscoverGitRepositories: discoverGitRepositoriesHandler,
	PickDirectory: pickDirectoryHandler,
})

export type DesktopRpcHandlerServices = Layer.Success<typeof DesktopRpcHandlers>
