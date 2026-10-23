import { useState } from 'react'

import { DiffViewer } from '../../src/components/conversation-stream/diff-viewer'
import { DiffHeaderBar } from '../../src/components/diff-review/diff-header-bar'
import { DiffHotkeyFooter } from '../../src/components/diff-review/DiffHotkeyFooter'
import { OpenPullRequestBar } from '../../src/components/diff-review/open-pull-request-bar'
import { diffReviewFiles } from './fixtures'

export interface OpenPullRequestBarShellDemoProps {
	/** A second repository the same task works in, each row naming its own. */
	secondRepoLabel?: string
	openCommentCount?: number
}

/** Where the bar actually sits: under the diff it is offering a pull request for. */
export function OpenPullRequestBarShellDemo({
	secondRepoLabel,
	openCommentCount = 0,
}: OpenPullRequestBarShellDemoProps) {
	const [hideReviewed, setHideReviewed] = useState(false)
	const [dismissed, setDismissed] = useState<Record<string, true>>({})
	const [sent, setSent] = useState<Record<string, true>>({})
	const file = diffReviewFiles[0]
	const repos = secondRepoLabel ? ['syncopate', secondRepoLabel] : ['syncopate']

	return (
		<div className="mx-auto flex h-[560px] max-w-5xl flex-col border border-border bg-background">
			<DiffHeaderBar
				diffStyle="unified"
				onDiffStyleChange={() => {}}
				reviewedCount={5}
				totalCount={5}
				collapsedCount={0}
				reviewedLines={120}
				totalLines={120}
				hideReviewed={hideReviewed}
				onHideReviewedChange={setHideReviewed}
				openCommentCount={openCommentCount}
				onClose={() => {}}
			/>
			<div className="min-h-0 flex-1 overflow-auto">
				{file ? (
					<DiffViewer
						fileName={file.path}
						oldContent={file.oldContent}
						newContent={file.newContent}
						mode="unified"
					/>
				) : null}
			</div>
			{/* The hotkey hints belong to the code view and come and go with the focused target,
			    so the bar goes after them: anchored above, it would move as the reader navigates. */}
			<DiffHotkeyFooter canExtendRange={false} isFullscreen={false} />
			{repos.map((repoLabel) =>
				dismissed[repoLabel] ? null : (
					<OpenPullRequestBar
						key={repoLabel}
						repoLabel={repoLabel}
						branch="github-open-pr-cta"
						kind="send"
						pending={false}
						sent={sent[repoLabel] === true}
						demoted={openCommentCount > 0}
						onOpen={() => setSent((current) => ({ ...current, [repoLabel]: true }))}
						onDismiss={() => setDismissed((current) => ({ ...current, [repoLabel]: true }))}
					/>
				),
			)}
		</div>
	)
}
