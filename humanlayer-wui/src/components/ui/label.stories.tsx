import type { Meta, StoryObj } from '@storybook/react'
import { Label } from './label'
import { Input } from './input'
import { Checkbox } from './checkbox'
import { Textarea } from './textarea'
import { Asterisk, Info } from 'lucide-react'

const meta: Meta<typeof Label> = {
  title: 'UI/Label',
  component: Label,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    htmlFor: {
      control: 'text',
    },
  },
}

export default meta
type Story = StoryObj<typeof meta>

// Basic label
export const Default: Story = {
  args: {
    children: 'Label Text',
  },
}

export const WithHtmlFor: Story = {
  args: {
    htmlFor: 'example-input',
    children: 'Email Address',
  },
}

// Labels with form controls
export const WithInput: Story = {
  render: () => (
    <div className="space-y-2">
      <Label htmlFor="input-example">Username</Label>
      <Input id="input-example" placeholder="Enter username" />
    </div>
  ),
}

export const WithCheckbox: Story = {
  render: () => (
    <div className="flex items-center space-x-2">
      <Checkbox id="checkbox-example" />
      <Label htmlFor="checkbox-example">Accept terms and conditions</Label>
    </div>
  ),
}

export const WithTextarea: Story = {
  render: () => (
    <div className="space-y-2">
      <Label htmlFor="textarea-example">Description</Label>
      <Textarea id="textarea-example" placeholder="Enter description" />
    </div>
  ),
}

// Required field indicator
export const Required: Story = {
  args: {
    children: (
      <>
        Password
        <span className="text-destructive ml-1">*</span>
      </>
    ),
  },
}

export const RequiredWithInput: Story = {
  render: () => (
    <div className="space-y-2">
      <Label htmlFor="required-input">
        Email Address
        <span className="text-destructive ml-1">*</span>
      </Label>
      <Input id="required-input" type="email" placeholder="Enter email" required />
    </div>
  ),
}

// With icons
export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Info className="h-4 w-4" />
        Information
      </>
    ),
  },
}

export const WithIconAndRequired: Story = {
  args: {
    children: (
      <>
        <Info className="h-4 w-4" />
        Important Field
        <Asterisk className="h-3 w-3 text-destructive" />
      </>
    ),
  },
}

// Different content types
export const LongText: Story = {
  args: {
    children: 'This is a very long label text that might wrap to multiple lines',
  },
}

export const ShortText: Story = {
  args: {
    children: 'Name',
  },
}

export const WithDescription: Story = {
  render: () => (
    <div className="space-y-2 max-w-sm">
      <Label htmlFor="described-input">
        API Key
        <span className="text-destructive ml-1">*</span>
      </Label>
      <Input id="described-input" type="password" placeholder="Enter API key" />
      <p className="text-sm text-muted-foreground">You can find your API key in the settings page</p>
    </div>
  ),
}

// Disabled state
export const Disabled: Story = {
  render: () => (
    <div className="space-y-2" data-disabled="true">
      <Label htmlFor="disabled-input">Disabled Field</Label>
      <Input id="disabled-input" disabled placeholder="Cannot edit this" />
    </div>
  ),
}

export const DisabledCheckbox: Story = {
  render: () => (
    <div className="flex items-center space-x-2">
      <Checkbox id="disabled-checkbox" disabled />
      <Label htmlFor="disabled-checkbox">Disabled option</Label>
    </div>
  ),
}

// Form examples
export const LoginForm: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <div className="space-y-2">
        <Label htmlFor="login-email">
          Email
          <span className="text-destructive ml-1">*</span>
        </Label>
        <Input id="login-email" type="email" placeholder="Enter your email" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="login-password">
          Password
          <span className="text-destructive ml-1">*</span>
        </Label>
        <Input id="login-password" type="password" placeholder="Enter password" />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox id="remember-me" />
        <Label htmlFor="remember-me">Remember me</Label>
      </div>
    </div>
  ),
}

export const ProfileForm: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <div className="space-y-2">
        <Label htmlFor="profile-name">
          Full Name
          <span className="text-destructive ml-1">*</span>
        </Label>
        <Input id="profile-name" placeholder="John Doe" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="profile-email">Email</Label>
        <Input id="profile-email" type="email" placeholder="john@example.com" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="profile-bio">Bio</Label>
        <Textarea id="profile-bio" placeholder="Tell us about yourself" />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox id="newsletter" />
        <Label htmlFor="newsletter">Subscribe to newsletter</Label>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox id="public-profile" />
        <Label htmlFor="public-profile">Make profile public</Label>
      </div>
    </div>
  ),
}

// Accessibility examples
export const AccessibilityExample: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <div className="space-y-2">
        <Label htmlFor="accessible-input">
          Phone Number
          <span className="text-destructive ml-1" aria-label="required">
            *
          </span>
        </Label>
        <Input
          id="accessible-input"
          type="tel"
          placeholder="+1 (555) 123-4567"
          aria-describedby="phone-help"
        />
        <p id="phone-help" className="text-sm text-muted-foreground">
          Include your country code
        </p>
      </div>
    </div>
  ),
}
