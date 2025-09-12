import type { Meta, StoryObj } from '@storybook/react'
import { CodeLayerToaster } from './CodeLayerToaster'
import { CodeLayerToastButtons } from './CodeLayerToastButtons'
import { Button } from '../ui/button'
import { toast } from 'sonner'

// Define custom args type for stories that don't use component props
type CodeLayerToasterArgs = {
  // Empty for stories that don't need args
}

// Meta with args type
const meta = {
  title: 'Internal/CodeLayerToaster',
  component: CodeLayerToaster,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    Story => (
      <div className="min-h-screen p-8 bg-background text-foreground">
        <Story />
        <CodeLayerToaster />
      </div>
    ),
  ],
} satisfies Meta<CodeLayerToasterArgs>

export default meta
type Story = StoryObj<typeof meta>

// Interactive toast demo
export const Interactive: Story = {
  render: () => (
    <div className="flex flex-col gap-4 max-w-2xl">
      <h2 className="text-lg font-mono uppercase">Toast Notifications Demo</h2>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => toast.success('Operation completed successfully')} variant="outline">
          Success Toast
        </Button>

        <Button onClick={() => toast.error('Failed to connect to server')} variant="outline">
          Error Toast
        </Button>

        <Button onClick={() => toast.warning('Low memory warning')} variant="outline">
          Warning Toast
        </Button>

        <Button onClick={() => toast.info('New update available')} variant="outline">
          Info Toast
        </Button>

        <Button
          onClick={() => {
            const loadingToast = toast.loading('Processing request...')
            setTimeout(() => {
              toast.success('Request completed!', {
                id: loadingToast,
              })
            }, 2000)
          }}
          variant="outline"
        >
          Loading → Success
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            toast('Default toast without type', {
              description: 'This is a description text that provides more context',
            })
          }
          variant="secondary"
        >
          With Description
        </Button>

        <Button
          onClick={() =>
            toast.success('File uploaded', {
              action: {
                label: 'View',
                onClick: () => console.log('View clicked'),
              },
            })
          }
          variant="secondary"
        >
          With Action
        </Button>

        <Button
          onClick={() =>
            toast.error('Delete failed', {
              action: {
                label: 'Retry',
                onClick: () => toast.success('Retry successful!'),
              },
              cancel: {
                label: 'Cancel',
                onClick: () => console.log('Cancelled'),
              },
            })
          }
          variant="secondary"
        >
          With Actions
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            toast.success('Toast 1')
            toast.error('Toast 2')
            toast.warning('Toast 3')
            toast.info('Toast 4')
          }}
          variant="ghost"
        >
          Multiple Toasts
        </Button>

        <Button
          onClick={() => {
            const promise = new Promise(resolve => {
              setTimeout(() => resolve({ name: 'Task' }), 2000)
            })

            toast.promise(promise, {
              loading: 'Loading task...',
              success: (data: any) => `${data.name} completed!`,
              error: 'Task failed',
            })
          }}
          variant="ghost"
        >
          Promise Toast
        </Button>
      </div>

      <div className="mt-8 p-4 border border-border rounded font-mono text-xs">
        <p className="text-muted-foreground mb-2">&gt; TOAST TYPES:</p>
        <ul className="space-y-1 ml-4">
          <li>• SUCCESS - Green themed for positive actions</li>
          <li>• ERROR - Red themed for failures</li>
          <li>• WARNING - Yellow themed for cautions</li>
          <li>• INFO - Accent themed for information</li>
          <li>• LOADING - Muted theme for pending states</li>
        </ul>
        <p className="text-muted-foreground mt-2">&gt; Click buttons to trigger toasts_</p>
      </div>
    </div>
  ),
}

// Showcase all toast variants at once
export const AllVariants: Story = {
  render: () => {
    // Trigger all toasts on mount
    setTimeout(() => {
      toast.success('Success: Operation completed')
      setTimeout(() => toast.error('Error: Connection failed'), 100)
      setTimeout(() => toast.warning('Warning: Low disk space'), 200)
      setTimeout(() => toast.info('Info: Update available'), 300)
      setTimeout(() => toast.loading('Loading: Please wait...'), 400)
      setTimeout(() => toast('Default toast message'), 500)
    }, 500)

    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center font-mono">
          <p className="text-muted-foreground mb-4">&gt; DISPLAYING ALL TOAST VARIANTS</p>
          <Button
            onClick={() => {
              toast.success('Success: Operation completed')
              setTimeout(() => toast.error('Error: Connection failed'), 100)
              setTimeout(() => toast.warning('Warning: Low disk space'), 200)
              setTimeout(() => toast.info('Info: Update available'), 300)
              setTimeout(() => toast.loading('Loading: Please wait...'), 400)
              setTimeout(() => toast('Default toast message'), 500)
            }}
            variant="outline"
          >
            SHOW ALL TOASTS
          </Button>
        </div>
      </div>
    )
  },
}

// Define types for Playground args
interface ToasterArgs {
  type: 'default' | 'success' | 'error' | 'warning' | 'info' | 'loading'
  message: string
  description: string
  dismissableOnly: boolean
  duration: number
  position: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
  showAction: boolean
  actionLabel: string
  showCancel: boolean
  cancelLabel: string
  closeButton: boolean
}

// Create a typed story for Playground with custom args
type PlaygroundStory = StoryObj<Meta<ToasterArgs>>

// Interactive playground with controls
export const Playground: PlaygroundStory = {
  argTypes: {
    type: {
      control: 'select',
      options: ['default', 'success', 'error', 'warning', 'info', 'loading'],
      description: 'Toast notification type',
    },
    message: {
      control: 'text',
      description: 'Main toast message',
    },
    description: {
      control: 'text',
      description: 'Optional description text',
    },
    dismissableOnly: {
      control: 'boolean',
      description: 'Toast stays until manually dismissed',
    },
    duration: {
      control: { type: 'range', min: 1000, max: 10000, step: 500 },
      description: 'Duration in milliseconds (ignored if dismissableOnly is true)',
      if: { arg: 'dismissableOnly', truthy: false },
    },
    position: {
      control: 'select',
      options: ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'],
      description: 'Toast position on screen',
    },
    showAction: {
      control: 'boolean',
      description: 'Show action button',
    },
    actionLabel: {
      control: 'text',
      description: 'Action button label',
      if: { arg: 'showAction', truthy: true },
    },
    showCancel: {
      control: 'boolean',
      description: 'Show cancel button (requires action button)',
      if: { arg: 'showAction', truthy: true },
    },
    cancelLabel: {
      control: 'text',
      description: 'Cancel button label',
      if: { arg: 'showCancel', truthy: true },
    },
    closeButton: {
      control: 'boolean',
      description: 'Show close button',
    },
  },
  args: {
    type: 'default',
    message: 'Hello from CodeLayer!',
    description: '',
    dismissableOnly: false,
    duration: 4000,
    position: 'bottom-right',
    showAction: false,
    actionLabel: 'UNDO',
    showCancel: false,
    cancelLabel: 'CANCEL',
    closeButton: true,
  },
  render: args => {
    const triggerToast = () => {
      const toastOptions: any = {
        description: args.description || undefined,
        duration: args.dismissableOnly ? Infinity : args.duration,
        position: args.position,
        closeButton: args.closeButton,
      }

      // Use CodeLayerToastButtons wrapper for better button layout
      if (args.showAction) {
        const action = {
          label: args.actionLabel,
          onClick: () => {
            console.log('Action clicked!')
            toast.success('Action executed!')
          },
        }
        
        const cancel = args.showCancel
          ? {
              label: args.cancelLabel,
              onClick: () => {
                console.log('Cancel clicked!')
                toast.info('Action cancelled')
              },
            }
          : undefined

        toastOptions.action = (
          <CodeLayerToastButtons
            action={action}
            cancel={cancel}
            variant={args.type === 'loading' ? 'default' : args.type}
          />
        )
      }

      switch (args.type) {
        case 'success':
          toast.success(args.message, toastOptions)
          break
        case 'error':
          toast.error(args.message, toastOptions)
          break
        case 'warning':
          toast.warning(args.message, toastOptions)
          break
        case 'info':
          toast.info(args.message, toastOptions)
          break
        case 'loading':
          toast.loading(args.message, toastOptions)
          break
        default:
          toast(args.message, toastOptions)
      }
    }

    return (
      <div className="flex flex-col gap-4 max-w-2xl">
        <h2 className="text-lg font-mono uppercase">Toast Playground</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Use the controls panel to configure your toast, then click the button to trigger it.
        </p>

        <div className="flex gap-2">
          <Button onClick={triggerToast} variant="outline">
            TRIGGER TOAST
          </Button>

          <Button onClick={() => toast.dismiss()} variant="ghost">
            DISMISS ALL
          </Button>
        </div>

        <div className="text-xs text-muted-foreground font-mono">
          <p>
            &gt; Dismissable Only: {args.dismissableOnly ? 'ON (stays forever)' : 'OFF (auto-dismiss)'}
          </p>
          <p>&gt; Duration: {args.dismissableOnly ? 'Infinity' : `${args.duration}ms`}</p>
        </div>
      </div>
    )
  },
}

// Story demonstrating custom button layout with wrapper
export const CustomButtonLayout: Story = {
  render: () => (
    <div className="flex flex-col gap-4 max-w-2xl">
      <h2 className="text-lg font-mono uppercase">Custom Button Layout Demo</h2>
      <p className="text-sm text-muted-foreground">
        Using CodeLayerToastButtons wrapper for consistent button positioning at the bottom of toasts.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            toast('File deleted', {
              description: 'The file has been moved to trash.',
              action: (
                <CodeLayerToastButtons
                  action={{ label: 'Undo', onClick: () => console.log('Undo clicked') }}
                />
              ),
            })
          }}
          variant="outline"
        >
          Single Action Button
        </Button>

        <Button
          onClick={() => {
            toast.error('Delete permanently?', {
              description: 'This action cannot be undone.',
              action: (
                <CodeLayerToastButtons
                  action={{ label: 'Delete', onClick: () => toast.success('Deleted!') }}
                  cancel={{ label: 'Cancel', onClick: () => console.log('Cancelled') }}
                  variant="error"
                />
              ),
            })
          }}
          variant="outline"
        >
          Two Buttons (Equal Width)
        </Button>

        <Button
          onClick={() => {
            toast.warning('Unsaved changes', {
              description: 'You have unsaved changes that will be lost.',
              action: (
                <CodeLayerToastButtons
                  action={{ label: 'Save', onClick: () => toast.success('Saved!') }}
                  cancel={{ label: 'Discard', onClick: () => toast.info('Changes discarded') }}
                  variant="warning"
                />
              ),
            })
          }}
          variant="outline"
        >
          Save/Discard Example
        </Button>
      </div>

      <div className="mt-4 p-4 border border-border rounded font-mono text-xs">
        <p className="text-muted-foreground mb-2">&gt; BUTTON LAYOUT FEATURES:</p>
        <ul className="space-y-1 ml-4">
          <li>• Buttons positioned at bottom of toast</li>
          <li>• Equal width distribution when multiple buttons</li>
          <li>• Full width when single button</li>
          <li>• Uses shadcn Button components</li>
          <li>• Automatic toast dismissal handling</li>
        </ul>
      </div>
    </div>
  ),
}

// Terminal-style notification scenario
export const TerminalStyle: Story = {
  render: () => (
    <div className="flex flex-col gap-4 font-mono">
      <div className="p-4 border border-border rounded">
        <p className="text-xs text-muted-foreground mb-2">&gt; SYSTEM NOTIFICATIONS:</p>
        <div className="flex gap-2">
          <Button
            onClick={() =>
              toast.success('[SYSTEM] Process completed', {
                description: 'PID: 12345 | Exit code: 0',
              })
            }
            size="sm"
            variant="outline"
          >
            [S] SUCCESS
          </Button>

          <Button
            onClick={() =>
              toast.error('[ERROR] Segmentation fault', {
                description: 'Core dumped at 0x7fff5fbff8c0',
                action: {
                  label: 'DEBUG',
                  onClick: () => console.log('Opening debugger...'),
                },
              })
            }
            size="sm"
            variant="outline"
          >
            [E] ERROR
          </Button>

          <Button
            onClick={() =>
              toast.warning('[WARN] Memory usage high', {
                description: '87% of 16GB used',
              })
            }
            size="sm"
            variant="outline"
          >
            [W] WARNING
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        <p>&gt; Press keys to trigger notifications</p>
        <p>&gt; All toasts styled with terminal theme colors</p>
        <p>&gt; Awaiting input_</p>
      </div>
    </div>
  ),
}
