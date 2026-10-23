<template>
	<div ref="container" class="mermaid-diagram" />
</template>

<script setup lang="ts">
import { onMounted, useId, useTemplateRef } from 'vue'

const props = defineProps<{ code: string }>()
const container = useTemplateRef('container')
const id = useId().replaceAll(':', '-')

onMounted(async () => {
	const { default: mermaid } = await import('mermaid')
	mermaid.initialize({
		startOnLoad: false,
		theme: 'base',
		themeVariables: {
			background: '#1b1e28',
			primaryColor: '#303340',
			primaryTextColor: '#a6accd',
			primaryBorderColor: '#add7ff',
			secondaryColor: '#303340',
			secondaryTextColor: '#a6accd',
			secondaryBorderColor: '#5de4c7',
			tertiaryColor: '#1b1e28',
			tertiaryTextColor: '#a6accd',
			tertiaryBorderColor: '#767c9d',
			lineColor: '#767c9d',
			textColor: '#a6accd',
			clusterBkg: '#303340',
			clusterBorder: '#add7ff',
			titleColor: '#add7ff',
			edgeLabelBackground: '#1b1e28',
			fontFamily: 'IBM Plex Mono, monospace',
		},
	})

	const { svg } = await mermaid.render(`mermaid-${id}`, decodeURIComponent(props.code))
	if (container.value) container.value.innerHTML = svg
})
</script>
