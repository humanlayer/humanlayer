import { useState, useEffect } from 'react'

interface HotkeyScopeDebuggerIndicatorProps {
  onToggle: () => void
}

export function HotkeyScopeDebuggerIndicator({ onToggle }: HotkeyScopeDebuggerIndicatorProps) {
  const [showTooltip, setShowTooltip] = useState(false)

  // Show tooltip briefly on first mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowTooltip(true)
      setTimeout(() => setShowTooltip(false), 3000)
    }, 1000)
    return () => clearTimeout(timer)
  }, [])

  if (!import.meta.env.DEV) {
    return null
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-[9998]"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={onToggle}
        className="bg-black/50 hover:bg-black/70 text-white/50 hover:text-white p-2 rounded-full transition-all duration-200"
        title="Toggle Hotkey Debugger (Alt+Shift+H)"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="2" y="10" width="20" height="10" rx="2" />
          <path d="M5 13h2m2 0h2m2 0h2m2 0h2" />
          <path d="M7 10V7a1 1 0 011-1h8a1 1 0 011 1v3" />
        </svg>
      </button>
      {showTooltip && (
        <div className="absolute bottom-full right-0 mb-2 px-2 py-1 bg-black/90 text-white text-xs rounded whitespace-nowrap">
          Hotkey Debugger (Alt+Shift+H)
        </div>
      )}
    </div>
  )
}
