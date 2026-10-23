import { ExternalLink, ShieldCheck } from 'lucide-react'
import type { FC } from 'react'

export interface GitHubPermissionPromptProps {
	isAdmin: boolean
	/** Undefined when the build has no cloud origin; onOpenExternal then says so. */
	settingsUrl: string | undefined
	onOpenExternal: (event: React.MouseEvent) => void
}

export const GitHubPermissionPrompt: FC<GitHubPermissionPromptProps> = ({ isAdmin, settingsUrl, onOpenExternal }) => (
	<div className="p-2" data-testid="github-permission-prompt">
		<div className="rounded-lg border border-dashed border-muted-foreground/25 px-4 py-3">
			<div className="flex items-start gap-3">
				<div className="mt-0.5 rounded-md bg-muted p-2">
					<ShieldCheck className="size-4 text-muted-foreground" />
				</div>
				<div className="flex-1 space-y-1.5">
					<p className="text-sm font-medium">GitHub needs the Checks permission</p>
					<p className="text-xs text-muted-foreground">
						{isAdmin
							? 'The HumanLayer GitHub App was installed with insufficient scopes - re-install the app to allow access to PR check statuses.'
							: 'Ask your admin to reinstall the github integration to approve the new scopes.'}
					</p>
					{isAdmin ? (
						<a
							href={settingsUrl}
							onClick={onOpenExternal}
							className="inline-flex items-center gap-1 pt-0.5 text-xs text-accent transition-colors hover:text-accent/80"
						>
							Open settings
							<ExternalLink className="size-3" />
						</a>
					) : null}
				</div>
			</div>
		</div>
	</div>
)
