import type { HostModelCatalog } from '@humanlayer/schemas/zod/model-catalog'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CODEX_SIGN_IN, type ComposerSettings, modelCatalog } from '@/minimalist/lib/models'
import { MinimalistPortalContext } from '@/minimalist/lib/portal'

import { ModelPicker } from './ModelPicker'

const { copy } = vi.hoisted(() => ({ copy: vi.fn() }))
vi.mock('@/minimalist/lib/use-copy', () => ({ useCopy: () => copy }))
// jsdom does not implement the browser's modal dialog API.
vi.mock('@/minimalist/lib/modal', () => ({
	openModal: (dialog: HTMLDialogElement | null) => {
		dialog?.setAttribute('open', '')
		return () => dialog?.removeAttribute('open')
	},
}))

const claude: ComposerSettings = {
	agent: 'claude',
	model: 'opus',
	effort: 'high',
	fastMode: false,
	permissionsMode: 'auto',
}

function report(codex: HostModelCatalog['codex']): HostModelCatalog {
	return { probedAt: 1, anthropic: { status: 'ok', models: [] }, codex }
}

function openPicker(props: ComponentProps<typeof ModelPicker>) {
	render(
		<MinimalistPortalContext value={document.body}>
			<ModelPicker {...props} />
		</MinimalistPortalContext>,
	)
	fireEvent.click(screen.getByRole('button'))
}

/** These tests pick an older Codex model, which sits behind "More Codex models". */
function openWithOlderCodex(props: ComponentProps<typeof ModelPicker>) {
	openPicker(props)
	fireEvent.click(screen.getByRole('button', { name: 'More Codex models' }))
}

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
})

describe('Codex model availability', () => {
	it.each([
		{ name: 'missing', supported_models: null },
		{ name: 'failed', supported_models: report({ status: 'unavailable', reason: 'transport', models: [] }) },
		{ name: 'empty', supported_models: report({ status: 'ok', models: [] }) },
	])('offers bundled Codex without sign-in claims for a $name catalog', ({ supported_models }) => {
		const onSettingsChange = vi.fn()
		openWithOlderCodex({ settings: claude, onSettingsChange, catalog: modelCatalog({ supported_models }) })

		expect(screen.queryByRole('button', { name: /Set up Codex/ })).toBeNull()
		const model = screen.getByRole('button', { name: 'GPT-5.4' })
		expect(model).not.toBeDisabled()
		fireEvent.click(model)
		expect(onSettingsChange).toHaveBeenCalledWith({
			agent: 'codelayer',
			model: 'gpt-5.4',
			effort: 'high',
			fastMode: false,
			permissionsMode: 'bypass',
		})
	})

	it('shows sign-in help alongside bundled models for a known auth failure', () => {
		openWithOlderCodex({
			settings: claude,
			onSettingsChange: vi.fn(),
			catalog: modelCatalog({
				supported_models: report({ status: 'unavailable', reason: 'not_logged_in', models: [] }),
			}),
			usage: { hostName: 'Shared host', limits: null },
		})

		expect(screen.getByRole('button', { name: 'GPT-5.4' })).not.toBeDisabled()
		fireEvent.click(screen.getByRole('button', { name: /Set up Codex/ }))
		expect(copy).toHaveBeenCalledWith(
			CODEX_SIGN_IN,
			'Copied. Run it on Shared host to sign in to Codex.',
			`Could not copy. Run ${CODEX_SIGN_IN} on Shared host.`,
		)
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	it('hands off to bundled Codex without changing a Claude session in place', () => {
		const onHandoff = vi.fn()
		const onSettingsChange = vi.fn()
		openWithOlderCodex({ settings: claude, onSettingsChange, onHandoff, catalog: modelCatalog(null) })

		expect(screen.getByText('Hand off to Codex')).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'GPT-5.4' }))
		expect(onHandoff).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codelayer', value: 'gpt-5.4' }))
		expect(onSettingsChange).not.toHaveBeenCalled()
	})

	it('keeps blocked handoff models disabled even with a fallback catalog', () => {
		const onHandoff = vi.fn()
		openWithOlderCodex({
			settings: claude,
			onSettingsChange: vi.fn(),
			onHandoff,
			handoffBlocked: 'Connect the host to hand off.',
			catalog: modelCatalog(null),
		})

		const model = screen.getByRole('button', { name: 'GPT-5.4' })
		expect(model).toBeDisabled()
		fireEvent.click(model)
		expect(onHandoff).not.toHaveBeenCalled()
	})

	it('keeps effort and fast mode controls for a selected bundled Codex model', () => {
		const settings: ComposerSettings = {
			...claude,
			agent: 'codelayer',
			model: 'gpt-5.4',
			effort: 'medium',
			permissionsMode: 'bypass',
		}
		const onSettingsChange = vi.fn()
		openWithOlderCodex({
			settings,
			onSettingsChange,
			catalog: modelCatalog({
				supported_models: report({ status: 'unavailable', reason: 'timeout', models: [] }),
			}),
		})

		fireEvent.click(screen.getByRole('button', { name: 'High' }))
		expect(onSettingsChange).toHaveBeenLastCalledWith({ ...settings, effort: 'high' })
		fireEvent.click(screen.getByRole('button', { name: /Fast mode/ }))
		expect(onSettingsChange).toHaveBeenLastCalledWith({ ...settings, fastMode: true })
	})
})

describe('older models', () => {
	it('folds older models behind a More item per agent', () => {
		openPicker({ settings: claude, onSettingsChange: vi.fn(), catalog: modelCatalog(null) })
		expect(screen.getByRole('button', { name: 'Opus 5.5' })).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Opus 4.8' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'GPT-5.4' })).toBeNull()
		fireEvent.click(screen.getByRole('button', { name: 'More Claude Code models' }))
		expect(screen.getByRole('button', { name: 'Opus 4.8' })).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'More Claude Code models' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'GPT-5.4' })).toBeNull()
	})
})
