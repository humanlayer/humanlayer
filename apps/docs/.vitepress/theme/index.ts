import mediumZoom from 'medium-zoom'
import type { Theme } from 'vitepress'
import { useRoute } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import { h, nextTick, onMounted, watch } from 'vue'

import CopyMarkdownButton from './CopyMarkdownButton.vue'
import MermaidDiagram from './MermaidDiagram.vue'

import './styles.css'

export default {
	extends: DefaultTheme,
	Layout: () =>
		h(DefaultTheme.Layout, null, {
			'doc-before': () => h(CopyMarkdownButton),
		}),
	enhanceApp({ app }) {
		app.component('CopyMarkdownButton', CopyMarkdownButton)
		app.component('MermaidDiagram', MermaidDiagram)
		if (typeof document === 'undefined') return
		document.documentElement.setAttribute('data-theme', 'poimandres-vscode')
		document.documentElement.classList.add('dark')
	},
	setup() {
		const route = useRoute()
		const attachZoom = () => {
			mediumZoom('.vp-doc img', { background: 'rgba(27, 30, 40, 0.92)' })
		}
		onMounted(attachZoom)
		watch(
			() => route.path,
			() => nextTick(attachZoom),
		)
	},
} satisfies Theme
