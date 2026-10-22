import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import {
  CLAUDE_EFFORT_LEVELS_BY_MODEL,
  CODEX_REASONING_LEVELS_BY_MODEL,
  getDefaultEffort,
  getEffortCapability,
  getFastModeCapability,
} from '@humanlayer/ai/config'
import { StatusBar, type SessionStatus, type ModelOption } from './status-bar'

const meta: Meta = {
  title: 'Shell Demos/StatusBar',
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[500px] border rounded-lg overflow-hidden">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

// Interactive wrapper with uncontrolled dropdown (default behavior)
const StatusBarWrapper = ({ status = 'draft' }: { status?: SessionStatus }) => {
  const [model, setModel] = useState<ModelOption>('sonnet')
  return <StatusBar status={status} model={model} onModelChange={setModel} />
}

// Interactive wrapper with controlled dropdown state (for hotkey control)
const ControlledStatusBarWrapper = ({ status = 'draft' }: { status?: SessionStatus }) => {
  const [model, setModel] = useState<ModelOption>('claude-sonnet-5')
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)

  return (
    <div className="space-y-2">
      <StatusBar
        status={status}
        model={model}
        onModelChange={setModel}
        modelSelectorOpen={modelSelectorOpen}
        onModelSelectorOpenChange={setModelSelectorOpen}
      />
      <div className="text-xs text-muted-foreground">
        Dropdown is {modelSelectorOpen ? 'open' : 'closed'}.{' '}
        <button
          type="button"
          className="underline"
          onClick={() => setModelSelectorOpen((prev) => !prev)}
        >
          Toggle programmatically
        </button>
      </div>
    </div>
  )
}

// Interactive wrapper with effort + fast mode controls
const StatusBarWithEffortWrapper = ({ initialModel = 'claude-sonnet-5' as ModelOption }) => {
  const [model, setModel] = useState<ModelOption>(initialModel)
  const [effort, setEffort] = useState<string | undefined>(() =>
    getDefaultEffort('claude', 'anthropic', initialModel),
  )
  const [fastMode, setFastMode] = useState(false)

  const effortCapability = getEffortCapability('claude', 'anthropic', model)
  const fastModeCapability = getFastModeCapability('claude', 'anthropic', model)

  // When switching models, fall back to the agent's default effort if the current value isn't supported.
  if (
    effortCapability.supported &&
    (effort === undefined || !effortCapability.levels.includes(effort as never))
  ) {
    setEffort(getDefaultEffort('claude', 'anthropic', model))
  }

  return (
    <StatusBar
      status="draft"
      model={model}
      onModelChange={setModel}
      agent="claude"
      effort={effort}
      onEffortChange={setEffort}
      effortCapability={effortCapability}
      fastMode={fastMode}
      onFastModeChange={setFastMode}
      fastModeCapability={fastModeCapability}
    />
  )
}

export const Draft: Story = {
  render: () => <StatusBarWrapper status="draft" />,
}

export const Running: Story = {
  render: () => <StatusBarWrapper status="running" />,
}

export const ReadyForInput: Story = {
  render: () => <StatusBarWrapper status="ready_for_input" />,
}

export const Failed: Story = {
  render: () => <StatusBarWrapper status="failed" />,
}

export const Interrupted: Story = {
  render: () => <StatusBarWrapper status="interrupted" />,
}

export const CustomStatusText: Story = {
  render: () => (
    <StatusBar
      status="draft"
      statusText="Ready to launch"
      model="opus"
      onModelChange={() => console.log('Model changed')}
    />
  ),
}

export const Disabled: Story = {
  render: () => (
    <StatusBar
      status="running"
      model="claude-sonnet-5"
      onModelChange={() => console.log('Model changed')}
      disabled={true}
    />
  ),
}

export const ControlledDropdown: Story = {
  render: () => <ControlledStatusBarWrapper status="draft" />,
}

export const WithEffortAndFastMode: Story = {
  render: () => <StatusBarWithEffortWrapper initialModel="claude-sonnet-5" />,
}

export const WithEffortOpus47Full: Story = {
  render: () => (
    <StatusBar
      status="draft"
      model="claude-opus-4-7"
      onModelChange={() => {}}
      agent="claude"
      effort="xhigh"
      onEffortChange={() => {}}
      effortCapability={{ supported: true, levels: CLAUDE_EFFORT_LEVELS_BY_MODEL['claude-opus-4-7'] ?? [] }}
      fastMode={false}
      onFastModeChange={() => {}}
      fastModeCapability={{ supported: true }}
    />
  ),
}

export const WithEffortSonnet5Full: Story = {
  render: () => (
    <StatusBar
      status="draft"
      model="claude-sonnet-5"
      onModelChange={() => {}}
      agent="claude"
      effort="xhigh"
      onEffortChange={() => {}}
      effortCapability={{ supported: true, levels: CLAUDE_EFFORT_LEVELS_BY_MODEL['claude-sonnet-5'] ?? [] }}
      fastMode={false}
      onFastModeChange={() => {}}
      fastModeCapability={{ supported: false }}
    />
  ),
}

export const WithEffortOpus45BaseOnly: Story = {
  render: () => (
    <StatusBar
      status="draft"
      model="claude-opus-4-5"
      onModelChange={() => {}}
      agent="claude"
      effort="high"
      onEffortChange={() => {}}
      effortCapability={{ supported: true, levels: CLAUDE_EFFORT_LEVELS_BY_MODEL['claude-opus-4-5'] ?? [] }}
      fastMode={false}
      onFastModeChange={() => {}}
      fastModeCapability={{ supported: false }}
    />
  ),
}

// Capability Matrix Story — renders StatusBar for every (agent × model) in the capability tables
// so a reviewer can visually confirm gating matches Phase 1 results
export const CapabilityMatrixStory: Story = {
  decorators: [
    (Story) => (
      <div className="w-full max-w-4xl border rounded-lg overflow-hidden">
        <Story />
      </div>
    ),
  ],
  render: () => {
    const claudeRows = Object.entries(CLAUDE_EFFORT_LEVELS_BY_MODEL).map(([model, levels]) => ({
      agent: 'claude' as const,
      provider: 'anthropic',
      model: model as ModelOption,
      effortCapability: { supported: true as const, levels },
      fastModeCapability: getFastModeCapability('claude', 'anthropic', model),
    }))

    const codexRows = Object.entries(CODEX_REASONING_LEVELS_BY_MODEL).map(([model, levels]) => ({
      agent: 'codelayer' as const,
      provider: 'codex',
      model: model as ModelOption,
      effortCapability: { supported: true as const, levels },
      fastModeCapability: getFastModeCapability('codelayer', 'codex', model),
    }))

    const allRows = [...claudeRows, ...codexRows]

    return (
      <div className="flex flex-col divide-y">
        <div className="px-3 py-2 text-xs font-mono uppercase tracking-wider text-muted-foreground bg-muted/30">
          Capability Matrix — {allRows.length} model configurations
        </div>
        {allRows.map(({ agent, provider, model, effortCapability, fastModeCapability }) => (
          <div key={`${agent}-${provider}-${model}`} className="px-3 py-2">
            <div className="text-xs text-muted-foreground font-mono mb-1">
              {agent}/{provider}/{model}
            </div>
            <StatusBar
              status="draft"
              model={model}
              onModelChange={() => {}}
              agent={agent}
              effort={effortCapability.levels[2] as string}
              onEffortChange={() => {}}
              effortCapability={effortCapability}
              fastMode={false}
              onFastModeChange={() => {}}
              fastModeCapability={fastModeCapability}
            />
          </div>
        ))}
      </div>
    )
  },
}
