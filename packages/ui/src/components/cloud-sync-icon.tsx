import { cn } from '@humanlayer/ui/lib/utils'

interface CloudSyncIconProps {
	className?: string
	size?: number
}

/**
 * Animated cloud sync icon — a cloud shape with rotating sync arrows underneath.
 * Uses the cloud path from lucide's cloud-download and the sync arrows from lucide's folder-sync.
 * The sync arrows rotate continuously via CSS animation.
 */
export function CloudSyncIcon({ className, size = 16 }: CloudSyncIconProps) {
	return (
		<svg
			className={cn('text-current', className)}
			width={size}
			height={size}
			viewBox="0 0 24 20"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			{/* Cloud shape (from lucide cloud-download, slightly adjusted position) */}
			<path d="M4.2 13.1A7 7 0 1 1 15.71 6h1.79a4.5 4.5 0 0 1 2.5 8.2" />

			{/* Sync arrows — two 120° arcs with 60° gaps, thinner stroke for clarity */}
			<g className="origin-[12px_14px] animate-cloud-sync-spin" strokeWidth="1.5">
				{/* Arc 1: 10 o'clock to 2 o'clock, clockwise through top */}
				<path d="M8 12 A4.5 4.5 0 0 1 16 12" />
				{/* Arrowhead at 2 o'clock */}
				<path d="M16 9.5v2.5h-2.5" />

				{/* Arc 2: 4 o'clock to 8 o'clock, clockwise through bottom */}
				<path d="M16 16 A4.5 4.5 0 0 1 8 16" />
				{/* Arrowhead at 8 o'clock */}
				<path d="M8 18.5v-2.5h2.5" />
			</g>
		</svg>
	)
}

/**
 * Animated cloud download icon — a cloud with an arrow that gently bobs up and down.
 * Uses the cloud path and download arrow from lucide's cloud-download icon.
 */
export function CloudDownloadSyncIcon({ className, size = 16 }: CloudSyncIconProps) {
	return (
		<svg
			className={cn('text-current', className)}
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			{/* Cloud shape */}
			<path d="M4.2 15.1A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.2" />

			{/* Download arrow - bobbing up and down */}
			<g className="animate-cloud-arrow-bob">
				<path d="M12 13v8" />
				<path d="m8 17 4 4 4-4" />
			</g>
		</svg>
	)
}
