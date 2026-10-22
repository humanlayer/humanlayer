import { AGENT_OPTIONS, launcherProviderForAgent, type AgentOption } from '@humanlayer/ui/constants/agents'
import {
  getModelOptionsForAgentProvider,
  MODEL_OPTIONS,
  type ModelOption,
  modelLabel,
  type ModelPickerOption,
} from '@humanlayer/ui/constants/models'
import type { ProviderOption } from '@humanlayer/ui/constants/providers'
import { cn } from '@humanlayer/ui/lib/utils'
import { Button } from '@humanlayer/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { Pencil } from 'lucide-react'
import { type FC, type ReactNode, useCallback } from 'react'
import { EffortSelector } from './effort-selector'
import { FastModeToggle } from './fast-mode-toggle'

export type { ModelOption } from '@humanlayer/ui/constants/models'
export type SessionStatus = 'draft' | 'running' | 'ready_for_input' | 'failed' | 'interrupted'
export interface StatusBarAgentOption {
  agent: AgentOption
  provider: ProviderOption
  label: string
}

export interface StatusBarProps {
  status: SessionStatus
  statusText?: string | ReactNode
  statusClassName?: string
  model: ModelOption
  onModelChange: (model: ModelOption) => void
  /** Picker rows from the selected host's runtime catalog; falls back to the bundled list. */
  modelOptions?: ReadonlyArray<ModelPickerOption>
  disabled?: boolean
  /** Controlled open state for the model selector dropdown */
  modelSelectorOpen?: boolean
  /** Callback when the model selector open state changes */
  onModelSelectorOpenChange?: (open: boolean) => void
  /** Current coding agent selection */
  agent?: AgentOption
  /** Callback when agent changes */
  onAgentChange?: (agent: AgentOption) => void
  /** Current provider selection, retained for model filtering */
  provider?: ProviderOption
  /** User-facing agent choices. Each option maps to an agent/provider pair. */
  agentOptions?: readonly StatusBarAgentOption[]
  /** Callback when an agent/provider pair changes. */
  onAgentProviderChange?: (option: StatusBarAgentOption) => void
  /** Current effort level selection */
  effort?: string | null
  /** Callback when effort level changes */
  onEffortChange?: (next: string) => void
  /** Capability descriptor for effort — when supported=true the effort selector renders */
  effortCapability?: { supported: false } | { supported: true; levels: readonly string[] }
  /** Controlled open state for the effort selector dropdown */
  effortSelectorOpen?: boolean
  /** Callback when the effort selector open state changes */
  onEffortSelectorOpenChange?: (open: boolean) => void
  /** Whether Fast Mode is enabled */
  fastMode?: boolean
  /** Callback when Fast Mode toggle changes */
  onFastModeChange?: (next: boolean) => void
  /** Capability descriptor for Fast Mode — when supported=true the toggle renders */
  fastModeCapability?: { supported: boolean }
}

const STATUS_STYLES: Record<SessionStatus, string> = {
  draft: 'text-muted-foreground',
  running: 'text-[var(--terminal-warning)]',
  ready_for_input: 'text-[var(--terminal-success)]',
  failed: 'text-[var(--terminal-error)]',
  interrupted: 'text-[var(--terminal-warning)]',
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  draft: 'DRAFT',
  running: 'RUNNING',
  ready_for_input: 'READY',
  failed: 'FAILED',
  interrupted: 'INTERRUPTED',
}

export const MODEL_LABELS: Record<string, string> = Object.fromEntries(MODEL_OPTIONS.map((o) => [o.value, o.label]))

export const StatusBar: FC<StatusBarProps> = ({
  status,
  statusText,
  statusClassName,
  model,
  onModelChange,
  modelOptions,
  disabled = false,
  modelSelectorOpen,
  onModelSelectorOpenChange,
  agent,
  onAgentChange,
  provider,
  agentOptions,
  onAgentProviderChange,
  effort,
  onEffortChange,
  effortCapability,
  effortSelectorOpen,
  onEffortSelectorOpenChange,
  fastMode,
  onFastModeChange,
  fastModeCapability,
}) => {
  // Filter models based on agent and provider:
  // - Claude Code only supports Anthropic models
  // - Codelayer supports multiple providers, filter by selected provider
  const filteredModels = modelOptions ?? getModelOptionsForAgentProvider({ agent, provider })
  const availableAgentOptions =
    agentOptions ??
    AGENT_OPTIONS.map((option) => ({
      agent: option.value,
      provider: launcherProviderForAgent(option.value),
      label: option.label,
    }))
  const selectedAgentOption = availableAgentOptions.find(
    (option) => option.agent === agent && option.provider === provider,
  )

  // Stop propagation on Enter/Space/Arrow keys to prevent parent hotkey handlers
  // from interfering with dropdown keyboard navigation
  const handleDropdownTriggerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.stopPropagation()
    }
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Status Badge */}
      <span
        className={cn(
          'font-mono text-xs uppercase tracking-wider',
          statusClassName || STATUS_STYLES[status]
        )}
      >
        {statusText || STATUS_LABELS[status]}
      </span>

      {/* Agent Selector Dropdown */}
      {agent && (onAgentProviderChange || onAgentChange) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'h-6 px-2 py-0 text-xs font-mono uppercase tracking-wider',
                'border-muted-foreground/20 transition-colors duration-200',
                disabled
                  ? 'cursor-not-allowed opacity-50'
                  : 'hover:border-muted-foreground/40 hover:text-primary hover:bg-primary/10'
              )}
              disabled={disabled}
              onKeyDown={handleDropdownTriggerKeyDown}
            >
              {selectedAgentOption?.label ?? availableAgentOptions.find((option) => option.agent === agent)?.label}
              {!disabled && <Pencil className="h-3 w-3 ml-1.5 opacity-50" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[120px]">
            <DropdownMenuRadioGroup
              value={`${agent}:${provider ?? ''}`}
              onValueChange={(value) => {
                const option = availableAgentOptions.find((candidate) => `${candidate.agent}:${candidate.provider}` === value)
                if (!option) return
                if (onAgentProviderChange) onAgentProviderChange(option)
                else onAgentChange?.(option.agent)
              }}
            >
              {availableAgentOptions.map((option) => (
                <DropdownMenuRadioItem
                  key={`${option.agent}:${option.provider}`}
                  value={`${option.agent}:${option.provider}`}
                  className="font-mono uppercase text-xs tracking-wider"
                >
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Model Selector Dropdown - WUI Style */}
      <DropdownMenu open={modelSelectorOpen} onOpenChange={onModelSelectorOpenChange}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-6 px-2 py-0 text-xs font-mono uppercase tracking-wider',
              'border-muted-foreground/20 transition-colors duration-200',
              disabled
                ? 'cursor-not-allowed opacity-50'
                : 'hover:border-muted-foreground/40 hover:text-primary hover:bg-primary/10'
            )}
            disabled={disabled}
            onKeyDown={handleDropdownTriggerKeyDown}
          >
            {modelLabel(model, filteredModels)}
            {!disabled && <Pencil className="h-3 w-3 ml-1.5 opacity-50" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[120px]">
          <DropdownMenuRadioGroup value={model} onValueChange={(value) => onModelChange(value as ModelOption)}>
            {filteredModels.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className="font-mono uppercase text-xs tracking-wider"
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Effort Selector — only when capability is supported and handlers are provided */}
      {effortCapability?.supported && onEffortChange && (
        <EffortSelector
          effort={effort}
          onEffortChange={onEffortChange}
          levels={effortCapability.levels as import('@humanlayer/ai/config').EffortLevel[]}
          selectorOpen={effortSelectorOpen}
          onSelectorOpenChange={onEffortSelectorOpenChange}
          disabled={disabled}
        />
      )}

      {/* Fast Mode Toggle — only when capability is supported and handler is provided */}
      {fastModeCapability?.supported && onFastModeChange && (
        <FastModeToggle
          enabled={fastMode ?? false}
          onToggle={onFastModeChange}
          disabled={disabled}
        />
      )}
    </div>
  )
}
