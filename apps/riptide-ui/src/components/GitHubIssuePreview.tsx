import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { cn } from '@humanlayer/ui/lib/utils'
import { ChevronDown, ExternalLink, GitPullRequestClosed, MessageSquare, UserRound } from 'lucide-react'
import { useState } from 'react'

import { MarkdownRenderer } from '@/components/MarkdownRenderer'

export type GitHubIssuePreviewData = RiptideApiOutputs['integrations']['github']['getIssuePreview']

export interface GitHubIssuePreviewProps {
	readonly preview: GitHubIssuePreviewData
}

export function GitHubIssuePreview({ preview }: GitHubIssuePreviewProps) {
	const [expanded, setExpanded] = useState(false)

	return (
		<article className="overflow-hidden rounded-xl border bg-card shadow-sm">
			<div className="border-b px-4 py-3">
				<div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
					<div className="flex min-w-0 items-center gap-2">
						<Badge
							variant={preview.state === 'open' ? 'default' : 'secondary'}
							className="shrink-0 capitalize"
						>
							{preview.state}
						</Badge>
						<span className="truncate font-mono">
							{preview.repository.fullName}#{preview.issueNumber}
						</span>
					</div>
					<span className="flex shrink-0 items-center gap-1">
						<MessageSquare className="size-3" />
						{preview.comments.length} comments
					</span>
				</div>
				<div className="flex items-center gap-2">
					<a
						href={preview.url}
						target="_blank"
						rel="noreferrer"
						className="group flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold hover:underline"
						title={preview.title}
					>
						<span className="truncate">{preview.title}</span>
						<ExternalLink className="size-3.5 shrink-0 opacity-50 group-hover:opacity-100" />
					</a>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => setExpanded((value) => !value)}
						aria-expanded={expanded}
						aria-label={expanded ? 'Hide issue details' : 'Show issue details'}
						className="size-7 shrink-0"
					>
						<ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
					</Button>
				</div>
			</div>
			{expanded && (
				<div className="space-y-3 px-4 py-3">
					<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
						{preview.authorLogin && (
							<span className="flex items-center gap-1">
								<UserRound className="size-3" />
								{preview.authorLogin}
							</span>
						)}
						{preview.assignees.length > 0 && (
							<span className="flex items-center gap-1">
								<GitPullRequestClosed className="size-3" />
								{preview.assignees.join(', ')}
							</span>
						)}
					</div>
					{preview.labels.length > 0 && (
						<div className="flex flex-wrap gap-1">
							{preview.labels.map((label) => (
								<Badge key={label} variant="outline">
									{label}
								</Badge>
							))}
						</div>
					)}
					{preview.body ? (
						<div className="max-h-64 overflow-y-auto text-sm">
							<MarkdownRenderer content={preview.body} />
						</div>
					) : (
						<p className="text-xs text-muted-foreground">No issue description.</p>
					)}
				</div>
			)}
			{expanded && preview.comments.length > 0 && (
				<div className="border-t">
					<div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">
						Comments ({preview.comments.length})
					</div>
					<div className="max-h-80 divide-y overflow-y-auto">
						{preview.comments.map((comment) => (
							<div key={comment.id} className="space-y-2 px-4 py-3">
								<div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
									<span>{comment.authorLogin ?? 'Unknown author'}</span>
									<a
										href={comment.url}
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 hover:text-foreground"
									>
										View comment
										<ExternalLink className="size-3" />
									</a>
								</div>
								{comment.body ? (
									<div className="text-sm">
										<MarkdownRenderer content={comment.body} />
									</div>
								) : (
									<p className="text-xs text-muted-foreground">No comment body.</p>
								)}
							</div>
						))}
					</div>
				</div>
			)}
		</article>
	)
}
