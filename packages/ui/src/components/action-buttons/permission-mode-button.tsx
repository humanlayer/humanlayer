import { Button } from '@humanlayer/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import {
  PERMISSION_MODE_LABELS,
  PERMISSION_MODE_OPTIONS,
  type PermissionsMode,
  type PermissionsModeNoBypass,
} from '@humanlayer/ui/constants/permission-modes'

export interface PermissionModeButtonProps {
  /**
   * Current session permissions mode. Accepts `'bypass'` and renders it as
   * `'default'` so the button stays visually off while the bypass button owns
   * that state.
   */
  value: PermissionsMode
  onValueChange: (mode: PermissionsModeNoBypass) => void
  disabled?: boolean
  showShortcut?: boolean
  /** Tooltip override when disabled (e.g. harness gating message). */
  disabledTooltip?: string
}

export function PermissionModeButton({
  value,
  onValueChange,
  disabled,
  showShortcut,
  disabledTooltip,
}: PermissionModeButtonProps) {
  const displayValue: PermissionsModeNoBypass = value === 'bypass' ? 'default' : value
  const enabled = displayValue !== 'default'
  const label = PERMISSION_MODE_LABELS[displayValue]

  const tooltipContent = disabled ? (
    <p>{disabledTooltip ?? 'Permission mode unavailable'}</p>
  ) : (
    <p className="flex items-center gap-1">
      Permission Mode: {label}
      {showShortcut ? <KeyboardShortcut>⌥+A</KeyboardShortcut> : null}
    </p>
  )

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <DropdownMenuTrigger asChild disabled={disabled}>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                className={cn(
                  'h-7 px-2 min-w-[38px]',
                  disabled && 'pointer-events-none',
                  enabled &&
                    !disabled && [
                      'bg-[var(--terminal-warning)]/15',
                      'text-[var(--terminal-warning)]',
                      'border-[var(--terminal-warning)]/30',
                      'hover:bg-[var(--terminal-warning)]/25',
                      'hover:border-[var(--terminal-warning)]',
                    ],
                )}
                aria-label="Permission mode"
              >
                <div className="w-4 h-4 text-base leading-none">⏵⏵</div>
              </Button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltipContent}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={displayValue}
          onValueChange={(next) => onValueChange(next as PermissionsModeNoBypass)}
        >
          {PERMISSION_MODE_OPTIONS.map((option) => (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <DropdownMenuRadioItem value={option.value}>
                  <span className="font-medium">{option.label}</span>
                </DropdownMenuRadioItem>
              </TooltipTrigger>
              <TooltipContent side="right">{option.description}</TooltipContent>
            </Tooltip>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
