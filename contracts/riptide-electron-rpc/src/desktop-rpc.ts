import * as RpcGroup from 'effect/rpc/RpcGroup'

import { DaemonLifecycleEvents, IsDaemonRunning, SetDaemonManagement, StartDaemon, StopDaemon } from './rpcs/daemon.js'
import { DeepLinkEvents, TakePendingDeepLink } from './rpcs/deep-links.js'
import { CheckClaudeInstalled, ProbeCodingAgent, UpdateClaudeCode, UpdateCli } from './rpcs/diagnostics.js'
import { PickDirectory } from './rpcs/directory-picker.js'
import { DragWindow } from './rpcs/drag-window.js'
import {
	BrowseDirectories,
	FuzzySearchFiles,
	GetHomeDirectory,
	ListDirectory,
	ReadFile,
	ReadTextFile,
	StatPath,
} from './rpcs/filesystem.js'
import { GetAppVersion } from './rpcs/get-app-version.js'
import { GetEditorEnvironment } from './rpcs/get-editor-environment.js'
import { GetHostId } from './rpcs/get-host-id.js'
import { GetCurrentLogFiles, GetLogDirectory, WriteHostLog } from './rpcs/host-logging.js'
import { OpenExternalUrl } from './rpcs/open-external-url.js'
import { OpenInEditor } from './rpcs/open-in-editor.js'
import { OpenNewWindow } from './rpcs/open-new-window.js'
import { AttachPty, CreatePty, DetachPty, KillPty, ListPtys, ResizePty, WritePty } from './rpcs/pty/index.js'
import { DiscoverGitRepositories } from './rpcs/repository-discovery.js'
import { SetSentryIdentity } from './rpcs/sentry-identity.js'
import { SetWindowTheme } from './rpcs/set-window-theme.js'
import { SetZoom } from './rpcs/set-zoom.js'
import { CheckForUpdate, DownloadUpdate, QuitAndInstall, UpdateDownloadProgress } from './rpcs/updater.js'
import {
	EnsureWorkspaceConfigIgnored,
	OpenWorkspaceConfig,
	ReadWorkspaceConfig,
	WriteWorkspaceConfig,
} from './rpcs/workspace-config.js'

export * from './rpcs/get-app-version.js'
export * from './rpcs/daemon.js'
export * from './rpcs/diagnostics.js'
export * from './rpcs/deep-links.js'
export * from './rpcs/directory-picker.js'
export * from './rpcs/drag-window.js'
export * from './rpcs/get-host-id.js'
export * from './rpcs/get-editor-environment.js'
export * from './rpcs/filesystem.js'
export * from './rpcs/host-logging.js'
export * from './rpcs/open-in-editor.js'
export * from './rpcs/open-external-url.js'
export * from './rpcs/open-new-window.js'
export * from './rpcs/pty/index.js'
export * from './rpcs/repository-discovery.js'
export * from './rpcs/set-zoom.js'
export * from './rpcs/set-window-theme.js'
export * from './rpcs/sentry-identity.js'
export * from './rpcs/updater.js'
export * from './rpcs/workspace-config.js'

export class DesktopRpc extends RpcGroup.make(
	GetHostId,
	OpenInEditor,
	OpenExternalUrl,
	GetAppVersion,
	SetWindowTheme,
	SetZoom,
	WriteHostLog,
	GetLogDirectory,
	GetCurrentLogFiles,
	UpdateCli,
	CheckClaudeInstalled,
	ProbeCodingAgent,
	UpdateClaudeCode,
	StartDaemon,
	StopDaemon,
	IsDaemonRunning,
	SetDaemonManagement,
	DaemonLifecycleEvents,
	OpenNewWindow,
	DragWindow,
	CreatePty,
	AttachPty,
	DetachPty,
	WritePty,
	ResizePty,
	KillPty,
	ListPtys,
	GetHomeDirectory,
	StatPath,
	ReadTextFile,
	ReadFile,
	BrowseDirectories,
	ListDirectory,
	FuzzySearchFiles,
	GetEditorEnvironment,
	ReadWorkspaceConfig,
	WriteWorkspaceConfig,
	EnsureWorkspaceConfigIgnored,
	OpenWorkspaceConfig,
	TakePendingDeepLink,
	DeepLinkEvents,
	PickDirectory,
	SetSentryIdentity,
	CheckForUpdate,
	DownloadUpdate,
	UpdateDownloadProgress,
	QuitAndInstall,
	DiscoverGitRepositories,
) {}
