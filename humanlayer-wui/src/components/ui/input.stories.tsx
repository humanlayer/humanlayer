import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import { Input } from './input'
import { Label } from './label'

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'select',
      options: [
        'text',
        'password',
        'email',
        'number',
        'tel',
        'url',
        'search',
        'date',
        'time',
        'datetime-local',
        'file',
      ],
    },
    disabled: {
      control: 'boolean',
    },
    readOnly: {
      control: 'boolean',
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

// Basic input types
export const Default: Story = {
  args: {
    placeholder: 'Enter text...',
  },
}

export const WithValue: Story = {
  args: {
    value: 'Sample text value',
    placeholder: 'Enter text...',
  },
}

export const Password: Story = {
  args: {
    type: 'password',
    placeholder: 'Enter password...',
    value: 'secretpassword',
  },
}

export const Email: Story = {
  args: {
    type: 'email',
    placeholder: 'Enter email...',
    value: 'user@example.com',
  },
}

export const Number: Story = {
  args: {
    type: 'number',
    placeholder: '42',
    min: 0,
    max: 100,
  },
}

export const SearchInput: Story = {
  args: {
    type: 'search',
    placeholder: 'Search...',
  },
}

export const URL: Story = {
  args: {
    type: 'url',
    placeholder: 'https://example.com',
  },
}

export const Tel: Story = {
  args: {
    type: 'tel',
    placeholder: '+1 (555) 123-4567',
  },
}

// Date and time inputs
export const Date: Story = {
  args: {
    type: 'date',
  },
}

export const Time: Story = {
  args: {
    type: 'time',
  },
}

export const DateTime: Story = {
  args: {
    type: 'datetime-local',
  },
}

// File input
export const File: Story = {
  args: {
    type: 'file',
  },
}

export const MultipleFiles: Story = {
  args: {
    type: 'file',
    multiple: true,
  },
}

export const FileWithAccept: Story = {
  args: {
    type: 'file',
    accept: 'image/*',
  },
}

// States
export const Disabled: Story = {
  args: {
    disabled: true,
    placeholder: 'Disabled input',
    value: 'Cannot edit this',
  },
}

export const ReadOnly: Story = {
  args: {
    readOnly: true,
    value: 'Read-only value',
  },
}

export const Required: Story = {
  args: {
    required: true,
    placeholder: 'Required field',
  },
}

// Validation states
export const Invalid: Story = {
  args: {
    'aria-invalid': true,
    value: 'invalid@',
    placeholder: 'Enter valid email',
  },
}

export const Valid: Story = {
  args: {
    value: 'user@example.com',
    className: 'border-green-500',
  },
}

// With different placeholders
export const LongPlaceholder: Story = {
  args: {
    placeholder: 'This is a very long placeholder text that might overflow',
  },
}

export const NoPlaceholder: Story = {
  args: {},
}

// Size variations (using className)
export const SmallWidth: Story = {
  args: {
    placeholder: 'Small',
    className: 'w-20',
  },
}

export const LargeWidth: Story = {
  args: {
    placeholder: 'Very long input field that spans more width',
    className: 'w-96',
  },
}

// With Label
export const WithLabel: Story = {
  render: args => (
    <div className="space-y-2">
      <Label htmlFor="input-with-label">Email Address</Label>
      <Input id="input-with-label" type="email" placeholder="Enter your email" {...args} />
    </div>
  ),
}

export const WithRequiredLabel: Story = {
  render: args => (
    <div className="space-y-2">
      <Label htmlFor="required-input">
        Password
        <span className="text-destructive ml-1">*</span>
      </Label>
      <Input id="required-input" type="password" placeholder="Enter password" required {...args} />
    </div>
  ),
}

// Form-like examples
export const LoginForm: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" placeholder="Enter your email" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" placeholder="Enter your password" />
      </div>
    </div>
  ),
}

// Validation states in form
export const ValidationStates: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <div className="space-y-2">
        <Label htmlFor="valid-input" className="text-green-600">
          Valid Email
        </Label>
        <Input id="valid-input" type="email" value="user@example.com" className="border-green-500" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invalid-input" className="text-destructive">
          Invalid Email
        </Label>
        <Input id="invalid-input" type="email" value="invalid@" aria-invalid={true} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="disabled-input">Disabled</Label>
        <Input id="disabled-input" disabled value="Cannot edit" placeholder="Disabled field" />
      </div>
    </div>
  ),
}

// Different input types showcase
export const AllTypes: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <Input type="text" placeholder="Text input" />
      <Input type="password" placeholder="Password input" />
      <Input type="email" placeholder="Email input" />
      <Input type="number" placeholder="Number input" />
      <Input type="search" placeholder="Search input" />
      <Input type="url" placeholder="URL input" />
      <Input type="tel" placeholder="Telephone input" />
      <Input type="date" />
      <Input type="time" />
      <Input type="file" />
    </div>
  ),
}
