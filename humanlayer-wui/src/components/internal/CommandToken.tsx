import React from 'react'

export function CommandToken({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 rounded font-mono text-xs bg-[var(--terminal-bg-alt)] text-[var(--terminal-accent)] border border-[var(--terminal-border)] tracking-tight shadow-sm mr-1 align-middle">
      {children}
    </span>
  )
}
