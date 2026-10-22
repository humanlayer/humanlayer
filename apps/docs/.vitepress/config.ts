import { defineConfig } from 'vitepress'

export default defineConfig({
	title: 'HumanLayer Docs',
	description: 'Guides for HumanLayer remote daemons, Codex, and CLI workflows.',
	appearance: false,
	cleanUrls: true,
	head: [
		['link', { rel: 'icon', href: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' }],
		['link', { rel: 'icon', href: '/icon.png', sizes: '1024x1024', type: 'image/png' }],
	],
	lastUpdated: true,
	markdown: {
		theme: {
			light: 'poimandres',
			dark: 'poimandres',
		},
		config(md) {
			const defaultFence = md.renderer.rules.fence
			if (!defaultFence) throw new Error('markdown-it default fence renderer is not defined')
			md.renderer.rules.fence = (tokens, index, options, env, self) => {
				const token = tokens[index]
				if (!token) return defaultFence(tokens, index, options, env, self)
				if (token.info.trim() !== 'mermaid') return defaultFence(tokens, index, options, env, self)
				return `<MermaidDiagram code="${encodeURIComponent(token.content)}" />`
			}
		},
	},
	themeConfig: {
		logo: '/human-layer.svg',
		logoLink: '/',
		nav: [
			{ text: 'Quickstart', link: '/tutorials/first-session' },
			{ text: 'Reference', link: '/reference/skills-workflows' },
			{ text: 'Release Notes', link: '/release-notes' },
		],
		sidebar: [
			{
				text: 'Tutorials',
				items: [
					{ text: 'Run your first HumanLayer task', link: '/tutorials/first-session' },
					{ text: 'Run a task on a remote daemon', link: '/tutorials/remote-daemon' },
				],
			},
			{
				text: 'How-to guides',
				items: [
					{ text: 'Choose and run a workflow', link: '/guide/skills-workflows' },
					{ text: 'Set up a workspace', link: '/guide/workspaces' },
					{ text: 'Run sessions in automations', link: '/guide/automation-sessions' },
					{ text: 'Run a remote daemon', link: '/guide/remote-daemons' },
					{ text: 'Use remote hosts only', link: '/guide/local-daemon' },
					{ text: 'Set up Codex CLI', link: '/guide/codex' },
					{ text: 'Run Claude through AWS Bedrock', link: '/guide/bedrock' },
					{ text: 'Route models through an LLM gateway', link: '/guide/llm-gateways' },
					{ text: 'Create tasks from GitHub issues', link: '/guide/github-integration' },
					{ text: 'Send task updates to Slack', link: '/guide/slack-integration' },
					{ text: 'Run workflows from Linear issues', link: '/guide/linear-integration' },
					{ text: 'Create tasks from Jira tickets', link: '/guide/jira-integration' },
				],
			},
			{
				text: 'Explanation',
				items: [
					{ text: 'How workflow phases fit together', link: '/explanation/workflow-phases' },
					{ text: 'How HumanLayer tasks work', link: '/explanation/tasks' },
					{ text: 'How workspace configuration works', link: '/explanation/workspace-model' },
					{ text: 'How remote daemons work', link: '/explanation/remote-daemons' },
				],
			},
			{
				text: 'Reference',
				items: [
					{ text: 'Skills and workflows', link: '/reference/skills-workflows' },
					{ text: 'Sub-agent models and effort', link: '/reference/subagent-models' },
					{ text: 'System prompt additions', link: '/reference/system-prompt-additions' },
					{ text: 'Workspace config', link: '/reference/workspace-config' },
				],
			},
			{
				text: 'Release Notes',
				items: [{ text: 'Release Notes', link: '/release-notes' }],
			},
		],
		socialLinks: [{ icon: 'github', link: 'https://github.com/humanlayer/humanlayer' }],
		search: {
			provider: 'local',
		},
	},
})
