import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/AppStore'
import { isViewingSessionDetail } from '@/hooks/useSessionLauncher'

interface Position {
  x: number
  y: number
  vx: number
  vy: number
}

const themeColors = [
  'var(--terminal-accent)',
  'var(--terminal-accent-alt)',
  'var(--terminal-success)',
  'var(--terminal-error)',
  'var(--terminal-warning)',
]

export function DvdScreensaver() {
  const { activeSessionDetail } = useStore()
  const [position, setPosition] = useState<Position>({ x: 100, y: 100, vx: 2, vy: 2 })
  const [isEnabled, setIsEnabled] = useState(false)
  const [colorIndex, setColorIndex] = useState(0)
  const animationFrameRef = useRef<number>()
  const boxRef = useRef<HTMLDivElement>(null)

  // Load saved state from localStorage for current session
  useEffect(() => {
    if (activeSessionDetail?.session?.id) {
      const saved = localStorage.getItem(`brainrot-mode-${activeSessionDetail.session.id}`)
      if (saved === 'true' && isViewingSessionDetail()) {
        setIsEnabled(true)
      } else {
        setIsEnabled(false)
      }
    }
  }, [activeSessionDetail?.session?.id])

  // Get the most recent tool name
  const getLatestToolName = (): string => {
    if (!activeSessionDetail?.conversation) return 'Assistant'

    const events = activeSessionDetail.conversation
    const lastRelevantEvent = [...events]
      .reverse()
      .find(
        e =>
          e.eventType === 'tool_call' ||
          (e.eventType === 'message' && e.role === 'assistant') ||
          e.eventType === 'thinking',
      )

    if (lastRelevantEvent?.eventType === 'tool_call') {
      return lastRelevantEvent.toolName || 'Tool'
    } else if (lastRelevantEvent?.eventType === 'thinking') {
      return 'Thinking'
    }
    return 'Assistant'
  }

  // Listen for toggle event
  useEffect(() => {
    const handleToggle = () => {
      setIsEnabled(prev => {
        const newValue = !prev
        if (activeSessionDetail?.session?.id) {
          localStorage.setItem(`brainrot-mode-${activeSessionDetail.session.id}`, String(newValue))
        }
        return newValue
      })
    }
    window.addEventListener('toggle-brainrot-mode', handleToggle)
    return () => window.removeEventListener('toggle-brainrot-mode', handleToggle)
  }, [activeSessionDetail?.session?.id])

  // Disable when leaving session detail page
  useEffect(() => {
    const checkLocation = () => {
      if (!isViewingSessionDetail()) {
        setIsEnabled(false)
      }
    }

    // Check on hash change (navigation)
    window.addEventListener('hashchange', checkLocation)
    return () => window.removeEventListener('hashchange', checkLocation)
  }, [])

  // Animation loop
  useEffect(() => {
    if (!isEnabled || !boxRef.current) return

    const animate = () => {
      const box = boxRef.current
      if (!box) return

      const rect = box.getBoundingClientRect()
      const windowWidth = window.innerWidth
      const windowHeight = window.innerHeight

      setPosition(prev => {
        let { x, y, vx, vy } = prev

        // Update position
        x += vx
        y += vy

        // Bounce off walls and change color
        let bounced = false
        if (x <= 0 || x + rect.width >= windowWidth) {
          vx = -vx
          x = x <= 0 ? 0 : windowWidth - rect.width
          bounced = true
        }
        if (y <= 0 || y + rect.height >= windowHeight) {
          vy = -vy
          y = y <= 0 ? 0 : windowHeight - rect.height
          bounced = true
        }

        // Change color on bounce
        if (bounced) {
          setColorIndex(prevIndex => (prevIndex + 1) % themeColors.length)
        }

        return { x, y, vx, vy }
      })

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isEnabled])

  // Only show if enabled, viewing a session detail, and have session data
  if (!isEnabled || !isViewingSessionDetail() || !activeSessionDetail) return null

  return (
    <div
      ref={boxRef}
      className="fixed z-40 pointer-events-none rounded-md text-xs font-mono flex items-center justify-center overflow-hidden"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '100px',
        height: '100px',
        transition: 'none',
        backgroundColor: themeColors[colorIndex],
        color: 'var(--terminal-bg)',
      }}
    >
      <span className="px-2 text-center">{getLatestToolName()}</span>
    </div>
  )
}
