import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@humanlayer/ui/lib/utils'

const DEFAULT_VERBS = [
	'accelerating',
	'actuating',
	'adhering',
	'aggregating',
	'amplifying',
	'anthropomorphizing',
	'attending',
	'balancing',
	'bamboozling',
	'capacitizing',
	'clauding',
	'collapsing',
	'conducting',
	'defragmenting',
	'densifying',
	'diffusing',
	'enchanting',
	'enshrining',
	'extrapolating',
	'finagling',
	'fixating',
	'frolicking',
	'fusing',
	'generating',
	'gravitating',
	'harmonizing',
	'hyperthreading',
	'hypothecating',
	'ideating',
	'inducting',
	'ionizing',
	'layering',
	'mechanizing',
	'overclocking',
	'overcomplicating',
	'philosophizing',
	'photosynthesizing',
	'potentiating',
	'proliferating',
	'propagating',
	'prototyping',
	'quantizing',
	'radiating',
	'recalibrating',
	'receiving',
	'reflecting',
	'riffing',
	'schlepping',
	'shapeshifting',
	'simplifying',
	'sublimating',
	'superconducting',
	'synergizing',
	'thriving',
	'transcribing',
	'transisting',
	'triangulating',
	'vibing',
	'zooming',
]

/** Single-verb list for callers who want a plain "Thinking" instead of the rotating verbs. */
const PLAIN_VERBS = ['thinking']

export interface OmniSpinnerProps {
	/** Additional CSS classes */
	className?: string
	/** Whether to show the verb text. Defaults to true */
	showVerb?: boolean
	/** Custom verb list. Defaults to built-in list */
	verbs?: string[]
	/** Fixed status text shown in place of the rotating verbs while set */
	label?: string
}

export function OmniSpinner({ className, showVerb = true, verbs = DEFAULT_VERBS, label }: OmniSpinnerProps) {
	// Self-contained verb rotation logic
	const [randomVerb, setRandomVerb] = useState(() => {
		const verb = verbs[Math.floor(Math.random() * verbs.length)]
		if (verb === undefined) return ''
		return verb.charAt(0).toUpperCase() + verb.slice(1)
	})

	// Shuffle spinner order on mount for variety
	const [spinnerOrder] = useState(() => {
		const types = [0, 1, 2, 3]
		for (let i = types.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
			;[types[i], types[j]] = [types[j] ?? 0, types[i] ?? 0]
		}
		return types
	})

	const [currentIndex, setCurrentIndex] = useState(0)
	const spinnerType = spinnerOrder[currentIndex]

	// Cycle through spinners with random 5-10 second intervals
	useEffect(() => {
		let timeoutId: ReturnType<typeof setTimeout>

		const cycleToNext = () => {
			const delay = 5000 + Math.random() * 5000

			timeoutId = setTimeout(() => {
				setCurrentIndex((prev) => (prev + 1) % 4)
				cycleToNext()
			}, delay)
		}

		cycleToNext()

		return () => {
			clearTimeout(timeoutId)
		}
	}, [])

	// Self-contained verb interval management
	useEffect(() => {
		if (!showVerb || label !== undefined) return

		const randomizeInterval = () => {
			const minInterval = 2000
			const maxInterval = 20000
			return Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval
		}

		let timeoutId: ReturnType<typeof setTimeout>
		const scheduleNext = () => {
			const nextInterval = randomizeInterval()
			timeoutId = setTimeout(() => {
				setRandomVerb(() => {
					const verb = verbs[Math.floor(Math.random() * verbs.length)]
					if (verb === undefined) return ''
					return verb.charAt(0).toUpperCase() + verb.slice(1)
				})
				scheduleNext()
			}, nextInterval)
		}

		scheduleNext()
		return () => clearTimeout(timeoutId)
	}, [showVerb, verbs, label])

	// Dynamic semi-circle spinner state
	const [semiCircleDirection, setSemiCircleDirection] = useState<'forward' | 'backward'>('forward')
	const [semiCircleScale, setSemiCircleScale] = useState<number>(1)

	// Effect for semi-circle animation changes
	useEffect(() => {
		if (spinnerType !== 0) return

		setSemiCircleScale(1)
		setSemiCircleDirection('forward')

		const changeAnimation = () => {
			setSemiCircleScale((prev) => {
				if (prev === 1) return 0.7
				if (prev === 0.7) return 0.85
				return 1
			})

			setSemiCircleDirection((prev) => (prev === 'forward' ? 'backward' : 'forward'))
		}

		const interval = setInterval(changeAnimation, 2000)

		return () => {
			clearInterval(interval)
		}
	}, [spinnerType])

	// Spinner variants (4 types)
	const spinners = [
		// Type 0: Dynamic semi-circle with direction and size changes
		<div key={0} className="relative w-4 h-4 flex items-center justify-center">
			<div
				className="transition-transform duration-500"
				style={{
					transform: `scale(${semiCircleScale})`,
					width: '100%',
					height: '100%',
				}}
			>
				<svg
					className={`${semiCircleDirection === 'forward' ? 'animate-spin' : 'animate-spin-reverse'} text-primary`}
					viewBox="0 0 24 24"
					fill="none"
					style={{
						width: '100%',
						height: '100%',
					}}
				>
					<circle
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						strokeWidth="4"
						strokeDasharray="31.4 31.4"
						strokeLinecap="round"
					/>
				</svg>
			</div>
		</div>,

		// Type 1: Spinning and pulsing circle
		<div key={1} className="relative w-4 h-4 flex items-center justify-center">
			<div className="animate-pulse w-4 h-4">
				<Loader2 className="w-4 h-4 animate-spin text-primary" />
			</div>
		</div>,

		// Type 2: Bouncing dots
		<div key={2} className="flex items-center gap-1">
			<div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
			<div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
			<div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
		</div>,

		// Type 3: Waveform bars (5 bars bouncing at different speeds)
		<div key={3} className="flex items-center gap-0.5">
			<div className="w-1 h-2 bg-primary/40 rounded-full animate-bounce-slow" />
			<div className="w-1 h-3 bg-primary/60 rounded-full animate-bounce-medium" />
			<div className="w-1 h-2 bg-primary/80 rounded-full animate-bounce-fast" />
			<div className="w-1 h-1 bg-primary/60 rounded-full animate-bounce-medium delay-150" />
			<div className="w-1 h-2 bg-primary/40 rounded-full animate-bounce-slow delay-300" />
		</div>,
	]

	return (
		<div data-slot="omni-spinner" className={cn('flex items-center gap-2', className)}>
			{spinnerType !== undefined && spinners[spinnerType]}
			{showVerb && (
				<span className="text-muted-foreground opacity-80 animate-fade-pulse text-xs">{label ?? randomVerb}</span>
			)}
		</div>
	)
}

export { DEFAULT_VERBS, PLAIN_VERBS }
