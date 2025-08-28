import type { Meta, StoryObj } from '@storybook/react'
import { Alert, AlertDescription, AlertTitle } from './alert'
import { AlertCircle, CheckCircle, Info, AlertTriangle, Terminal } from 'lucide-react'

const meta: Meta<typeof Alert> = {
  title: 'UI/Alert',
  component: Alert,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive'],
    },
  },
}

export default meta
type Story = StoryObj<typeof meta>

// Basic variants
export const Default: Story = {
  args: {
    children: (
      <>
        <Info className="h-4 w-4" />
        <AlertTitle>Heads up!</AlertTitle>
        <AlertDescription>You can add components to your app using the cli.</AlertDescription>
      </>
    ),
  },
}

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: (
      <>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Your session has expired. Please log in again.</AlertDescription>
      </>
    ),
  },
}

// Without icons
export const WithoutIcon: Story = {
  args: {
    children: (
      <>
        <AlertTitle>Information</AlertTitle>
        <AlertDescription>This is an alert without an icon.</AlertDescription>
      </>
    ),
  },
}

export const DestructiveWithoutIcon: Story = {
  args: {
    variant: 'destructive',
    children: (
      <>
        <AlertTitle>Warning</AlertTitle>
        <AlertDescription>
          This action cannot be undone. This will permanently delete your account.
        </AlertDescription>
      </>
    ),
  },
}

// Title only
export const TitleOnly: Story = {
  args: {
    children: (
      <>
        <CheckCircle className="h-4 w-4" />
        <AlertTitle>Success! Your changes have been saved.</AlertTitle>
      </>
    ),
  },
}

export const TitleOnlyDestructive: Story = {
  args: {
    variant: 'destructive',
    children: (
      <>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Failed to save changes</AlertTitle>
      </>
    ),
  },
}

// Description only
export const DescriptionOnly: Story = {
  args: {
    children: (
      <>
        <Info className="h-4 w-4" />
        <AlertDescription>
          We've sent you an email with a link to update your password.
        </AlertDescription>
      </>
    ),
  },
}

// Different icons for different purposes
export const InfoAlert: Story = {
  args: {
    children: (
      <>
        <Info className="h-4 w-4" />
        <AlertTitle>Information</AlertTitle>
        <AlertDescription>
          Your API key will expire in 7 days. Consider renewing it soon.
        </AlertDescription>
      </>
    ),
  },
}

export const SuccessAlert: Story = {
  args: {
    children: (
      <>
        <CheckCircle className="h-4 w-4" />
        <AlertTitle>Success</AlertTitle>
        <AlertDescription>Your profile has been updated successfully.</AlertDescription>
      </>
    ),
  },
}

export const WarningAlert: Story = {
  args: {
    children: (
      <>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Warning</AlertTitle>
        <AlertDescription>
          You have reached 80% of your storage limit. Consider upgrading your plan.
        </AlertDescription>
      </>
    ),
  },
}

export const ErrorAlert: Story = {
  args: {
    variant: 'destructive',
    children: (
      <>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Failed to load data. Please try again later.</AlertDescription>
      </>
    ),
  },
}

export const TerminalAlert: Story = {
  args: {
    children: (
      <>
        <Terminal className="h-4 w-4" />
        <AlertTitle>Command executed</AlertTitle>
        <AlertDescription>
          The build process completed successfully. Check the output logs for details.
        </AlertDescription>
      </>
    ),
  },
}

// Long content
export const LongContent: Story = {
  args: {
    children: (
      <>
        <Info className="h-4 w-4" />
        <AlertTitle>Important Update</AlertTitle>
        <AlertDescription>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut
          labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
          laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in
          voluptate velit esse cillum dolore eu fugiat nulla pariatur.
        </AlertDescription>
      </>
    ),
  },
}

// With custom styling
export const CustomWidth: Story = {
  args: {
    className: 'w-96',
    children: (
      <>
        <Info className="h-4 w-4" />
        <AlertTitle>Custom Width</AlertTitle>
        <AlertDescription>This alert has a custom width applied via className.</AlertDescription>
      </>
    ),
  },
}

// Multiple alerts showcase
export const MultipleAlerts: Story = {
  render: () => (
    <div className="space-y-4 w-96">
      <Alert>
        <CheckCircle className="h-4 w-4" />
        <AlertTitle>Success</AlertTitle>
        <AlertDescription>Your changes have been saved.</AlertDescription>
      </Alert>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Info</AlertTitle>
        <AlertDescription>New features are now available.</AlertDescription>
      </Alert>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Warning</AlertTitle>
        <AlertDescription>Your session will expire soon.</AlertDescription>
      </Alert>

      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Something went wrong.</AlertDescription>
      </Alert>
    </div>
  ),
}

// Minimal examples
export const MinimalInfo: Story = {
  args: {
    children: <AlertDescription>Quick info message</AlertDescription>,
  },
}

export const MinimalError: Story = {
  args: {
    variant: 'destructive',
    children: <AlertDescription>Something went wrong</AlertDescription>,
  },
}
