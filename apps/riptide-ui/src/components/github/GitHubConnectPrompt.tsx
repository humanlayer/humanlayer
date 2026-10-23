import { Button } from '@humanlayer/ui/components/button'
import { ExternalLink, Github } from 'lucide-react'
import type { FC } from 'react'

/**
 * `disabled`: the organization turned the integration off; `not_connected`: no GitHub App
 * installation is active; `repositories_without_app`: the installation is active but covers none of
 * the repositories the scope works in.
 */
export type GitHubConnectReason = 'disabled' | 'not_connected' | 'repositories_without_app'

export interface GitHubConnectPromptProps {
	reason: GitHubConnectReason
	isAdmin: boolean
	/** Undefined when the build has no cloud origin; onOpenExternal then says so. */
	settingsUrl: string | undefined
	/** The repositories the reason is about; listed under the description when there are any. */
	repositories?: readonly string[]
	onOpenExternal: (event: React.MouseEvent) => void
	onAction: () => void
}

interface GitHubConnectCopy {
	readonly title: string
	/** Used in place of `title` once more than one repository is named. */
	readonly titlePlural?: string
	/** Null where the title, the repositories and the button already say it. */
	readonly admin: string | null
	readonly member: string
	readonly action: string | null
	/** False where the button is already the way to settings. */
	readonly settingsLink: boolean
}

const COPY: Record<GitHubConnectReason, GitHubConnectCopy> = {
	not_connected: {
		title: 'Connect GitHub to create and manage pull requests',
		admin: 'Installs the HumanLayer GitHub App. Opens in your browser.',
		member: 'Only organization admins can connect GitHub.',
		action: 'Connect GitHub',
		settingsLink: true,
	},
	disabled: {
		title: 'GitHub is not connected for this organization',
		admin: 'Turn the GitHub integration on in settings to see pull requests and their checks here.',
		member: 'Ask your admin to turn the GitHub integration on in settings to see pull requests and their checks here.',
		action: null,
		settingsLink: true,
	},
	repositories_without_app: {
		title: 'HumanLayer was not granted access to this repository',
		titlePlural: 'HumanLayer was not granted access to these repositories',
		admin: 'Grant the GitHub App access to see pull requests here.',
		member: 'Ask an admin to grant the GitHub App access to see pull requests here.',
		action: 'Open settings',
		settingsLink: false,
	},
}

export const GitHubConnectPrompt: FC<GitHubConnectPromptProps> = ({
	reason,
	isAdmin,
	settingsUrl,
	repositories,
	onOpenExternal,
	onAction,
}) => {
	const copy = COPY[reason]
	const title = copy.titlePlural && (repositories?.length ?? 0) > 1 ? copy.titlePlural : copy.title
	const description = isAdmin ? copy.admin : copy.member
	return (
		<div className="p-2" data-testid="github-connect-prompt">
			<div className="rounded-lg border border-dashed border-muted-foreground/25 px-4 py-3">
				<div className="flex items-start gap-3">
					<div className="mt-0.5 rounded-md bg-muted p-2">
						<Github className="size-4 text-muted-foreground" />
					</div>
					<div className="flex-1 space-y-1.5">
						<p className="text-sm font-medium">{title}</p>
						{description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
						{repositories && repositories.length > 0 ? (
							<ul className="space-y-0.5 pt-0.5" data-testid="github-prompt-repositories">
								{repositories.map((repository) => (
									<li key={repository} className="truncate font-mono text-xs text-foreground">
										{repository}
									</li>
								))}
							</ul>
						) : null}
						{isAdmin ? (
							<div className="flex flex-wrap items-center gap-3 pt-1">
								{copy.action ? (
									<Button size="xs" variant="outline" onClick={onAction}>
										{copy.action}
									</Button>
								) : null}
								{copy.settingsLink ? (
									<a
										href={settingsUrl}
										onClick={onOpenExternal}
										className="inline-flex items-center gap-1 text-xs text-accent transition-colors hover:text-accent/80"
									>
										Open settings
										<ExternalLink className="size-3" />
									</a>
								) : null}
							</div>
						) : null}
					</div>
				</div>
			</div>
		</div>
	)
}
