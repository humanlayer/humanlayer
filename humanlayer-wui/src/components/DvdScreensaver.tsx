import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/AppStore'
import { isViewingSessionDetail } from '@/hooks/useSessionLauncher'

interface Position {
  x: number
  y: number
  vx: number
  vy: number
}

export function DvdScreensaver() {
  const { activeSessionDetail } = useStore()
  const [position, setPosition] = useState<Position>({ x: 100, y: 100, vx: 2, vy: 2 })
  const [isEnabled, setIsEnabled] = useState(false)
  const animationFrameRef = useRef<number>()
  const boxRef = useRef<HTMLDivElement>(null)

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
    const handleToggle = () => setIsEnabled(prev => !prev)
    window.addEventListener('toggle-brainrot-mode', handleToggle)
    return () => window.removeEventListener('toggle-brainrot-mode', handleToggle)
  }, [])

  // Disable when leaving session detail
  useEffect(() => {
    if (!isViewingSessionDetail()) {
      setIsEnabled(false)
    }
  }, [activeSessionDetail])

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

        // Bounce off walls
        if (x <= 0 || x + rect.width >= windowWidth) {
          vx = -vx
          x = x <= 0 ? 0 : windowWidth - rect.width
        }
        if (y <= 0 || y + rect.height >= windowHeight) {
          vy = -vy
          y = y <= 0 ? 0 : windowHeight - rect.height
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
      className="fixed z-40 pointer-events-none bg-primary text-primary-foreground rounded-md text-xs font-mono flex items-center justify-center overflow-hidden"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '100px',
        height: '100px',
        transition: 'none',
      }}
    >
      <span className="px-2 text-center">{getLatestToolName()}</span>
    </div>
  )
}
