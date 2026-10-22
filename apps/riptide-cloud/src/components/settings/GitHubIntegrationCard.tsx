import { Alert, AlertDescription, AlertTitle } from '@humanlayer/ui/components/alert'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { Label } from '@humanlayer/ui/components/label'
import { Separator } from '@humanlayer/ui/components/separator'
import { Switch } from '@humanlayer/ui/components/switch'
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, Link2, Loader2, Plus, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import type { GitHubCallbackResult } from '@/lib/settings-search'

export type { GitHubCallbackResult } from '@/lib/settings-search'

/** Product docs setup guide for GitHub, matching the Jira/Linear/Slack "Setup guide" links. */
const GITHUB_INTEGRATION_DOCS_URL = 'https://docs.humanlayer.com/guide/github-integration'

const PAYOFFS = [
	{ title: 'Live checks', body: 'Send failing checks to the agent.' },
	{ title: 'Review and merge', body: 'Threads, changes requested, merge, draft, close' },
	{ title: 'Tasks from issues', body: 'Start a task from an issue; artifacts link back.' },
] as const

export interface GitHubIntegrationCardProps {
	/** True when at least one installation is connected; drives the connected vs. disconnected layout. */
	readonly connected: boolean
	readonly enabled: boolean
	readonly loading?: boolean
	readonly installLinkPending?: boolean
	readonly callbackResult?: GitHubCallbackResult
	readonly defaultConsentOpen?: boolean
	readonly onContinueInstall: () => void
	readonly onCopyInstallLink: () => void
	readonly onEnabledChange: (enabled: boolean) => void
	/** Connection rows (Wired leaves in production, Pure `GitHubConnectionRow` leaves in stories). */
	readonly children?: ReactNode
}

const callbackMessage = (result: GitHubCallbackResult) => {
	switch (result) {
		case 'connected':
			return {
				title: 'GitHub connected',
				description: 'The installed repositories are ready to use.',
				tone: 'success',
			}
		case 'unclaimed':
			return {
				title: 'Action required',
				description:
					'GitHub did not return the organization claim. Ask a HumanLayer admin to generate a new install link.',
				tone: 'warning',
			}
		case 'invalid_link':
			return {
				title: 'Install link expired',
				description: 'Generate a new single-use install link and try again.',
				tone: 'warning',
			}
		case 'conflict':
			return {
				title: 'Installation already connected',
				description: 'This GitHub installation belongs to another HumanLayer organization.',
				tone: 'warning',
			}
		case 'unavailable':
			return {
				title: 'GitHub connection unavailable',
				description: 'Nothing was connected. Please try again.',
				tone: 'warning',
			}
	}
}

/**
 * Pure GitHub settings card. Renders the organization enablement switch, the disconnected →
 * consent → connected connect journey, and a collection of installation rows supplied through
 * `children`. Every installation is managed independently by its own row leaf; the card owns only
 * the collection-level connect/add-another/consent surface.
 */
export function GitHubIntegrationCard({
	connected,
	enabled,
	loading = false,
	installLinkPending = false,
	callbackResult,
	defaultConsentOpen = false,
	onContinueInstall,
	onCopyInstallLink,
	onEnabledChange,
	children,
}: GitHubIntegrationCardProps) {
	const [consentOpen, setConsentOpen] = useState(defaultConsentOpen)
	const callback = callbackResult ? callbackMessage(callbackResult) : undefined

	return (
		<div className="space-y-4" aria-busy={loading || installLinkPending}>
			<div className="space-y-1">
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-2">
						<Label className="text-sm font-medium">GitHub</Label>
						{connected && (
							<Badge className="gap-1">
								<CheckCircle2 className="size-3" aria-hidden="true" /> Connected
							</Badge>
						)}
					</div>
					<Button variant="link" className="h-auto p-0 text-sm" asChild>
						<a href={GITHUB_INTEGRATION_DOCS_URL} target="_blank" rel="noreferrer">
							Setup guide
							<ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
						</a>
					</Button>
				</div>
				<p className="text-sm text-muted-foreground">
					{connected
						? 'Import issues from repositories selected during installation.'
						: 'The agent can read and act on your pull requests, with live updates in the session.'}
				</p>
			</div>

			{callback && (
				<Alert variant={callback.tone === 'warning' ? 'destructive' : 'default'}>
					{callback.tone === 'warning' ? <AlertTriangle /> : <CheckCircle2 />}
					<AlertTitle>{callback.title}</AlertTitle>
					<AlertDescription>{callback.description}</AlertDescription>
				</Alert>
			)}

			{loading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading GitHub connection…
				</div>
			) : connected ? (
				<div className="space-y-4">
					<div className="flex items-center justify-between gap-4">
						<div className="space-y-1">
							<Label htmlFor="github-integration-enabled" className="text-sm">
								Enable GitHub Integration
							</Label>
							<p className="text-sm text-muted-foreground">
								Allow users to create tasks from GitHub issues.
							</p>
						</div>
						<Switch id="github-integration-enabled" checked={enabled} onCheckedChange={onEnabledChange} />
					</div>
					<Separator />
					<div className="space-y-3">{children}</div>
					<Button variant="outline" size="sm" onClick={() => setConsentOpen(true)}>
						<Plus className="mr-2 size-4" /> Add another installation
					</Button>
				</div>
			) : (
				<div className="space-y-4">
					<ul className="grid gap-2 sm:grid-cols-3">
						{PAYOFFS.map((payoff) => (
							<li key={payoff.title} className="space-y-1 border p-3 text-xs text-muted-foreground">
								<Check className="size-3.5 text-[var(--terminal-success)]" aria-hidden="true" />
								<p className="font-medium text-foreground">{payoff.title}</p>
								<p>{payoff.body}</p>
							</li>
						))}
					</ul>
					<div className="flex flex-wrap items-center gap-3">
						<Button variant="outline" onClick={() => setConsentOpen(true)}>
							<Link2 className="mr-2 size-4" /> Connect GitHub
						</Button>
						<span className="text-xs text-muted-foreground">
							installs the HumanLayer GitHub App · you choose the repositories
						</span>
					</div>
				</div>
			)}

			<Dialog open={consentOpen} onOpenChange={setConsentOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Connect a GitHub installation</DialogTitle>
						<DialogDescription>
							GitHub will ask an administrator to choose repositories and approve these app permissions.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3 py-2 text-sm">
						<div className="flex gap-3 rounded-md border p-3">
							<ShieldCheck className="mt-0.5 size-4 shrink-0" />
							<div>
								<p className="font-medium">Repository contents</p>
								<p className="text-muted-foreground">
									Clone repositories and prepare future worktree changes.
								</p>
							</div>
						</div>
						<div className="flex gap-3 rounded-md border p-3">
							<ShieldCheck className="mt-0.5 size-4 shrink-0" />
							<div>
								<p className="font-medium">Issues and pull requests</p>
								<p className="text-muted-foreground">
									Read ticket context and add HumanLayer links in later workflows.
								</p>
							</div>
						</div>
						<p className="text-xs text-muted-foreground">
							The install link is single-use and expires after seven days. Copy it when a different person
							administers GitHub.
						</p>
					</div>
					<DialogFooter className="sm:justify-between">
						<Button variant="outline" disabled={installLinkPending} onClick={onCopyInstallLink}>
							{installLinkPending ? (
								<Loader2 className="mr-2 size-4 animate-spin" />
							) : (
								<Copy className="mr-2 size-4" />
							)}
							Copy handoff link
						</Button>
						<Button disabled={installLinkPending} onClick={onContinueInstall}>
							Continue to GitHub <ExternalLink className="ml-2 size-4" />
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
