import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'

const ROBOT_VERBS = [
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

interface OmniSpinnerProps {
  className?: string
}

export function OmniSpinner({ className }: OmniSpinnerProps) {
  // Self-contained verb rotation logic
  const [randomVerb, setRandomVerb] = useState(() => {
    const verb = ROBOT_VERBS[Math.floor(Math.random() * ROBOT_VERBS.length)]
    return verb.charAt(0).toUpperCase() + verb.slice(1)
  })

  // Shuffle spinner order on mount for variety
  const [spinnerOrder] = useState(() => {
    // Shuffle array [0, 1, 2, 3] on mount
    const types = [0, 1, 2, 3]
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[types[i], types[j]] = [types[j], types[i]]
    }
    return types
  })

  const [currentIndex, setCurrentIndex] = useState(0)
  const spinnerType = spinnerOrder[currentIndex]

  // Cycle through spinners with random 5-10 second intervals
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>

    const cycleToNext = () => {
      // Random interval between 5-10 seconds
      const delay = 5000 + Math.random() * 5000

      timeoutId = setTimeout(() => {
        setCurrentIndex(prev => {
          const next = (prev + 1) % 4
          return next
        })
        // Schedule the next cycle after updating
        cycleToNext()
      }, delay)
    }

    cycleToNext()

    return () => {
      clearTimeout(timeoutId)
    }
  }, [])

  // Self-contained interval management
  useEffect(() => {
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
          const verb = ROBOT_VERBS[Math.floor(Math.random() * ROBOT_VERBS.length)]
          return verb.charAt(0).toUpperCase() + verb.slice(1)
        })
        scheduleNext()
      }, nextInterval)
    }

    scheduleNext()
    return () => clearTimeout(timeoutId)
  }, [])

  // Dynamic semi-circle spinner state
  const [semiCircleDirection, setSemiCircleDirection] = useState<'forward' | 'backward'>('forward')
  const [semiCircleScale, setSemiCircleScale] = useState<number>(1) // Start at 100% size (of small container)

  // Effect for semi-circle animation changes
  useEffect(() => {
    // Only run this effect if we have the semi-circle spinner (type 0)
    if (spinnerType !== 0) return

    // Reset to starting size when Type 0 is selected
    setSemiCircleScale(1)
    setSemiCircleDirection('forward')

    const changeAnimation = () => {
      // Cycle through scales: 1 -> 0.7 -> 0.85 -> 1
      setSemiCircleScale(prev => {
        let next
        if (prev === 1) next = 0.7
        else if (prev === 0.7) next = 0.85
        else next = 1

        return next
      })

      setSemiCircleDirection(prev => {
        const next = prev === 'forward' ? 'backward' : 'forward'
        return next
      })
    }

    // Fixed interval of 2 seconds
    const interval = setInterval(changeAnimation, 2000)

    return () => {
      clearInterval(interval)
    }
  }, [spinnerType])

  // Spinner variants (4 types) - very compact sizes
  const spinners = [
    // Type 0: Dynamic semi-circle with direction and size changes
    <div
      key={0}
      className="relative w-4 h-4 flex items-center justify-center"
    >
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
      <div
        className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
        style={{ animationDelay: '0ms' }}
      />
      <div
        className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
        style={{ animationDelay: '150ms' }}
      />
      <div
        className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
        style={{ animationDelay: '300ms' }}
      />
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
    <div className={`flex items-center gap-2 ${className || ''}`}>
      {spinners[spinnerType]}
      <span className="text-muted-foreground opacity-80 animate-fade-pulse text-xs">
        {randomVerb}
      </span>
    </div>
  )
}
