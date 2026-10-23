import type { ExperimentFlagName } from '@humanlayer/db/tables/user-settings'
import { Button } from '@humanlayer/ui/components/button'
import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { isDefinedError } from '@orpc/client'
import { useMutation } from '@tanstack/react-query'
import { type ReactNode, useCallback } from 'react'
import { toast } from 'sonner'

import { MinimalistUiSetting } from '@/components/settings/MinimalistUiSetting'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { openCloudUrl } from '@/lib/url-opener'
import { useRiptideApi } from '@/orpc/client'
import { getOrgSettingsUrl } from '@/utils/artifact-links'

/**
 * One settings row: label and description on the left, the control on the
 * right (stacked on narrow viewports). `children` is the control; omit it for
 * informational rows.
 */
function SettingRow({
	htmlFor,
	label,
	description,
	children,
}: {
	htmlFor?: string
	label: string
	description: ReactNode
	children?: ReactNode
}) {
	return (
		<div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
			<div className="min-w-0 space-y-1">
				<Label htmlFor={htmlFor} className="text-sm font-medium">
					{label}
				</Label>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			{children && <div className="flex items-center sm:shrink-0">{children}</div>}
		</div>
	)
}

function SectionHeading({ children }: { children: ReactNode }) {
	return (
		<h2 className="border-b pb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
			{children}
		</h2>
	)
}

export function ExperimentsSettingsSection() {
	const experimentalSubagentsEnabled = useSettingsStore((s) => s.experimentalSubagentsEnabled)
	const setExperimentalSubagentsEnabled = useSettingsStore((s) => s.setExperimentalSubagentsEnabled)
	const haikuResearchSubagentsEnabled = useSettingsStore((s) => s.haikuResearchSubagentsEnabled)
	const setHaikuResearchSubagentsEnabled = useSettingsStore((s) => s.setHaikuResearchSubagentsEnabled)
	const daemonDrivenWorkspaceSetupEnabled = useSettingsStore((s) => s.daemonDrivenWorkspaceSetupEnabled)
	const diffViewerEnabled = useSettingsStore((s) => s.diffViewerEnabled)
	const scratchPadEnabled = useSettingsStore((s) => s.scratchPadEnabled)
	const githubPrPanelEnabled = useSettingsStore((s) => s.githubPrPanelEnabled)
	const roundedCornersEnabled = useSettingsStore((s) => s.roundedCornersEnabled)
	const useFoldCodingAgent = useSettingsStore((s) => s.useFoldCodingAgent)
	const thinkingVerbsDisabled = useSettingsStore((s) => s.thinkingVerbsDisabled)
	const agentCommandDiscoveryEnabled = useSettingsStore((s) => s.agentCommandDiscoveryEnabled)
	const claudeInAppSignInEnabled = useSettingsStore((s) => s.claudeInAppSignInEnabled)
	const codexInAppSignInEnabled = useSettingsStore((s) => s.codexInAppSignInEnabled)
	const hostStatsEnabled = useSettingsStore((s) => s.hostStatsEnabled)
	const projectsV2Enabled = useSettingsStore((s) => s.projectsV2Enabled)
	const setProjectsV2Enabled = useSettingsStore((s) => s.setProjectsV2Enabled)
	const orgSettings = useSettingsStore((s) => s.orgSettings)
	const applyServerSettings = useSettingsStore((s) => s.applyServerSettings)
	const markMutationInFlight = useSettingsStore((s) => s.markMutationInFlight)

	const { queryClient: api } = useRiptideApi()
	const { roles } = useBrowserAuth()

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

	const handleSubagentsToggle = (checked: boolean) => {
		setExperimentalSubagentsEnabled(checked)
		markMutationInFlight()
		mutateUserSettings({ experimentalSubagentsEnabled: checked })
	}

	const handleHaikuResearchSubagentsToggle = (checked: boolean) => {
		setHaikuResearchSubagentsEnabled(checked)
		markMutationInFlight()
		mutateUserSettings({ haikuResearchSubagentsEnabled: checked })
	}

	// Projects V2 only turns on. The server ignores `false`, and the switch locks once checked.
	const handleProjectsV2Toggle = (checked: boolean) => {
		if (!checked) return
		setProjectsV2Enabled(true)
		markMutationInFlight()
		mutateUserSettings({ projectsV2Enabled: true })
	}

	const handleExperimentToggle = (flag: ExperimentFlagName) => (checked: boolean) => {
		useSettingsStore.setState({ [flag]: checked })
		markMutationInFlight()
		mutateUserSettings({ experiments: { [flag]: checked } })
	}

	return (
		<div className="max-w-3xl space-y-6">
			{roles?.includes('admin') && (
				<SettingRow label="Organization Settings" description="Open riptide-cloud to see Organization Settings">
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="outline" size="sm" onClick={() => openCloudUrl(getOrgSettingsUrl())}>
									Settings
								</Button>
							</TooltipTrigger>
							<TooltipContent>Opens browser window to {getOrgSettingsUrl()}</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</SettingRow>
			)}
			<SectionHeading>GA</SectionHeading>
			<SettingRow
				label="HumanLayer Library Researcher"
				description="HumanLayer-managed context-efficient dependency & library search tool that delegates to a cloud-based agentic workflow."
			>
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<div>
								<Switch
									checked={experimentalSubagentsEnabled}
									onCheckedChange={handleSubagentsToggle}
									disabled={
										!orgSettings.experimentalSubagentsEnabled || updateSettingsMutation.isPending
									}
								/>
							</div>
						</TooltipTrigger>
						{!orgSettings.experimentalSubagentsEnabled && (
							<TooltipContent>Your organization has disabled this feature</TooltipContent>
						)}
					</Tooltip>
				</TooltipProvider>
			</SettingRow>

			<SettingRow
				label="Faster Research Subagents"
				description="Use a faster, lighter model (Haiku) for research subagents (codebase-analyzer, codebase-locator, codebase-pattern-finder). May reduce cost and latency for research tasks."
			>
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<div>
								<Switch
									checked={haikuResearchSubagentsEnabled}
									onCheckedChange={handleHaikuResearchSubagentsToggle}
									disabled={
										!orgSettings.haikuResearchSubagentsEnabled || updateSettingsMutation.isPending
									}
								/>
							</div>
						</TooltipTrigger>
						{!orgSettings.haikuResearchSubagentsEnabled && (
							<TooltipContent>Your organization has disabled this feature</TooltipContent>
						)}
					</Tooltip>
				</TooltipProvider>
			</SettingRow>

			<SettingRow
				label="Daemon-Driven Workspace Setup"
				description="Run repository setup in the daemon after task creation instead of running it from the task form."
			>
				<Switch
					checked={daemonDrivenWorkspaceSetupEnabled}
					onCheckedChange={handleExperimentToggle('daemonDrivenWorkspaceSetupEnabled')}
				/>
			</SettingRow>

			<SettingRow
				label="Collaborative Diff Viewer"
				description='Collaborative diff viewer for tasks that use the "Now" choice for "Worktrees" on the "New Task" page.'
			>
				<Switch checked={diffViewerEnabled} onCheckedChange={handleExperimentToggle('diffViewerEnabled')} />
			</SettingRow>

			<SettingRow
				label="Discovered slash commands"
				description="List the slash commands and skills the agent offers on the selected host in the composer menu. When off, the menu shows the built-in list."
			>
				<Switch
					checked={agentCommandDiscoveryEnabled}
					onCheckedChange={handleExperimentToggle('agentCommandDiscoveryEnabled')}
				/>
			</SettingRow>

			<SectionHeading>Beta</SectionHeading>

			<SettingRow
				label="Disable Thinking Verbs"
				description='Show a plain "Thinking" in the session loader instead of the rotating verb list.'
			>
				<Switch
					checked={thinkingVerbsDisabled}
					onCheckedChange={handleExperimentToggle('thinkingVerbsDisabled')}
				/>
			</SettingRow>

			<SectionHeading>Alpha</SectionHeading>
			<MinimalistUiSetting />
			<SettingRow
				htmlFor="projects-v2-enabled"
				label="Projects and workspaces"
				description="Use projects and workspaces to organize your tasks. Once on, it can't be turned off in this organization."
			>
				<Switch
					id="projects-v2-enabled"
					checked={projectsV2Enabled}
					onCheckedChange={handleProjectsV2Toggle}
					disabled={projectsV2Enabled || updateSettingsMutation.isPending}
				/>
			</SettingRow>
			<SettingRow
				label="Local Scratch Pad"
				description="Show a task-scoped notes tab in task and session sidebars. Notes stay on this device."
			>
				<Switch checked={scratchPadEnabled} onCheckedChange={handleExperimentToggle('scratchPadEnabled')} />
			</SettingRow>
			<SettingRow
				htmlFor="github-pr-panel-enabled"
				label="GitHub PR Panel"
				description="Show a GitHub tab in the session sidebar with the pull request for the branch."
			>
				<Switch
					id="github-pr-panel-enabled"
					checked={githubPrPanelEnabled}
					onCheckedChange={handleExperimentToggle('githubPrPanelEnabled')}
				/>
			</SettingRow>
			<SettingRow
				label="Use Fold Coding Agent"
				description="Run newly created Codex sessions with Fold instead of CodeLayer. Existing sessions keep their backend."
			>
				<Switch checked={useFoldCodingAgent} onCheckedChange={handleExperimentToggle('useFoldCodingAgent')} />
			</SettingRow>
			<SettingRow
				htmlFor="claude-in-app-sign-in-enabled"
				label="Claude sign-in from the app"
				description="Sign in to Claude from the app instead of the terminal."
			>
				<Switch
					id="claude-in-app-sign-in-enabled"
					checked={claudeInAppSignInEnabled}
					onCheckedChange={handleExperimentToggle('claudeInAppSignInEnabled')}
				/>
			</SettingRow>
			<SettingRow
				htmlFor="codex-in-app-sign-in-enabled"
				label="Codex sign-in from the app"
				description="Sign in to Codex from the app instead of the terminal."
			>
				<Switch
					id="codex-in-app-sign-in-enabled"
					checked={codexInAppSignInEnabled}
					onCheckedChange={handleExperimentToggle('codexInAppSignInEnabled')}
				/>
			</SettingRow>
			<SettingRow
				htmlFor="host-stats-enabled"
				label="Host load"
				description="Show cpu, memory, load, disk and the busiest processes for each host in the host picker, the session header and Hosts settings."
			>
				<Switch
					id="host-stats-enabled"
					checked={hostStatsEnabled}
					onCheckedChange={handleExperimentToggle('hostStatsEnabled')}
				/>
			</SettingRow>
			<SettingRow label="Rounded Corners" description="Use a small border radius throughout the app.">
				<Switch
					checked={roundedCornersEnabled}
					onCheckedChange={handleExperimentToggle('roundedCornersEnabled')}
				/>
			</SettingRow>
		</div>
	)
}
