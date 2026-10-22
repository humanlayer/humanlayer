import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { CLAUDE_EFFORT_LEVELS_BY_MODEL, getDefaultEffort, getEffortCapability } from '@humanlayer/ai/config'
import { EffortSelector } from './effort-selector'

const meta: Meta<typeof EffortSelector> = {
  title: 'UI/EffortSelector',
  component: EffortSelector,
  parameters: {
    layout: 'centered',
  },
}
export default meta
type Story = StoryObj<typeof EffortSelector>

export const Opus47Full: Story = {
  args: {
    effort: 'high',
    levels: CLAUDE_EFFORT_LEVELS_BY_MODEL['claude-opus-4-7'],
    onEffortChange: () => {},
  },
}

export const Sonnet5Full: Story = {
  args: {
    effort: 'xhigh',
    levels: CLAUDE_EFFORT_LEVELS_BY_MODEL['claude-sonnet-5'],
    onEffortChange: () => {},
  },
}

export const Opus45BaseOnly: Story = {
  args: {
    effort: 'high',
    levels: CLAUDE_EFFORT_LEVELS_BY_MODEL['claude-opus-4-5'],
    onEffortChange: () => {},
  },
}

export const Disabled: Story = {
  args: {
    effort: 'high',
    levels: CLAUDE_EFFORT_LEVELS_BY_MODEL['claude-opus-4-7'],
    onEffortChange: () => {},
    disabled: true,
  },
}

export const NoEffortSelected: Story = {
  args: {
    effort: null,
    levels: CLAUDE_EFFORT_LEVELS_BY_MODEL['claude-opus-4-7'],
    onEffortChange: () => {},
  },
}

// Shell Demo — switching models falls back to the agent's default effort
export const WithModelFallbackToDefault: StoryObj<typeof EffortSelector> = {
  render: () => {
    const [model, setModel] = useState('claude-sonnet-5')
    const [effort, setEffort] = useState<string | undefined>(
      getDefaultEffort('claude', 'anthropic', 'claude-sonnet-5'),
    )
    const cap = getEffortCapability('claude', 'anthropic', model)
    // When the current effort isn't supported by the new model, fall back to the default.
    if (cap.supported && effort && !cap.levels.includes(effort as never)) {
      setEffort(getDefaultEffort('claude', 'anthropic', model))
    }
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-2 items-center">
          <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Model:
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-xs font-mono border rounded px-2 py-1"
          >
            {Object.keys(CLAUDE_EFFORT_LEVELS_BY_MODEL).map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 items-center">
          <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Effort:
          </label>
          {cap.supported ? (
            <EffortSelector effort={effort} levels={cap.levels} onEffortChange={setEffort} />
          ) : (
            <span className="text-xs text-muted-foreground font-mono">Not supported for this model</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          Current effort: <span className="font-mono">{effort ?? 'none'}</span>
          {' '}(switch to claude-opus-4-5 with xhigh selected to see it fall back to 'high')
        </div>
      </div>
    )
  },
}
WithModelFallbackToDefault.storyName = 'Shell Demo — Falls Back To Default On Model Switch'
