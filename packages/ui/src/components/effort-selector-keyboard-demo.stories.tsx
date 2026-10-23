import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { CLAUDE_EFFORT_LEVELS_BY_MODEL, type EffortLevel } from '@humanlayer/ai/config'
import { expect, userEvent, within } from 'storybook/test'
import { EffortSelector } from './effort-selector'

const SELECTOR_KEYS = ['Enter', ' ', 'ArrowDown', 'ArrowUp']

function EffortSelectorKeyboardDemo() {
  const [effort, setEffort] = useState<EffortLevel>('high')
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [parentKeyEvents, setParentKeyEvents] = useState(0)

  return (
    <div
      className="flex flex-col gap-3 rounded-md border p-4"
      onKeyDown={(event) => {
        if (SELECTOR_KEYS.includes(event.key)) {
          setParentKeyEvents((count) => count + 1)
        }
      }}
    >
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Dropdown is {selectorOpen ? 'open' : 'closed'}</p>
        <p>Parent key events: {parentKeyEvents}</p>
      </div>
      <EffortSelector
        effort={effort}
        levels={CLAUDE_EFFORT_LEVELS_BY_MODEL['claude-opus-4-7']}
        onEffortChange={(next) => setEffort(next as EffortLevel)}
        selectorOpen={selectorOpen}
        onSelectorOpenChange={setSelectorOpen}
      />
    </div>
  )
}

const meta = {
  title: 'Shell Demos/EffortSelectorKeyboard',
  component: EffortSelectorKeyboardDemo,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof EffortSelectorKeyboardDemo>

export default meta
type Story = StoryObj<typeof meta>

export const ControlledTriggerKeyboardHandling: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: /high/i })

    trigger.focus()
    await userEvent.keyboard('{Enter}')

    await expect(canvas.findByText('Dropdown is open')).resolves.toBeInTheDocument()
    await expect(canvas.getByText('Parent key events: 0')).toBeInTheDocument()
  },
}
