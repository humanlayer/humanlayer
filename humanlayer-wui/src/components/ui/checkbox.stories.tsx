import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import { Checkbox } from './checkbox'
import { Label } from './label'
import { useState } from 'react'

const meta: Meta<typeof Checkbox> = {
  title: 'UI/Checkbox',
  component: Checkbox,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    checked: {
      control: 'boolean',
    },
    disabled: {
      control: 'boolean',
    },
    required: {
      control: 'boolean',
    },
  },
  args: {
    onCheckedChange: fn(),
  },
}

export default meta
type Story = StoryObj<typeof meta>

// Basic states
export const Default: Story = {
  args: {},
}

export const Checked: Story = {
  args: {
    checked: true,
  },
}

export const Unchecked: Story = {
  args: {
    checked: false,
  },
}

export const Indeterminate: Story = {
  args: {
    checked: 'indeterminate',
  },
}

// Disabled states
export const Disabled: Story = {
  args: {
    disabled: true,
  },
}

export const DisabledChecked: Story = {
  args: {
    disabled: true,
    checked: true,
  },
}

export const DisabledIndeterminate: Story = {
  args: {
    disabled: true,
    checked: 'indeterminate',
  },
}

// With labels
export const WithLabel: Story = {
  render: args => (
    <div className="flex items-center space-x-2">
      <Checkbox id="checkbox-with-label" {...args} />
      <Label htmlFor="checkbox-with-label">Accept terms and conditions</Label>
    </div>
  ),
}

export const WithLabelChecked: Story = {
  render: args => (
    <div className="flex items-center space-x-2">
      <Checkbox id="checkbox-checked" checked {...args} />
      <Label htmlFor="checkbox-checked">Email notifications enabled</Label>
    </div>
  ),
}

export const WithLabelDisabled: Story = {
  render: args => (
    <div className="flex items-center space-x-2">
      <Checkbox id="checkbox-disabled" disabled {...args} />
      <Label htmlFor="checkbox-disabled">Option not available</Label>
    </div>
  ),
}

// Required checkbox
export const Required: Story = {
  render: args => (
    <div className="flex items-center space-x-2">
      <Checkbox id="required-checkbox" required {...args} />
      <Label htmlFor="required-checkbox">
        I agree to the terms
        <span className="text-destructive ml-1">*</span>
      </Label>
    </div>
  ),
}

// Interactive example
export const Interactive: Story = {
  render: () => {
    const [checked, setChecked] = useState(false)

    return (
      <div className="flex items-center space-x-2">
        <Checkbox
          id="interactive-checkbox"
          checked={checked}
          onCheckedChange={checked => setChecked(checked === true)}
        />
        <Label htmlFor="interactive-checkbox">{checked ? 'Checked!' : 'Click to check'}</Label>
      </div>
    )
  },
}

// Form example
export const FormExample: Story = {
  render: () => {
    const [preferences, setPreferences] = useState({
      newsletter: false,
      updates: true,
      marketing: false,
    })

    const handleChange = (key: string) => (checked: boolean) => {
      setPreferences(prev => ({ ...prev, [key]: checked }))
    }

    return (
      <div className="space-y-4">
        <div className="font-medium">Email Preferences</div>
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="newsletter"
              checked={preferences.newsletter}
              onCheckedChange={handleChange('newsletter')}
            />
            <Label htmlFor="newsletter">Weekly newsletter</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="updates"
              checked={preferences.updates}
              onCheckedChange={handleChange('updates')}
            />
            <Label htmlFor="updates">Product updates</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="marketing"
              checked={preferences.marketing}
              onCheckedChange={handleChange('marketing')}
            />
            <Label htmlFor="marketing">Marketing emails</Label>
          </div>
        </div>
      </div>
    )
  },
}

// Group with indeterminate parent
export const GroupWithIndeterminate: Story = {
  render: () => {
    const [items, setItems] = useState({
      item1: false,
      item2: true,
      item3: false,
    })

    const checkedCount = Object.values(items).filter(Boolean).length
    const parentChecked = checkedCount === 3 ? true : checkedCount === 0 ? false : 'indeterminate'

    const handleParentChange = (checked: boolean | 'indeterminate') => {
      if (checked === 'indeterminate') return
      setItems({
        item1: checked,
        item2: checked,
        item3: checked,
      })
    }

    const handleItemChange = (key: string) => (checked: boolean) => {
      setItems(prev => ({ ...prev, [key]: checked }))
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox id="parent" checked={parentChecked} onCheckedChange={handleParentChange} />
          <Label htmlFor="parent" className="font-medium">
            Select All
          </Label>
        </div>
        <div className="ml-6 space-y-2">
          <div className="flex items-center space-x-2">
            <Checkbox id="item1" checked={items.item1} onCheckedChange={handleItemChange('item1')} />
            <Label htmlFor="item1">Option 1</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="item2" checked={items.item2} onCheckedChange={handleItemChange('item2')} />
            <Label htmlFor="item2">Option 2</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="item3" checked={items.item3} onCheckedChange={handleItemChange('item3')} />
            <Label htmlFor="item3">Option 3</Label>
          </div>
        </div>
      </div>
    )
  },
}

// All states showcase
export const AllStates: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="font-medium">Normal States</div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Checkbox id="unchecked" />
            <Label htmlFor="unchecked">Unchecked</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="checked" checked />
            <Label htmlFor="checked">Checked</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="indeterminate" checked="indeterminate" />
            <Label htmlFor="indeterminate">Indeterminate</Label>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="font-medium">Disabled States</div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Checkbox id="disabled-unchecked" disabled />
            <Label htmlFor="disabled-unchecked">Disabled</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="disabled-checked" disabled checked />
            <Label htmlFor="disabled-checked">Disabled Checked</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="disabled-indeterminate" disabled checked="indeterminate" />
            <Label htmlFor="disabled-indeterminate">Disabled Indeterminate</Label>
          </div>
        </div>
      </div>
    </div>
  ),
}

// Validation states
export const InvalidState: Story = {
  render: () => (
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        <Checkbox id="invalid-checkbox" aria-invalid />
        <Label htmlFor="invalid-checkbox">
          Required field
          <span className="text-destructive ml-1">*</span>
        </Label>
      </div>
      <p className="text-sm text-destructive">This field is required</p>
    </div>
  ),
}
