import { Button } from '@humanlayer/ui/components/button'
import { clampArtifactViewMode } from '@humanlayer/ui/lib/file-types'
import { Menu } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { useArtifactContent } from '@/hooks/live-queries/useArtifactContent'
import type { MobileArtifactItem } from '@/mobile/components/pure/MobileArtifactSheet'
import { WiredMobileArtifactSheet } from '@/mobile/components/wired/WiredMobileArtifactSheet'

interface WiredMobileArtifactsControllerProps {
	artifacts: MobileArtifactItem[]
	unreadCount?: number
	onSendToSession?: (text: string) => 'queued' | 'sent' | false
	children: (slots: { trigger?: ReactNode; sheet: ReactNode }) => ReactNode
}

export function WiredMobileArtifactsController({
	artifacts,
	unreadCount = 0,
	onSendToSession,
	children,
}: WiredMobileArtifactsControllerProps) {
	const [isOpen, setIsOpen] = useState(false)
	const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
	const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered')
	const { artifact: selectedArtifact } = useArtifactContent(selectedArtifactId)
	const selectedFilename = artifacts.find((artifact) => artifact.artifactId === selectedArtifactId)?.filename ?? ''
	const effectiveViewMode = clampArtifactViewMode(selectedFilename, viewMode)

	const handleOpenChange = (open: boolean) => {
		setIsOpen(open)
		if (!open) setSelectedArtifactId(null)
	}

	const handleArtifactSelect = (artifactId: string) => {
		setSelectedArtifactId(artifactId)
		setIsOpen(true)
	}

	const trigger =
		artifacts.length > 0 ? (
			<Button
				variant="ghost"
				size="icon"
				className="relative size-11"
				onClick={() => setIsOpen(true)}
				aria-label={
					unreadCount > 0
						? `Open artifacts (${unreadCount} comment threads with new activity)`
						: 'Open artifacts'
				}
			>
				<Menu className="h-5 w-5" />
				{unreadCount > 0 && (
					<span className="absolute top-2 right-2 size-1.5 bg-[var(--terminal-accent)]" aria-hidden />
				)}
			</Button>
		) : undefined

	return (
		<>
			{children({
				trigger,
				sheet: (
					<WiredMobileArtifactSheet
						isOpen={isOpen}
						onOpenChange={handleOpenChange}
						artifacts={artifacts}
						selectedArtifactId={selectedArtifactId}
						selectedArtifactContent={selectedArtifact?.content ?? undefined}
						viewMode={effectiveViewMode}
						onViewModeChange={(mode) => {
							if (mode !== 'diff') setViewMode(mode)
						}}
						onArtifactSelect={handleArtifactSelect}
						onArtifactClose={() => setSelectedArtifactId(null)}
						onSendToSession={onSendToSession}
					/>
				),
			})}
		</>
	)
}
