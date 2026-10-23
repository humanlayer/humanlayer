<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vitepress'

const route = useRoute()
const status = ref<'idle' | 'copying' | 'copied' | 'error'>('idle')
const target = shallowRef<HTMLElement>()
let targetContainer: HTMLElement | undefined
const markdownSources = import.meta.glob('../../**/*.md', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>

const markdownPath = computed(() => {
	const path = route.path.split('#')[0]?.split('?')[0] ?? '/'
	if (path === '/') return 'index.md'
	const cleanPath = path.startsWith('/') ? path.slice(1) : path
	if (cleanPath.endsWith('/')) return `${cleanPath}index.md`
	return cleanPath.endsWith('.md') ? cleanPath : `${cleanPath}.md`
})

const markdownSource = computed(() => markdownSources[`../../${markdownPath.value}`])

async function syncTarget() {
	await nextTick()
	const title = document.querySelector('.vp-doc h1')
	if (!title?.parentElement) return

	targetContainer?.remove()
	targetContainer = document.createElement('div')
	targetContainer.className = 'copy-markdown-button-slot'
	title.insertAdjacentElement('afterend', targetContainer)
	target.value = targetContainer
}

onMounted(syncTarget)
watch(() => route.path, syncTarget)
onBeforeUnmount(() => targetContainer?.remove())

function sanitizeMarkdown(text: string) {
	return text.replace(/^\s*<CopyMarkdownButton\s*\/?\s*>\s*\n?/gm, '').trim()
}

function copyViaSelection(text: string) {
	const textarea = document.createElement('textarea')
	textarea.value = text
	textarea.setAttribute('readonly', '')
	textarea.style.position = 'fixed'
	textarea.style.left = '-9999px'
	document.body.appendChild(textarea)
	textarea.focus()
	textarea.select()
	const didCopy = document.execCommand('copy')
	textarea.remove()

	if (!didCopy) throw new Error('Copy command failed')
}

async function copyWithFallback(text: string) {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text)
			return
		}
	} catch {
		// Fall back to the selection path below when browser clipboard permissions reject.
	}

	copyViaSelection(text)
}

async function copyMarkdown() {
	if (status.value === 'copying') return
	status.value = 'copying'

	try {
		const source = markdownSource.value
		if (!source) throw new Error(`Missing markdown source for ${markdownPath.value}`)
		await copyWithFallback(sanitizeMarkdown(source))
		status.value = 'copied'
		window.setTimeout(() => {
			status.value = 'idle'
		}, 2000)
	} catch {
		status.value = 'error'
		window.setTimeout(() => {
			status.value = 'idle'
		}, 3000)
	}
}
</script>

<template>
	<Teleport v-if="target" :to="target">
	<button
		class="copy-markdown-button"
		type="button"
		:disabled="status === 'copying'"
		:aria-label="status === 'copied' ? 'Copied page markdown' : 'Copy page as Markdown'"
		@click="copyMarkdown"
	>
		<svg
			v-if="status !== 'copied'"
			class="copy-markdown-button-icon"
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
			<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
		</svg>
		<svg
			v-else
			class="copy-markdown-button-icon"
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M20 6 9 17l-5-5" />
		</svg>
		<span aria-live="polite">
			<span v-if="status === 'copied'">copied</span>
			<span v-else-if="status === 'copying'">copying...</span>
			<span v-else-if="status === 'error'">copy failed</span>
			<span v-else>copy page</span>
		</span>
	</button>
	</Teleport>
</template>
