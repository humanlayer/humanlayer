import { expect, test } from 'vitest'

// Opt-in, read-only check against the actual Electron renderer. Prepare a review
// with a visible collapsed card and its final file expanded, then scroll to the
// bottom. Run once per placement (sidebar/fullscreen), using the renderer's exact
// websocket from :9222/json/list. Never changes comments, reviewed or collapse state.
// DIFF_REVIEW_CDP_URL=ws://... DIFF_REVIEW_PLACEMENT=sidebar \
// DIFF_REVIEW_FINAL_FILE=syncopate:utils/helpers.js bun --bun run test --config vitest.electron.config.ts
const cdpUrl = process.env.DIFF_REVIEW_CDP_URL

function measureReviewGeometry() {
	const fullscreen = document.querySelector<HTMLDialogElement>('dialog[data-diff-review-root][open]')
	const review = (fullscreen ?? document).querySelector<HTMLElement>('[aria-label="Task diff review"]')
	const scroll = review?.querySelector<HTMLElement>('.overflow-y-auto')
	if (!scroll) throw new Error('Open a diff review before running the geometry check')
	const viewport = scroll.getBoundingClientRect()
	const cards = [...scroll.querySelectorAll<HTMLElement>('diffs-container')].map((card) => {
		const toolbar = card.querySelector<HTMLElement>('[data-diff-file-id]')
		const header = card.shadowRoot?.querySelector<HTMLElement>('[data-diffs-header]')
		if (!toolbar || !header) throw new Error('Expected a custom diff file header')
		const lines = [...(card.shadowRoot?.querySelectorAll<HTMLElement>('[data-line]') ?? [])]
		const lastLine = lines.at(-1)
		return {
			file: toolbar.dataset.diffFileId,
			collapsed: toolbar.querySelector('button')?.getAttribute('aria-label')?.startsWith('Expand '),
			card: card.getBoundingClientRect().toJSON(),
			header: header.getBoundingClientRect().toJSON(),
			toolbar: toolbar.getBoundingClientRect().toJSON(),
			bottomBorder: Number.parseFloat(getComputedStyle(toolbar).borderBottomWidth),
			lastLine: lastLine?.getBoundingClientRect().toJSON(),
			lastLineNumber: lastLine?.dataset.line,
		}
	})
	return {
		placement: fullscreen ? 'fullscreen' : review?.closest('[role="tabpanel"]') ? 'sidebar' : 'primary',
		viewport: viewport.toJSON(),
		clientHeight: scroll.clientHeight,
		scrollHeight: scroll.scrollHeight,
		scrollTop: scroll.scrollTop,
		cards,
	}
}

function measureInElectron(url: string): Promise<ReturnType<typeof measureReviewGeometry>> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url)
		const timer = setTimeout(() => {
			socket.close()
			reject(new Error('Electron geometry check timed out'))
		}, 10_000)
		socket.onopen = () =>
			socket.send(
				JSON.stringify({
					id: 1,
					method: 'Runtime.evaluate',
					params: { expression: `(${measureReviewGeometry.toString()})()`, returnByValue: true },
				}),
			)
		socket.onerror = () => {
			clearTimeout(timer)
			socket.close()
			reject(new Error('Could not connect to the Electron renderer'))
		}
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data))
			if (message.id !== 1) return
			clearTimeout(timer)
			socket.close()
			if (message.error || message.result.exceptionDetails) reject(new Error(JSON.stringify(message)))
			else resolve(message.result.result.value)
		}
	})
}

test.skipIf(!cdpUrl)(
	'collapsed borders close at the toolbar and the final expanded card is reachable in Electron',
	async () => {
		const geometry = await measureInElectron(cdpUrl!)
		expect(geometry.placement).toBe(process.env.DIFF_REVIEW_PLACEMENT)
		const visibleCollapsed = geometry.cards.filter(
			(item) =>
				item.collapsed &&
				item.card.top >= geometry.viewport.top &&
				item.card.bottom <= geometry.viewport.bottom,
		)
		console.info(JSON.stringify({ ...geometry, cards: [...visibleCollapsed, geometry.cards.at(-1)] }, null, 2))
		expect(visibleCollapsed.length, 'Prepare at least one fully visible collapsed card').toBeGreaterThan(0)
		for (const item of visibleCollapsed) {
			expect(item.toolbar.height).toBe(40)
			expect(item.header.height).toBe(41)
			expect(item.card.height).toBe(41)
			expect(item.bottomBorder).toBe(1)
			expect(item.header.bottom).toBeCloseTo(item.toolbar.bottom, 1)
			expect(item.card.bottom).toBeCloseTo(item.toolbar.bottom, 1)
		}
		const finalFile = process.env.DIFF_REVIEW_FINAL_FILE
		expect(finalFile, 'Set the expected final file, not just the last rendered card').toBeTruthy()
		const last = geometry.cards.at(-1)!
		expect(last.file?.endsWith(finalFile!)).toBe(true)
		expect(last.collapsed).toBe(false)
		expect(last.lastLineNumber).toBeDefined()
		expect(last.lastLine!.top).toBeGreaterThanOrEqual(geometry.viewport.top)
		expect(last.lastLine!.bottom).toBeLessThanOrEqual(geometry.viewport.bottom + 1)
		expect(last.card.bottom).toBeLessThanOrEqual(geometry.viewport.bottom + 1)
		expect(Math.abs(geometry.scrollHeight - geometry.clientHeight - geometry.scrollTop)).toBeLessThanOrEqual(1)
	},
)
