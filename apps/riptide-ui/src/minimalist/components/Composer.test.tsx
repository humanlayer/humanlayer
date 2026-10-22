import { RPI_SLASH_COMMANDS } from '@humanlayer/ui/constants/rpi-skills'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { activeViewportFileDropHandler } from '@/lib/viewport-file-drop'
import type { SlashCommand } from '@/minimalist/lib/data'
import type { ComposerSettings } from '@/minimalist/lib/models'
import type { ComposerAttachments } from '@/minimalist/lib/use-attachments'

import { Composer } from './Composer'

vi.mock('@/minimalist/components/ComposerControls', () => ({
	AddButton: () => null,
	AttachmentChips: () => null,
	ContextMeter: () => null,
}))
vi.mock('@/minimalist/components/ModelPicker', () => ({ ModelPicker: () => null, PermissionPicker: () => null }))
vi.mock('@/minimalist/lib/mentions', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/minimalist/lib/mentions')>()),
	useMentions: (query: string | null) =>
		query === null
			? []
			: [
					{
						key: 'research',
						label: 'Research',
						detail: 'Task document',
						insert: '@.humanlayer/tasks/test/research.md',
						kind: 'doc',
					},
				],
}))

const commands: SlashCommand[] = RPI_SLASH_COMMANDS.map((command) => ({ ...command, kind: 'skill' }))
const settings: ComposerSettings = {
	agent: 'claude',
	model: 'opus',
	effort: null,
	fastMode: false,
	permissionsMode: 'default',
}
const scrollIntoView = vi.fn()

beforeEach(() => {
	vi.clearAllMocks()
	Element.prototype.scrollIntoView = scrollIntoView
	useSettingsStore.setState({ sendMessageKeybinding: 'enter' })
})

function Harness({ onSubmit, options = commands }: { onSubmit: (value: string) => void; options?: SlashCommand[] }) {
	const [value, setValue] = useState('')
	return (
		<Composer
			value={value}
			onChange={setValue}
			onSubmit={() => onSubmit(value)}
			placeholder="Ask the agent to do anything"
			settings={settings}
			onSettingsChange={() => {}}
			catalog={{ models: [], codexSignedOut: false }}
			commands={options}
			mentionScope={{ taskId: 'task', hostId: null, directory: null }}
		/>
	)
}

function type(value: string) {
	const input = screen.getByRole('textbox', { name: 'Message the agent' })
	fireEvent.change(input, { target: { value, selectionStart: value.length } })
	return input
}

describe('minimalist composer autocomplete', () => {
	it('lists every bundled RPI entry and reaches entries past the former eight-result limit with the keyboard', () => {
		const submit = vi.fn()
		render(<Harness onSubmit={submit} />)
		const input = type('/rpi:')
		const rows = screen.getAllByRole('option')
		expect(rows).toHaveLength(27)
		expect(rows.map((row) => row.querySelector('.mono')?.textContent)).toEqual(
			expect.arrayContaining(RPI_SLASH_COMMANDS.map((command) => command.name)),
		)
		fireEvent.keyDown(input, { key: 'ArrowUp' })
		const last = rows.at(-1)
		expect(last).toHaveAttribute('aria-selected', 'true')
		expect(input).toHaveAttribute('aria-activedescendant', last?.id)
		expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' })
		const picked = RPI_SLASH_COMMANDS.find((command) => command.name === last?.querySelector('.mono')?.textContent)
		fireEvent.keyDown(input, { key: 'Enter' })
		expect(input).toHaveValue(`use the ${(picked?.insertText ?? picked?.name)?.slice(1)} skill\n\n`)
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
		expect(submit).not.toHaveBeenCalled()
		fireEvent.keyDown(input, { key: 'Enter' })
		expect(submit).toHaveBeenCalledOnce()
	})

	it('filters and selects a legacy alias by pointer using its canonical skill instruction', () => {
		const submit = vi.fn()
		render(<Harness onSubmit={submit} />)
		const input = type('/rpi:create-out')
		expect(screen.getAllByRole('option')).toHaveLength(1)
		fireEvent.mouseDown(screen.getByRole('option', { name: /^\/rpi:create-outline/ }))
		expect(input).toHaveValue('use the rpi:create-structure-outline skill\n\n')
		expect(submit).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole('button', { name: 'Send' }))
		expect(submit).toHaveBeenCalledWith('use the rpi:create-structure-outline skill\n\n')
	})

	it('keeps system commands as slash text and consumes Tab without sending', () => {
		const submit = vi.fn()
		render(
			<Harness
				onSubmit={submit}
				options={[{ name: '/compact', source: 'bundled', kind: 'command', startOfMessageOnly: true }]}
			/>,
		)
		const input = type('/comp')
		fireEvent.keyDown(input, { key: 'Tab' })
		expect(input).toHaveValue('/compact ')
		expect(submit).not.toHaveBeenCalled()
	})

	it('leaves Enter alone during composition and Shift+Enter while a slash list is open', () => {
		const submit = vi.fn()
		render(<Harness onSubmit={submit} />)
		const input = type('/rpi:create-out')
		fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
		fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
		expect(input).toHaveValue('/rpi:create-out')
		expect(submit).not.toHaveBeenCalled()
	})

	it('keeps file/document mentions and unmatched slash text on their existing input and send paths', () => {
		const submit = vi.fn()
		render(<Harness onSubmit={submit} />)
		const input = type('Read @research')
		fireEvent.keyDown(input, { key: 'Tab' })
		expect(input).toHaveValue('Read @.humanlayer/tasks/test/research.md ')
		expect(submit).not.toHaveBeenCalled()
		type('/home/pepijn')
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
		fireEvent.keyDown(input, { key: 'Enter' })
		expect(submit).toHaveBeenCalledWith('/home/pepijn')
	})
})

describe('minimalist composer file drops', () => {
	function renderWith(attachments: ComposerAttachments | undefined, disabled = false) {
		return render(
			<Composer
				value=""
				onChange={() => {}}
				onSubmit={() => {}}
				placeholder="Ask the agent to do anything"
				disabled={disabled}
				attachments={attachments}
				settings={settings}
				onSettingsChange={() => {}}
				catalog={{ models: [], codexSignedOut: false }}
				mentionScope={{ taskId: 'task', hostId: null, directory: null }}
			/>,
		)
	}
	const files = () => [new File(['png'], 'shot.png', { type: 'image/png' })]

	it('takes a file dropped anywhere in the window while it can attach', () => {
		const add = vi.fn()
		const view = renderWith({ add, metadata: [] } as unknown as ComposerAttachments)
		const dropped = files()
		expect(activeViewportFileDropHandler()).not.toBeNull()
		activeViewportFileDropHandler()?.(dropped)
		expect(add).toHaveBeenCalledExactlyOnceWith(dropped)
		view.unmount()
		expect(activeViewportFileDropHandler()).toBeNull()
	})

	it('leaves drops alone without attachments or while disabled', () => {
		const add = vi.fn()
		const view = renderWith(undefined)
		expect(activeViewportFileDropHandler()).toBeNull()
		view.unmount()
		renderWith({ add, metadata: [] } as unknown as ComposerAttachments, true)
		expect(activeViewportFileDropHandler()).toBeNull()
	})
})
