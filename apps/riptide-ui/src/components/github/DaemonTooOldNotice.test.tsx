import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { DaemonTooOldNotice } from './DaemonTooOldNotice'

describe('DaemonTooOldNotice', () => {
	test('names the host to update, so the reader knows which one', () => {
		render(<DaemonTooOldNotice hostName="querytale" onOpenDaemonSettings={vi.fn()} />)

		expect(
			screen.getByText('Update the daemon on querytale and restart it to see pull requests'),
		).toBeInTheDocument()
	})

	test('falls back to the host when it has no name', () => {
		render(<DaemonTooOldNotice hostName={null} onOpenDaemonSettings={vi.fn()} />)

		expect(
			screen.getByText('Update the daemon on this host and restart it to see pull requests'),
		).toBeInTheDocument()
	})

	test('offers the screen that both updates and relaunches a daemon', () => {
		const onOpenDaemonSettings = vi.fn()
		render(<DaemonTooOldNotice hostName="querytale" onOpenDaemonSettings={onOpenDaemonSettings} />)

		fireEvent.click(screen.getByRole('button', { name: 'Open host settings' }))

		expect(onOpenDaemonSettings).toHaveBeenCalledOnce()
	})

	test('keeps the build identity off screen: it is an internal name and helps no decision', () => {
		render(<DaemonTooOldNotice hostName="querytale" onOpenDaemonSettings={vi.fn()} />)

		expect(screen.getByTestId('github-daemon-too-old')).not.toHaveTextContent(/riptide|v?\d+\.\d+\.\d+/i)
	})
})
