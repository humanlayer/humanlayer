'use client'

import { ChevronRight, Copy, Folder, FolderGit2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge } from '@humanlayer/ui/components/badge'
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from '@humanlayer/ui/components/collapsible'
import { cn } from '@humanlayer/ui/lib/utils'

/**
 * Presentation-agnostic node model for the Workspace sidebar tab. The wired
 * container derives this from a task's `workspace_state` snapshot (root first,
 * repos in config-declared order); the tree markup below is a private
 * rendering detail, so swapping the renderer (e.g. for Pierre Trees) or adding
 * per-node actions later changes only this file, not the data contract.
 */
export type WorkspaceTreeNode = {
	id: string
	label: string
	/** User-provided repo description; omitted lines render the path only (never fabricated). */
	description?: string
	/** Marks the default launch / config repo. */
	primary?: boolean
	kind: 'root' | 'repo'
}

export interface WorkspaceTabPureProps {
	/** Workspace root first, then repos in config-declared order. */
	nodes: WorkspaceTreeNode[]
	/** Pretty-printed workspace_state JSON for the raw-state disclosure. */
	rawState: string
	/** Optional per-node action; rows render as buttons when provided. */
	onNodeClick?: (node: WorkspaceTreeNode) => void
	/** Optional copy action; rendered on the workspace root row. */
	onCopyNode?: (node: WorkspaceTreeNode) => void
	/** App-owned content shown at the end of a repo row. */
	renderRepoSuffix?: (node: WorkspaceTreeNode) => ReactNode
	/** App-owned content shown directly below a repo row. */
	renderRepoDetails?: (node: WorkspaceTreeNode) => ReactNode
	className?: string
}

function PrimaryBadge() {
	return (
		<Badge
			variant="outline"
			className="shrink-0 rounded-none px-1 py-0 text-[9px] leading-3 uppercase tracking-wide"
			style={{
				borderColor: 'color-mix(in srgb, var(--terminal-success) 45%, transparent)',
				color: 'var(--terminal-success)',
			}}
			title="Default launch / config repo"
		>
			primary
		</Badge>
	)
}

function WorkspaceNodeRow({
	node,
	onNodeClick,
	onCopyNode,
	suffix,
}: {
	node: WorkspaceTreeNode
	onNodeClick?: (node: WorkspaceTreeNode) => void
	onCopyNode?: (node: WorkspaceTreeNode) => void
	suffix?: ReactNode
}) {
	const isRoot = node.kind === 'root'
	const Icon = isRoot ? Folder : FolderGit2
	const content = (
		<>
			<Icon
				className={cn('mt-0.5 size-3.5 shrink-0', isRoot ? 'text-accent' : 'text-muted-foreground')}
				strokeWidth={1.5}
				aria-hidden
			/>
			<span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
				<span className={cn('break-all', isRoot ? 'text-foreground' : 'text-accent')}>{node.label}</span>
				{node.primary ? <PrimaryBadge /> : null}
				{node.description ? (
					<span className="min-w-0 text-xs text-muted-foreground">{node.description}</span>
				) : null}
			</span>
		</>
	)

	const copyButton = isRoot && onCopyNode ? <WorkspaceCopyButton node={node} onCopyNode={onCopyNode} /> : null

	if (onNodeClick) {
		return (
			<div className="flex w-full items-start gap-2">
				<button
					type="button"
					onClick={() => onNodeClick(node)}
					className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left transition-colors hover:text-[var(--terminal-accent)]"
				>
					{content}
				</button>
				{suffix ? <span className="ml-auto shrink-0">{suffix}</span> : null}
				{copyButton}
			</div>
		)
	}
	return (
		<div className="flex w-full items-start gap-2">
			<div className="flex min-w-0 flex-1 items-start gap-2">{content}</div>
			{suffix ? <span className="ml-auto shrink-0">{suffix}</span> : null}
			{copyButton}
		</div>
	)
}

function WorkspaceCopyButton({
	node,
	onCopyNode,
}: {
	node: WorkspaceTreeNode
	onCopyNode: (node: WorkspaceTreeNode) => void
}) {
	return (
		<button
			type="button"
			aria-label="Copy workspace directory"
			title="Copy workspace directory"
			onClick={() => onCopyNode(node)}
			className="mt-0.5 shrink-0 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
		>
			<Copy className="size-3.5" strokeWidth={1.5} aria-hidden />
		</button>
	)
}

/**
 * Pure tree view for a multi-repo task's workspace: the workspace root, each
 * repo with its relative path / description / primary label, a footer noting
 * what loads into sessions, and a collapsible raw-state JSON disclosure for
 * debuggability.
 */
export function WorkspaceTabPure({
	nodes,
	rawState,
	onNodeClick,
	onCopyNode,
	renderRepoSuffix,
	renderRepoDetails,
	className,
}: WorkspaceTabPureProps) {
	const rootNode = nodes.find((node) => node.kind === 'root')
	const repoNodes = nodes.filter((node) => node.kind === 'repo')

	return (
		<div className={cn('flex h-full min-h-0 flex-col overflow-y-auto font-mono text-sm', className)}>
			{rootNode ? <WorkspaceNodeRow node={rootNode} onNodeClick={onNodeClick} onCopyNode={onCopyNode} /> : null}
			<ul
				aria-label="Workspace repositories"
				className={cn('flex flex-col gap-1.5', rootNode && 'mt-1.5 ml-[7px] border-l border-border/60 pl-3')}
			>
				{repoNodes.map((node) => (
					<li key={node.id}>
						<WorkspaceNodeRow
							node={node}
							onNodeClick={onNodeClick}
							onCopyNode={onCopyNode}
							suffix={renderRepoSuffix?.(node)}
						/>
						{renderRepoDetails?.(node)}
					</li>
				))}
			</ul>
			<div className="mt-4 border-t border-dashed border-border/60 pt-3 text-xs text-muted-foreground">
				{repoNodes.length} repos · skills & instruction files from each repo are loaded into every session
				in this task. Claude settings & MCP configuration follow the session's launch directory.
			</div>
			<Collapsible className="mt-3">
				<CollapsibleTrigger className="group flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
					<ChevronRight className="size-3 transition-transform duration-150 group-data-[state=open]:rotate-90" />
					Raw state
				</CollapsibleTrigger>
				<CollapsibleContent>
					<pre className="mt-2 overflow-x-auto border border-border/60 bg-muted/30 p-2 text-[11px] leading-relaxed text-muted-foreground">
						<code>{rawState}</code>
					</pre>
				</CollapsibleContent>
			</Collapsible>
		</div>
	)
}
