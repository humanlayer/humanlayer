import { Button } from '@humanlayer/ui/components/button'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { ErrorDetails } from './ErrorDetails'

/**
 * Wrapper component that shows ErrorDetails in the context of a full error screen
 */
function FullErrorScreenWrapper({
	error,
	componentStack,
}: { error: Error | unknown; componentStack?: string | null }) {
	return (
		<div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
			<AlertCircle className="w-16 h-16 text-red-500 mb-4" />
			<h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
			<p className="text-muted-foreground mb-6 max-w-md">
				An unexpected error occurred. The error has been reported and we&apos;ll investigate the issue.
			</p>
			<Button className="gap-2">
				<RefreshCw className="w-4 h-4" />
				Try Again
			</Button>

			<ErrorDetails error={error} componentStack={componentStack} />
		</div>
	)
}

const meta: Meta<typeof ErrorDetails> = {
	title: 'Components/ErrorDetails',
	component: ErrorDetails,
	parameters: {
		layout: 'centered',
	},
	decorators: [
		(Story) => (
			<div className="p-4 bg-background w-[600px]">
				<Story />
			</div>
		),
	],
}

export default meta
type Story = StoryObj<typeof ErrorDetails>

// Create mock errors for stories
const createMockError = (name: string, message: string, stack?: string): Error => {
	const error = new Error(message)
	error.name = name
	if (stack) {
		error.stack = stack
	}
	return error
}

const mockStack = `TypeError: Cannot read property 'foo' of undefined
    at MyComponent (src/components/MyComponent.tsx:42:10)
    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)
    at mountIndeterminateComponent (node_modules/react-dom/cjs/react-dom.development.js:17811:13)
    at beginWork (node_modules/react-dom/cjs/react-dom.development.js:19049:16)`

const mockComponentStack = `    at MyComponent (src/components/MyComponent.tsx:42:10)
    at ErrorBoundary (src/integrations/sentry/SentryErrorBoundary.tsx:21:1)
    at div
    at App (src/App.tsx:15:5)`

export const Default: Story = {
	name: 'Default',
	args: {
		error: createMockError('TypeError', "Cannot read property 'foo' of undefined", mockStack),
	},
}

export const WithComponentStack: Story = {
	name: 'With Component Stack',
	args: {
		error: createMockError('TypeError', "Cannot read property 'foo' of undefined", mockStack),
		componentStack: mockComponentStack,
	},
}

export const NonErrorObject: Story = {
	name: 'Non-Error Object',
	args: {
		error: 'Something went wrong: invalid state',
	},
}

export const LongStackTrace: Story = {
	name: 'Long Stack Trace',
	args: {
		error: createMockError(
			'Error',
			'A very long error message that might wrap to multiple lines in the UI to test how the component handles overflow and text wrapping in various scenarios',
			`Error: A very long error message
    at Component1 (src/components/Component1.tsx:10:5)
    at Component2 (src/components/Component2.tsx:20:5)
    at Component3 (src/components/Component3.tsx:30:5)
    at Component4 (src/components/Component4.tsx:40:5)
    at Component5 (src/components/Component5.tsx:50:5)
    at Component6 (src/components/Component6.tsx:60:5)
    at Component7 (src/components/Component7.tsx:70:5)
    at Component8 (src/components/Component8.tsx:80:5)
    at Component9 (src/components/Component9.tsx:90:5)
    at Component10 (src/components/Component10.tsx:100:5)
    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)
    at mountIndeterminateComponent (node_modules/react-dom/cjs/react-dom.development.js:17811:13)
    at beginWork (node_modules/react-dom/cjs/react-dom.development.js:19049:16)
    at HTMLUnknownElement.callCallback (node_modules/react-dom/cjs/react-dom.development.js:3945:14)`
		),
		componentStack: `    at Component1
    at Component2
    at Component3
    at Component4
    at Component5
    at ErrorBoundary
    at Router
    at App`,
	},
}

export const NoError: Story = {
	name: 'No Error (renders null)',
	args: {
		error: null,
	},
}

export const FullErrorScreen: Story = {
	name: 'Full Error Screen',
	decorators: [
		() => (
			<div className="flex flex-col items-center justify-center w-full min-h-screen bg-background p-8 text-center">
				<AlertCircle className="w-16 h-16 text-red-500 mb-4" />
				<h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
				<p className="text-muted-foreground mb-6 max-w-md">
					An unexpected error occurred. The error has been reported and we&apos;ll investigate the
					issue.
				</p>
				<Button className="gap-2">
					<RefreshCw className="w-4 h-4" />
					Try Again
				</Button>
				<ErrorDetails
					error={createMockError('TypeError', "Cannot read property 'foo' of undefined", mockStack)}
					componentStack={mockComponentStack}
				/>
			</div>
		),
	],
	parameters: {
		layout: 'fullscreen',
	},
}
