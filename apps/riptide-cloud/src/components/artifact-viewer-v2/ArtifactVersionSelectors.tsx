import { getArtifactVersionDiffLineCounts } from '@humanlayer/ui/artifact-viewer-v2'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'

import type { ArtifactVersionDiffView, ArtifactVersionOption } from './useArtifactVersions'

function compactVersionLabel(label: string) {
	return label.replace(/^Version\s+/i, 'V')
}

function formatVersionTimestamp(value: number) {
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	}).format(new Date(value))
}

function VersionOptionRow({ option }: { option: ArtifactVersionOption }) {
	return (
		<div className="grid min-w-0 flex-1 gap-1 py-0.5">
			<div className="flex min-w-0 items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate font-medium text-foreground">{option.label}</span>
					{option.id === 'latest' ? (
						<span className="shrink-0 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
							Current
						</span>
					) : null}
				</div>
				<span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
					<span className="text-[var(--terminal-success)]">+{option.addedLines}</span>
					<span className="text-destructive">-{option.removedLines}</span>
				</span>
			</div>
			<div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
				<time className="shrink-0" dateTime={new Date(option.createdAt).toISOString()}>
					{formatVersionTimestamp(option.createdAt)}
				</time>
				<span aria-hidden="true">·</span>
				<span className="truncate">{option.createdBy}</span>
			</div>
		</div>
	)
}

export function ArtifactVersionSelectors({
	model,
	showLineCounts = false,
}: {
	model: ArtifactVersionDiffView
	showLineCounts?: boolean
}) {
	const lineCounts = useMemo(() => {
		if (!showLineCounts || !model.sourceLabel || model.sourceText === null || model.destinationText === null)
			return null
		return getArtifactVersionDiffLineCounts({
			sourceLabel: model.sourceLabel,
			sourceText: model.sourceText,
			destinationLabel: model.destinationLabel,
			destinationText: model.destinationText,
		})
	}, [model.destinationLabel, model.destinationText, model.sourceLabel, model.sourceText, showLineCounts])

	if (model.options.length === 0) return null

	return (
		<div className="flex w-full min-w-0 items-center gap-2" aria-label="Artifact versions">
			<Select value={model.sourceId ?? ''} onValueChange={model.onSourceChange}>
				<SelectTrigger
					size="sm"
					className="min-w-0 flex-[2] border-transparent bg-muted/50 px-2.5 text-xs shadow-none hover:bg-muted/70 [&_svg]:hidden @[360px]:[&_svg]:block @[580px]:max-w-32 @[580px]:flex-none"
					aria-label="Source version"
				>
					<SelectValue>{model.sourceLabel ? compactVersionLabel(model.sourceLabel) : 'Source'}</SelectValue>
				</SelectTrigger>
				<SelectContent className="w-72">
					{model.options.map((option) => (
						<SelectItem
							key={option.id}
							value={option.id}
							className="py-2 pr-8 focus:bg-primary/10 focus:text-foreground data-[state=checked]:bg-primary/10 data-[state=checked]:text-foreground [&>span:last-child]:w-full"
						>
							<VersionOptionRow option={option} />
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<ArrowLeft className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
			<Select value={model.destinationId} onValueChange={model.onDestinationChange}>
				<SelectTrigger
					size="sm"
					className="min-w-0 flex-[3] border-transparent bg-muted/50 px-2.5 text-xs shadow-none hover:bg-muted/70 [&_svg]:hidden @[360px]:[&_svg]:block @[580px]:max-w-32 @[580px]:flex-none"
					aria-label="Destination version"
				>
					<SelectValue>{compactVersionLabel(model.destinationLabel)}</SelectValue>
				</SelectTrigger>
				<SelectContent className="w-72">
					{model.options.map((option) => (
						<SelectItem
							key={option.id}
							value={option.id}
							className="py-2 pr-8 focus:bg-primary/10 focus:text-foreground data-[state=checked]:bg-primary/10 data-[state=checked]:text-foreground [&>span:last-child]:w-full"
						>
							<VersionOptionRow option={option} />
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{lineCounts ? (
				<span
					className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]"
					aria-label={`${lineCounts.additions} additions, ${lineCounts.deletions} deletions`}
				>
					<span className="text-[var(--terminal-success)]">+{lineCounts.additions}</span>
					<span className="text-destructive">-{lineCounts.deletions}</span>
				</span>
			) : null}
		</div>
	)
}
