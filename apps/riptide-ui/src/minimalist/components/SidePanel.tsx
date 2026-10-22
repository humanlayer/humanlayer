import type { Task } from '@humanlayer/db/tables/tasks'
import { FileDiff, FileText, GitPullRequest, Image, Maximize2, Minimize2, PanelRightClose } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import type { TaskArtifact } from '@/hooks/live-queries/useTaskArtifacts'
import { ArtifactView } from '@/minimalist/components/ArtifactPanel'
import { PullRequestPanel } from '@/minimalist/components/PullRequestPanel'
import { ResizeHandle } from '@/minimalist/components/ResizeHandle'
import { ReviewPanel } from '@/minimalist/components/ReviewPanel'
import { artifactName, isImageArtifact, isListedArtifact, isPromptArtifact } from '@/minimalist/lib/artifacts'
import { canReview } from '@/minimalist/lib/data'
import { useTaskPullRequest } from '@/minimalist/lib/pull-requests'
import { selectWithArrows } from '@/minimalist/lib/roving'
import { shortcutHint } from '@/minimalist/lib/shortcuts'
import type { PanelRequest, PanelTab } from '@/minimalist/lib/thread-panel'

/**
 * The task's side panel: its changes, each artifact it wrote, and its PR, as
 * one tab strip. Replaces the old Changes, Diffs, Artifacts and GitHub tabs.
 * A task in a plain directory has no changes or PR to show, so it gets documents only.
 */
export function SidePanel({
	task,
	preferred,
	requested,
	sessionId,
	artifacts: unordered,
	onClose,
}: {
	task: Task
	/** The tab to show until one is picked: what the agent just changed. */
	preferred: PanelTab | null
	/**
	 * A tab asked for by a link, the palette or a Review button. Each new request object
	 * wins over the tab you picked, even when it asks for the same tab again.
	 */
	requested: PanelRequest | null
	sessionId: string
	artifacts: TaskArtifact[]
	onClose: () => void
}) {
	const { branch } = useTaskPullRequest(task.id)
	const pr = branch?.pullRequest ?? null
	const [chosen, setChosen] = useState<PanelTab | null>(requested?.tab ?? null)
	const [lastRequested, setLastRequested] = useState(requested)
	if (requested !== lastRequested) {
		setLastRequested(requested)
		if (requested) setChosen(requested.tab)
	}
	const documents = unordered.filter(isListedArtifact)
	const artifacts = [...documents.filter((entry) => !isPromptArtifact(entry)), ...documents.filter(isPromptArtifact)]
	const git = canReview(task)
	const shows = (candidate: PanelTab | null): candidate is PanelTab =>
		candidate === 'review' || candidate === 'pr'
			? git
			: artifacts.some((artifact) => `artifact:${artifact.id}` === candidate)
	// Open on the first document, unless it is only the prompt and there are changes to show.
	const first = artifacts[0]
	const opening: PanelTab | null =
		first && !(git && isPromptArtifact(first)) ? `artifact:${first.id}` : git ? 'review' : null
	const tab = [chosen, preferred].find(shows) ?? opening
	const artifact = artifacts.find((entry) => `artifact:${entry.id}` === tab)
	// Once opened, Review stays mounted behind the other tabs so line comments you haven't sent survive a look at a document.
	const [reviewOpened, setReviewOpened] = useState(tab === 'review')
	if (tab === 'review' && !reviewOpened) setReviewOpened(true)
	// Long documents and big diffs read better with the whole page; the thread comes back on collapse.
	const [wide, setWide] = useState(false)

	return (
		<section className={wide ? 'panel wide' : 'panel'} aria-label="Side panel">
			<div className="tabs">
				<div className="tab-row" role="tablist" aria-label="Side panel tabs" onKeyDown={selectWithArrows}>
					{git ? (
						<Tab selected={tab === 'review'} onSelect={() => setChosen('review')}>
							<FileDiff className="i sm" strokeWidth={1.6} />
							Review
						</Tab>
					) : null}
					{artifacts.map((entry) => (
						<Tab
							key={entry.id}
							selected={tab === `artifact:${entry.id}`}
							onSelect={() => setChosen(`artifact:${entry.id}`)}
							title={entry.file_name}
						>
							{isImageArtifact(entry) ? (
								<Image className="i sm" strokeWidth={1.6} />
							) : (
								<FileText className="i sm" strokeWidth={1.6} />
							)}
							{artifactName(entry.file_name)}
						</Tab>
					))}
					{git ? (
						<Tab selected={tab === 'pr'} onSelect={() => setChosen('pr')}>
							<GitPullRequest className="i sm" strokeWidth={1.6} />
							{pr ? `PR #${pr.number}` : 'PR'}
						</Tab>
					) : null}
				</div>
				<span className="sp" />
				<button
					type="button"
					className="iconbtn panel-widen"
					title={wide ? 'Show the thread' : 'Use the whole page'}
					aria-label={wide ? 'Show the thread' : 'Use the whole page'}
					aria-pressed={wide}
					onClick={() => setWide(!wide)}
				>
					{wide ? (
						<Minimize2 className="i sm" strokeWidth={1.6} />
					) : (
						<Maximize2 className="i sm" strokeWidth={1.6} />
					)}
				</button>
				<button
					type="button"
					className="iconbtn"
					title={`Close panel (${shortcutHint('panel')})`}
					aria-label="Close panel"
					onClick={onClose}
				>
					<PanelRightClose className="i" strokeWidth={1.6} />
				</button>
			</div>
			<div className="panel-body" role="tabpanel">
				{reviewOpened ? (
					<div className="pane" hidden={tab !== 'review'}>
						<ReviewPanel
							task={task}
							sessionId={sessionId}
							focus={
								requested?.tab === 'review' && (requested.file || requested.comment) ? requested : null
							}
						/>
					</div>
				) : null}
				{tab === 'pr' ? <PullRequestPanel taskId={task.id} sessionId={sessionId} /> : null}
				{artifact ? (
					<ArtifactView
						key={artifact.id}
						task={task}
						artifact={artifact}
						sessionId={sessionId}
						focus={requested?.tab === tab && requested.comment ? requested : undefined}
					/>
				) : null}
				{tab === null ? <div className="empty pad">Documents the agent writes show up here.</div> : null}
			</div>
			{wide ? null : <ResizeHandle pane="panel" edge="left" />}
		</section>
	)
}

function Tab({
	selected,
	onSelect,
	title,
	children,
}: {
	selected: boolean
	onSelect: () => void
	title?: string
	children: ReactNode
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={selected}
			tabIndex={selected ? 0 : -1}
			className={`tab${selected ? ' sel' : ''}`}
			onClick={onSelect}
			title={title}
		>
			{children}
		</button>
	)
}
