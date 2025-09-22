import React from 'react'

interface ToolHeaderProps {
  name: string
  description?: string
  primaryParam?: React.ReactNode
  secondaryParam?: React.ReactNode
  status?: React.ReactNode
  nameColor?: string
}

export function ToolHeader({
  name,
  description,
  primaryParam,
  secondaryParam,
  status,
  nameColor,
}: ToolHeaderProps) {
  return (
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`font-semibold ${nameColor || ''}`}>{name}</span>
          {description && <span className="text-sm text-muted-foreground">{description}</span>}
        </div>
        {primaryParam && (
          <div className="mt-1 font-mono text-sm text-muted-foreground">{primaryParam}</div>
        )}
        {secondaryParam && <div className="mt-1 text-sm text-muted-foreground">{secondaryParam}</div>}
      </div>
      {status && <div className="ml-4">{status}</div>}
    </div>
  )
}
