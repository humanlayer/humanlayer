// Renders the cheat-sheet HTML files into ../public/
// Usage: node render.mjs
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
const require = createRequire(import.meta.url)
const { chromium } = require('/Users/dex/repos/dexhorthy/excalidraw-animate/node_modules/playwright')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pub = (name) => path.join(__dirname, '..', 'public', name)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1750 }, deviceScaleFactor: 2 })

const open = async (html) => {
	await page.goto('file://' + path.join(__dirname, html), { waitUntil: 'networkidle' })
	await page.waitForTimeout(600)
}

for (const [html, png] of [
	['skills-workflows-flow.html', 'skills-workflows-flow.png'],
	['skills-workflows-flow-light.html', 'skills-workflows-flow-light.png'],
]) {
	await open(html)
	const el = await page.$('#c')
	await el.screenshot({ path: pub(png) })
	console.log('wrote', pub(png))
}

// Print variant goes out as a PDF. The #c layout is 1650x1275 CSS px; at
// scale 0.64 Chromium lays the landscape page out at 1056/0.64 = 1650px, so
// the content maps 1:1 onto an 11x8.5in Letter sheet.
await open('skills-workflows-flow-print.html')
await page.pdf({
	path: pub('skills-workflows-flow-print.pdf'),
	format: 'Letter',
	landscape: true,
	printBackground: true,
	scale: 0.64,
	margin: { top: 0, right: 0, bottom: 0, left: 0 },
	pageRanges: '1',
})
console.log('wrote', pub('skills-workflows-flow-print.pdf'))

await browser.close()
