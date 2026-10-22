import { Button } from '@humanlayer/ui/components/button'
import { Github } from 'lucide-react'
import type { FC, ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { GitHubRepoSection } from './GitHubRepoSection'

export interface GitHubConnectSkeletonProps {
	repoFullName: string
	branch: string
	isAdmin: boolean
	/** Names the organization the App installs for; null when it is not known yet. */
	orgName: string | null
	onConnect: () => void
}

const Bar: FC<{ className?: string }> = ({ className }) => <span className={cn('block h-2 bg-muted', className)} />

const PlaceholderRow: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
	<div className="flex flex-col gap-1.5" data-testid="github-connect-skeleton-row">
		<span className="font-mono text-[10px] tracking-wide text-muted-foreground">{label}</span>
		{children}
	</div>
)

const PlaceholderRows: FC = () => (
	<div aria-hidden className="flex flex-col gap-2.5 px-1 pb-1 pt-2">
		<PlaceholderRow label="Status">
			<Bar className="w-[72%]" />
			<span className="flex gap-1">
				<span className="block h-3.5 w-13 border border-border" />
				<span className="block h-3.5 w-13 border border-border" />
			</span>
		</PlaceholderRow>
		<PlaceholderRow label="Checks">
			<Bar className="w-[26%]" />
			<Bar className="h-[3px] w-full" />
			<Bar className="w-[44%]" />
		</PlaceholderRow>
		<PlaceholderRow label="Review">
			<Bar className="w-[44%]" />
		</PlaceholderRow>
		<PlaceholderRow label="Merge">
			<span className="block h-6 w-full border border-border" />
		</PlaceholderRow>
	</div>
)

const finePrintFor = (orgName: string | null) =>
	orgName === null ? (
		<>Installs the HumanLayer GitHub App. Opens in your browser.</>
	) : (
		<>
			Installs the HumanLayer GitHub App for <span className="text-foreground">{orgName}</span>. Opens in your
			browser.
		</>
	)

/**
 * The GitHub tab's section for a branch the session pushed before the organization connected
 * GitHub: the real repository and branch over grey placeholders for what a pull request would
 * show, and the connect control under them. Nothing about the pull request is invented.
 */
export const GitHubConnectSkeleton: FC<GitHubConnectSkeletonProps> = ({
	repoFullName,
	branch,
	isAdmin,
	orgName,
	onConnect,
}) => (
	<GitHubRepoSection name={repoFullName} branch={branch} isCurrent failingCheckCount={0}>
		<div data-testid="github-connect-skeleton">
			<PlaceholderRows />
			<div className="px-0.5 pb-0.5 pt-1.5">
				<div
					className="flex flex-col gap-2 border border-border bg-background p-3"
					data-testid="github-connect-card"
				>
					<div className="flex items-center gap-2 text-xs font-medium text-foreground">
						<Github aria-hidden className="size-3.5 shrink-0 text-accent" />
						<span>Connect GitHub to create and manage pull requests</span>
					</div>
					{isAdmin ? (
						<>
							<Button size="xs" onClick={onConnect} className="w-full">
								Connect GitHub
							</Button>
							<p className="text-[10px] leading-snug text-muted-foreground">{finePrintFor(orgName)}</p>
						</>
					) : (
						<p className="text-[10px] leading-snug text-muted-foreground">
							Only organization admins can connect GitHub.
						</p>
					)}
				</div>
			</div>
		</div>
	</GitHubRepoSection>
)
