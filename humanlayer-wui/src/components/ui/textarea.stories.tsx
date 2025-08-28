import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import React, { useState } from 'react'
import { Textarea } from './textarea'
import { Label } from './label'
import { Button } from './button'

const meta: Meta<typeof Textarea> = {
  title: 'UI/Textarea',
  component: Textarea,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    disabled: {
      control: 'boolean',
    },
    readOnly: {
      control: 'boolean',
    },
    required: {
      control: 'boolean',
    },
    rows: {
      control: 'number',
    },
  },
  args: {
    onChange: fn(),
    onFocus: fn(),
    onBlur: fn(),
  },
}

export default meta
type Story = StoryObj<typeof meta>

// Basic textarea
export const Default: Story = {
  args: {
    placeholder: 'Enter your message...',
  },
}

export const WithValue: Story = {
  args: {
    defaultValue: 'This is some sample text in the textarea component.',
    placeholder: 'Enter your message...',
  },
}

// Different sizes
export const SmallRows: Story = {
  args: {
    rows: 2,
    placeholder: 'Small textarea (2 rows)',
  },
}

export const MediumRows: Story = {
  args: {
    rows: 4,
    placeholder: 'Medium textarea (4 rows)',
  },
}

export const LargeRows: Story = {
  args: {
    rows: 8,
    placeholder: 'Large textarea (8 rows)',
  },
}

// States
export const Disabled: Story = {
  args: {
    disabled: true,
    defaultValue: 'This textarea is disabled and cannot be edited.',
  },
}

export const ReadOnly: Story = {
  args: {
    readOnly: true,
    defaultValue: 'This textarea is read-only. You can select and copy the text, but cannot edit it.',
  },
}

export const Required: Story = {
  args: {
    required: true,
    placeholder: 'This field is required',
  },
}

// Validation states
export const Invalid: Story = {
  args: {
    'aria-invalid': true,
    defaultValue: 'This text is invalid according to validation rules.',
    placeholder: 'Enter valid text',
  },
}

export const Valid: Story = {
  args: {
    defaultValue: 'This is valid text that meets all requirements.',
    className: 'border-green-500',
  },
}

// With label
export const WithLabel: Story = {
  render: args => (
    <div className="space-y-2 w-80">
      <Label htmlFor="textarea-with-label">Message</Label>
      <Textarea id="textarea-with-label" placeholder="Enter your message" {...args} />
    </div>
  ),
}

export const WithRequiredLabel: Story = {
  render: args => (
    <div className="space-y-2 w-80">
      <Label htmlFor="required-textarea">
        Feedback
        <span className="text-destructive ml-1">*</span>
      </Label>
      <Textarea id="required-textarea" placeholder="Please provide your feedback" required {...args} />
    </div>
  ),
}

// With helper text
export const WithHelperText: Story = {
  render: args => (
    <div className="space-y-2 w-80">
      <Label htmlFor="helper-textarea">Description</Label>
      <Textarea id="helper-textarea" placeholder="Describe your project" {...args} />
      <p className="text-sm text-muted-foreground">
        Provide a detailed description of your project (min 50 characters)
      </p>
    </div>
  ),
}

// Character counter
export const WithCharacterCounter: Story = {
  render: () => {
    const [value, setValue] = useState('')
    const maxLength = 200

    return (
      <div className="space-y-2 w-80">
        <Label htmlFor="counter-textarea">Bio</Label>
        <Textarea
          id="counter-textarea"
          placeholder="Tell us about yourself"
          value={value}
          onChange={e => setValue(e.target.value)}
          maxLength={maxLength}
        />
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Tell us about yourself in a few words</span>
          <span>
            {value.length}/{maxLength}
          </span>
        </div>
      </div>
    )
  },
}

// Form example
export const FormExample: Story = {
  render: () => (
    <div className="space-y-4 w-96">
      <div className="space-y-2">
        <Label htmlFor="form-title">Title</Label>
        <input
          id="form-title"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Enter title"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="form-description">
          Description
          <span className="text-destructive ml-1">*</span>
        </Label>
        <Textarea
          id="form-description"
          placeholder="Provide a detailed description"
          rows={4}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="form-notes">Additional Notes</Label>
        <Textarea id="form-notes" placeholder="Any additional information (optional)" rows={3} />
      </div>

      <div className="flex gap-2">
        <Button variant="outline">Cancel</Button>
        <Button>Submit</Button>
      </div>
    </div>
  ),
}

// Auto-resize simulation
export const AutoResize: Story = {
  render: () => {
    const [value, setValue] = useState('')

    return (
      <div className="space-y-2 w-80">
        <Label htmlFor="auto-resize">Auto-expanding Content</Label>
        <Textarea
          id="auto-resize"
          placeholder="Type multiple lines to see expansion..."
          value={value}
          onChange={e => setValue(e.target.value)}
          rows={Math.max(3, value.split('\n').length)}
        />
        <p className="text-sm text-muted-foreground">This textarea expands as you add more lines</p>
      </div>
    )
  },
}

// Different widths
export const CustomWidths: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Small Width</Label>
        <Textarea className="w-48" placeholder="Small width textarea" rows={3} />
      </div>

      <div className="space-y-2">
        <Label>Medium Width</Label>
        <Textarea className="w-80" placeholder="Medium width textarea" rows={3} />
      </div>

      <div className="space-y-2">
        <Label>Large Width</Label>
        <Textarea className="w-96" placeholder="Large width textarea" rows={3} />
      </div>
    </div>
  ),
}

// With validation
export const WithValidation: Story = {
  render: () => {
    const [value, setValue] = useState('')
    const [error, setError] = useState('')

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      setValue(newValue)

      if (newValue.length < 10) {
        setError('Message must be at least 10 characters long')
      } else if (newValue.length > 100) {
        setError('Message must not exceed 100 characters')
      } else {
        setError('')
      }
    }

    return (
      <div className="space-y-2 w-80">
        <Label htmlFor="validation-textarea">
          Message
          <span className="text-destructive ml-1">*</span>
        </Label>
        <Textarea
          id="validation-textarea"
          placeholder="Enter your message (10-100 characters)"
          value={value}
          onChange={handleChange}
          aria-invalid={!!error}
          className={error ? 'border-destructive' : ''}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-sm text-muted-foreground">{value.length}/100 characters</p>
      </div>
    )
  },
}

// Long content
export const LongContent: Story = {
  args: {
    defaultValue: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.`,
    rows: 6,
  },
}

// Code input
export const CodeInput: Story = {
  render: args => (
    <div className="space-y-2 w-96">
      <Label htmlFor="code-textarea">Code Snippet</Label>
      <Textarea
        id="code-textarea"
        placeholder="Enter your code here..."
        className="font-mono text-sm"
        rows={8}
        defaultValue={`function hello() {
  console.log("Hello, World!");
  return true;
}`}
        {...args}
      />
    </div>
  ),
}

// All states showcase
export const AllStates: Story = {
  render: () => (
    <div className="space-y-6 w-80">
      <div className="space-y-2">
        <Label>Normal</Label>
        <Textarea placeholder="Normal textarea" />
      </div>

      <div className="space-y-2">
        <Label>With Value</Label>
        <Textarea defaultValue="This textarea has a default value" />
      </div>

      <div className="space-y-2">
        <Label>Disabled</Label>
        <Textarea disabled defaultValue="This textarea is disabled" />
      </div>

      <div className="space-y-2">
        <Label>Read Only</Label>
        <Textarea readOnly defaultValue="This textarea is read-only" />
      </div>

      <div className="space-y-2">
        <Label>Invalid</Label>
        <Textarea aria-invalid defaultValue="This content is invalid" className="border-destructive" />
        <p className="text-sm text-destructive">Please enter valid content</p>
      </div>
    </div>
  ),
}
