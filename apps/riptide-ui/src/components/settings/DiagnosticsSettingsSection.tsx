import { Button } from '@humanlayer/ui/components/button'
import { Switch } from '@humanlayer/ui/components/switch'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import { Option, Schema } from 'effect'
import { Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { useDiagnosticStore } from '@/hooks/stores/diagnosticStore'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { checkClaudeInstalled, updateClaudeCode } from '@/integrations/desktop/diagnostics'
import { fetchLatestClaudeVersion } from '@/integrations/tauri/claude-diagnostics'
import { isDesktop } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'

const CLAUDE_INSTALL_CMD = 'curl -fsSL https://claude.ai/install.sh | bash'
const BREW_REMEDIATION_CMD = `brew uninstall claude-code 2>/dev/null; ${CLAUDE_INSTALL_CMD}`
const NPM_REMEDIATION_CMD = `npm uninstall -g @anthropic-ai/claude-code 2>/dev/null; ${CLAUDE_INSTALL_CMD}`
const BUN_REMEDIATION_CMD = `bun remove -g @anthropic-ai/claude-code 2>/dev/null; ${CLAUDE_INSTALL_CMD}`

const REMEDIATION_INSTALLATION_SOURCES = ['homebrew', 'npm', 'bun'] as const
const RemediationInstallationSource = Schema.Literals(REMEDIATION_INSTALLATION_SOURCES)

const REMEDIATION_CMDS: Record<(typeof REMEDIATION_INSTALLATION_SOURCES)[number], string> = {
	homebrew: BREW_REMEDIATION_CMD,
	npm: NPM_REMEDIATION_CMD,
	bun: BUN_REMEDIATION_CMD,
}

const ENV_VARS = {
	VITE_PUBLIC_BUILD_VERSION: import.meta.env.VITE_PUBLIC_BUILD_VERSION,
	VITE_PUBLIC_RIPTIDE_API_ORIGIN: import.meta.env.VITE_PUBLIC_RIPTIDE_API_ORIGIN,
	VITE_PUBLIC_WORKOS_CLIENT_ID: import.meta.env.VITE_PUBLIC_WORKOS_CLIENT_ID,
	VITE_PUBLIC_SYNC_ORIGIN: import.meta.env.VITE_PUBLIC_SYNC_ORIGIN,
	VITE_PUBLIC_BILLING_ENFORCEMENT_ENABLED: import.meta.env.VITE_PUBLIC_BILLING_ENFORCEMENT_ENABLED,
	DEV: import.meta.env.DEV,
	MODE: import.meta.env.MODE,
	PROD: import.meta.env.PROD,
	BASE_URL: import.meta.env.BASE_URL,
}

export function DiagnosticsSettingsSection() {
	const { queryClient: api } = useRiptideApi()

	// Fetch user info for diagnostics
	const {
		data: userInfoData,
		isLoading: userInfoIsLoading,
		error: userInfoError,
	} = useQuery(api.auth.user.info.queryOptions())

	const networkStatus = useNetworkStatus()
	const [, copyToClipboard] = useCopyToClipboard()
	const artifactSidePanelTraceEnabled = useDiagnosticStore((state) => state.artifactSidePanelTraceEnabled)
	const setArtifactSidePanelTraceEnabled = useDiagnosticStore((state) => state.setArtifactSidePanelTraceEnabled)
	let userInfoContent: ReactNode = <p className="text-muted-foreground">No data</p>
	if (userInfoIsLoading) userInfoContent = <p className="text-muted-foreground">Loading…</p>
	else if (userInfoError) userInfoContent = <p className="text-destructive">Error: {userInfoError.message}</p>
	else if (userInfoData) {
		userInfoContent = (
			<>
				<div className="flex justify-between">
					<span className="text-muted-foreground">userId:</span>
					<span className="text-foreground">{userInfoData.userId}</span>
				</div>
				<div className="flex justify-between">
					<span className="text-muted-foreground">workosOrganizationId:</span>
					<span className="text-foreground">{userInfoData.workosOrganizationId}</span>
				</div>
				<div className="flex justify-between">
					<span className="text-muted-foreground">organizationId:</span>
					<span className="text-foreground">{userInfoData.organizationId}</span>
				</div>
			</>
		)
	}

	const isNative = isDesktop()
	const {
		data: diagnosticsData,
		error: diagnosticsErrorRaw,
		isError: diagnosticsIsError,
		isFetching: diagnosticsIsFetching,
		refetch: refetchDiagnostics,
	} = useQuery({
		queryKey: ['claude-diagnostics'],
		queryFn: async () => {
			const [result, latestVersion] = await Promise.all([
				checkClaudeInstalled(),
				fetchLatestClaudeVersion().catch(() => null),
			])
			return { result, latestVersion }
		},
		enabled: false,
		retry: false,
		networkMode: 'always',
	})
	const updateClaudeMutation = useMutation({
		mutationFn: updateClaudeCode,
		networkMode: 'always',
		onSuccess: () => {
			toast.success('Claude Code successfully updated')
			// Refresh the diagnostics so the displayed installed version reflects the update.
			void refetchDiagnostics()
		},
		onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
	})
	const diagnosticsResult = diagnosticsIsError ? null : (diagnosticsData?.result ?? null)
	const latestVersion = diagnosticsIsError ? null : (diagnosticsData?.latestVersion ?? null)
	const diagnosticsError = diagnosticsErrorRaw
		? diagnosticsErrorRaw instanceof Error
			? diagnosticsErrorRaw.message
			: String(diagnosticsErrorRaw)
		: null
	const remediationInstallationSource = Option.getOrUndefined(
		Schema.decodeUnknownOption(RemediationInstallationSource)(diagnosticsResult?.installation_source),
	)
	const remediationCmd =
		remediationInstallationSource === undefined ? undefined : REMEDIATION_CMDS[remediationInstallationSource]

	const handleRunDiagnostics = () => {
		// Clear a previous update's success state so the button re-enables
		// if the fresh diagnostics still show an outdated version.
		updateClaudeMutation.reset()
		void refetchDiagnostics()
	}

	return (
		<div className="space-y-6">
			<section>
				<h3 className="text-sm font-semibold mb-2 text-muted-foreground">Artifact Viewer</h3>
				<div className="bg-muted/50 rounded-md p-3">
					<div className="flex items-center justify-between gap-4">
						<p className="text-sm font-medium">Artifact side-panel tracing</p>
						<Switch
							checked={artifactSidePanelTraceEnabled}
							onCheckedChange={setArtifactSidePanelTraceEnabled}
							aria-label="Artifact side-panel tracing"
						/>
					</div>
				</div>
			</section>
			{/* Claude Code Section */}
			<section>
				<h3 className="text-sm font-semibold mb-2 text-muted-foreground">Claude Code</h3>
				<div className="bg-muted/50 rounded-md p-3 space-y-3">
					{!isNative ? (
						<p className="font-mono text-xs text-muted-foreground">
							Claude Code diagnostics require the native app.
						</p>
					) : (
						<>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={handleRunDiagnostics}
									disabled={diagnosticsIsFetching}
								>
									{diagnosticsIsFetching ? (
										<SyncGridAnimation variant="snake" size="sm" speed={120} className="mr-2" />
									) : null}
									Run Diagnostics
								</Button>

								{diagnosticsResult &&
									diagnosticsResult.installation_source === 'native' &&
									latestVersion &&
									diagnosticsResult.version.split(' ')[0] !== latestVersion && (
										<Button
											variant="outline"
											size="sm"
											onClick={() => updateClaudeMutation.mutate()}
											disabled={updateClaudeMutation.isPending || updateClaudeMutation.isSuccess}
										>
											{updateClaudeMutation.isPending ? (
												<SyncGridAnimation
													variant="snake"
													size="sm"
													speed={120}
													className="mr-2"
												/>
											) : null}
											Update Claude Code
										</Button>
									)}
							</div>

							{diagnosticsResult && (
								<div className="font-mono text-xs space-y-1">
									<div className="flex justify-between">
										<span className="text-muted-foreground">path:</span>
										<span className="text-foreground truncate ml-4" title={diagnosticsResult.path}>
											{diagnosticsResult.path}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted-foreground">installed version:</span>
										<span className="text-foreground">
											{diagnosticsResult.version.split(' ')[0]}
										</span>
									</div>
									{latestVersion && diagnosticsResult.version.split(' ')[0] !== latestVersion && (
										<div className="flex justify-between">
											<span className="text-muted-foreground">latest version:</span>
											<span className="text-foreground">{latestVersion}</span>
										</div>
									)}
									<div className="flex justify-between">
										<span className="text-muted-foreground">install method:</span>
										<span className="text-foreground">{diagnosticsResult.installation_source}</span>
									</div>
								</div>
							)}

							{diagnosticsResult &&
								!diagnosticsResult.is_recommended &&
								(remediationCmd ? (
									<div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-2 text-xs">
										<p className="font-medium text-yellow-600 dark:text-yellow-400">
											Using the native installer is recommended by Anthropic
										</p>
										<p className="text-muted-foreground mt-1">
											Run the following to (1) uninstall the{' '}
											{diagnosticsResult.installation_source} version and (2) reinstall via the
											native installer:
										</p>
										<div className="relative group mt-1 rounded bg-muted px-2 py-1 font-mono break-all">
											{remediationCmd}
											<Button
												variant="ghost"
												size="icon"
												className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
												onClick={() => {
													void copyToClipboard(remediationCmd)
													toast.success('Copied to clipboard')
												}}
												aria-label="Copy command to clipboard"
											>
												<Copy className="h-3 w-3" />
											</Button>
										</div>
									</div>
								) : (
									<div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-2 text-xs">
										<p className="font-medium text-yellow-600 dark:text-yellow-400">
											Non-recommended installation detected
										</p>
										<p className="text-muted-foreground mt-1">
											Claude Code was installed via {diagnosticsResult.installation_source} (
											{diagnosticsResult.path}). For automatic updates and best compatibility,
											reinstall using the native installer from
											https://code.claude.com/docs/en/overview
										</p>
									</div>
								))}

							{diagnosticsError && (
								<p className="font-mono text-xs text-destructive">{diagnosticsError}</p>
							)}
						</>
					)}
				</div>
			</section>

			{/* User Info Section */}
			<section>
				<h3 className="text-sm font-semibold mb-2 text-muted-foreground">User Info</h3>
				<div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">{userInfoContent}</div>
			</section>

			{/* Environment Variables Section */}
			<section>
				<h3 className="text-sm font-semibold mb-2 text-muted-foreground">Environment Variables</h3>
				<div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">
					{Object.entries(ENV_VARS).map(([key, value]) => (
						<div key={key} className="flex justify-between gap-4">
							<span className="text-muted-foreground shrink-0">{key}:</span>
							<span className="text-foreground truncate" title={String(value ?? 'undefined')}>
								{value === undefined ? (
									<span className="text-muted-foreground/50">undefined</span>
								) : value === '' ? (
									<span className="text-muted-foreground/50">(empty)</span>
								) : (
									String(value)
								)}
							</span>
						</div>
					))}
				</div>
			</section>

			{/* Log Paths Section - placeholder for future */}
			<section>
				<h3 className="text-sm font-semibold mb-2 text-muted-foreground">Log Paths</h3>
				<div className="bg-muted/50 rounded-md p-3 font-mono text-xs">
					<p className="text-muted-foreground">
						Log path information will be available when connected to daemon.
					</p>
				</div>
			</section>

			{/* Network Section */}
			<section>
				<h3 className="text-sm font-semibold mb-2 text-muted-foreground">Network</h3>
				<div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">
					<div className="flex justify-between">
						<span className="text-muted-foreground">status:</span>
						<span className={networkStatus === 'online' ? 'text-green-500' : 'text-destructive'}>
							{networkStatus}
						</span>
					</div>
				</div>
			</section>
		</div>
	)
}
