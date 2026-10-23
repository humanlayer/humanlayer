import { useMemo } from 'react'

import {
	CodeViewStack,
	type CodeViewStackComparison,
	type CodeViewStackFile,
} from '../../components/diff-review/code-view-stack'
import { useDiffStyle } from '../../components/diff-style-provider'
import { getComparisonDiff, getDiffLineCounts } from '../../lib/diff-review/build-code-view-items'

export interface ArtifactVersionDiffProps {
	sourceLabel: string
	sourceText: string
	destinationLabel: string
	destinationText: string
	showFileHeader?: boolean
}

const FILE_ID = 'artifact-version-comparison'
const EMPTY_IDS = new Set<string>()
const ignoreReviewedChange = () => {}
const ignoreCollapsedChange = () => {}

// Artifact bodies carry no stable content ID, so the comparison is built uncached.
function artifactComparison({
	sourceLabel,
	sourceText,
	destinationLabel,
	destinationText,
}: ArtifactVersionDiffProps): CodeViewStackComparison {
	return {
		fileId: FILE_ID,
		oldFile: { name: sourceLabel, contents: sourceText },
		newFile: { name: destinationLabel, contents: destinationText },
	}
}

export function getArtifactVersionDiffLineCounts(props: ArtifactVersionDiffProps) {
	const fileDiff = getComparisonDiff(artifactComparison(props))
	return fileDiff ? getDiffLineCounts(fileDiff) : { additions: 0, deletions: 0 }
}

export function ArtifactVersionDiff({
	sourceLabel,
	sourceText,
	destinationLabel,
	destinationText,
	showFileHeader = true,
}: ArtifactVersionDiffProps) {
	const { diffStyle } = useDiffStyle()
	const model = useMemo(() => {
		const comparison = artifactComparison({ sourceLabel, sourceText, destinationLabel, destinationText })
		const fileDiff = getComparisonDiff(comparison)
		const { additions, deletions } = fileDiff ? getDiffLineCounts(fileDiff) : { additions: 0, deletions: 0 }
		const file: CodeViewStackFile = {
			id: FILE_ID,
			repoId: '',
			path: `${sourceLabel} -> ${destinationLabel}`,
			changeType: 'modified',
			additions,
			deletions,
			binary: false,
			generated: false,
		}
		return { files: [file], comparisons: [comparison] }
	}, [destinationLabel, destinationText, sourceLabel, sourceText])

	return (
		<div className="flex h-full min-h-0 flex-1" aria-label={`${sourceLabel} to ${destinationLabel} comparison`}>
			<CodeViewStack
				files={model.files}
				comparisons={model.comparisons}
				diffStyle={diffStyle}
				reviewedIds={EMPTY_IDS}
				collapsedIds={EMPTY_IDS}
				onReviewedChange={ignoreReviewedChange}
				onCollapsedChange={ignoreCollapsedChange}
				reviewEnabled={false}
				showFileHeaders={showFileHeader}
			/>
		</div>
	)
}
