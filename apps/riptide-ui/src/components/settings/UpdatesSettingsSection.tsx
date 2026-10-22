import { Button } from '@humanlayer/ui/components/button'
import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'

import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useUpdate } from '@/hooks/use-update'
import { useAppVersion } from '@/hooks/useAppVersion'
import { buildConfig } from '@/lib/config'

export function UpdatesSettingsSection() {
	const { update, isChecking, isDownloading, lastCheckedAt, checkNow, setUpdateModalOpen } = useUpdate()
	const appVersion = useAppVersion()
	const autoUpdateEnabled = useSettingsStore((s) => s.autoUpdateEnabled)
	const setAutoUpdateEnabled = useSettingsStore((s) => s.setAutoUpdateEnabled)

	return (
		<div className="space-y-6">
			{import.meta.env.DEV && (
				<section>
					<div className="space-y-2">
						<Label className="text-sm font-medium">Auto-Update (Dev)</Label>
						<div className="flex items-center justify-between gap-4">
							<p className="text-sm text-muted-foreground">
								Enable auto-update checking. Disable to suppress update polling errors during local
								development.
							</p>
							<Switch checked={autoUpdateEnabled} onCheckedChange={setAutoUpdateEnabled} />
						</div>
					</div>
				</section>
			)}
			{/* Current Version Info */}
			<section>
				<h3 className="text-sm font-semibold mb-2 text-muted-foreground">Current Version</h3>
				<div className="bg-muted/50 rounded-md p-3 font-mono text-xs space-y-1">
					{appVersion && (
						<div className="flex justify-between">
							<span className="text-muted-foreground">native:</span>
							<span className="text-foreground">{appVersion}</span>
						</div>
					)}
					<div className="flex justify-between">
						<span className="text-muted-foreground">build:</span>
						<span className="text-foreground">{buildConfig.version}</span>
					</div>
					<div className="flex justify-between">
						<span className="text-muted-foreground">channel:</span>
						<span className="text-foreground">{buildConfig.channelName}</span>
					</div>
					<div className="flex justify-between">
						<span className="text-muted-foreground">environment:</span>
						<span className="text-foreground">{buildConfig.sentryEnvironment}</span>
					</div>
				</div>
			</section>

			{/* Check for Updates */}
			<section>
				<div className="flex items-center justify-between gap-4">
					<div>
						<h3 className="text-sm font-semibold text-muted-foreground">Check for Updates</h3>
						{lastCheckedAt && (
							<p className="text-xs text-muted-foreground mt-1">
								Last checked: {lastCheckedAt.toLocaleTimeString()}
							</p>
						)}
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => checkNow()}
						disabled={isChecking || isDownloading}
					>
						{isChecking ? (
							<>
								<SyncGridAnimation variant="snake" size="xs" speed={120} className="mr-2" />
								Checking…
							</>
						) : (
							'Check for Updates'
						)}
					</Button>
				</div>
			</section>

			{/* Update Available */}
			{update ? (
				<section>
					<h3 className="text-sm font-semibold mb-2 text-muted-foreground">Update Available</h3>
					<div className="border border-[var(--terminal-success)]/30 bg-[var(--terminal-success)]/5 rounded-md p-3 space-y-3">
						<div className="flex items-center gap-4 font-mono text-sm">
							<span className="text-muted-foreground">{update.currentVersion}</span>
							<span className="text-[var(--terminal-success)]">→ v{update.version}</span>
						</div>
						{update.body.trim() && <MarkdownRenderer content={update.body} />}
						<Button
							variant="loud-success-cta"
							size="sm"
							onClick={() => setUpdateModalOpen(true)}
							disabled={isDownloading}
						>
							{isDownloading ? (
								<>
									<SyncGridAnimation variant="snake" size="xs" speed={120} className="mr-2" />
									Installing…
								</>
							) : (
								'Review Update & Restart'
							)}
						</Button>
					</div>
				</section>
			) : lastCheckedAt ? (
				<section>
					<div className="bg-muted/50 rounded-md p-3 text-sm text-muted-foreground">
						You&apos;re up to date! Running version {buildConfig.version}.
					</div>
				</section>
			) : null}

			{/* Raw Server Response */}
			{update && (
				<details className="text-left w-full">
					<summary className="cursor-pointer font-mono text-sm text-muted-foreground hover:text-foreground transition-colors">
						Raw Server Response
					</summary>
					<div className="mt-2">
						<pre className="font-mono text-xs whitespace-pre-wrap bg-muted/50 rounded-md p-4 break-words overflow-auto max-h-64">
							{JSON.stringify(update.rawJson, null, 2)}
						</pre>
					</div>
				</details>
			)}
		</div>
	)
}
