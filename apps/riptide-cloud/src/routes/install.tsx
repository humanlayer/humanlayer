import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@humanlayer/ui/components/dialog'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { ArrowRightLeft, BookOpen, Check, Copy, Download, LogOut, Play } from 'lucide-react'
import { useState } from 'react'

import { env, type PublicEnvironment } from '@/env'

export const Route = createFileRoute('/install')({
	component: InstallPage,
})

interface InstallTarget {
	cask: string
	appName: string
	downloadUrl: string
}

const PRODUCTION_INSTALL_TARGET: InstallTarget = {
	cask: 'humanlayer',
	appName: 'HumanLayer',
	downloadUrl: 'https://update.humanlayer.com/download/darwin-arm64',
}

const INSTALL_TARGETS: Record<PublicEnvironment, InstallTarget> = {
	prod: PRODUCTION_INSTALL_TARGET,
	beta: {
		cask: 'humanlayer-beta',
		appName: 'HumanLayer-Beta',
		downloadUrl: 'https://update.codelayer.cloud/download/darwin-arm64',
	},
	dev: {
		cask: 'humanlayer-dev',
		appName: 'HumanLayer-Dev',
		downloadUrl: 'https://update.dev.codelayer.gg/download/darwin-arm64',
	},
	local: PRODUCTION_INSTALL_TARGET,
}

// A guide is a link out to a talk, demo, or reading. Video guides carry a
// `videoId` (YouTube id) which upgrades them from a plain link card to a
// clickable thumbnail that plays in a lightbox; non-video guides (reading
// docs) render as link cards. `poster`/`duration` are display-only.
type Guide = {
	title: string
	description: string
	link: string
	label: string
	videoId?: string
	poster?: string
	duration?: string
	start?: number // seconds to start the embed at
}

// The featured "how to use it" video that anchors the hero, above the fold,
// alongside the install command. Dexter's talking-head product tour.
const featuredVideo: Guide = {
	title: 'Quick product tour',
	description: 'Watch this first: a compact walkthrough of what it looks like to use HumanLayer day to day.',
	link: 'https://humanlayer.com/prd-626',
	label: 'Watch the tour',
	videoId: 'KQoSiBbsVso',
	poster: '/install-videos/quick-product-tour.jpg',
}

// "Meet the product" guides introduce HumanLayer itself: what it is and what
// it looks like to use it day to day. The quick product tour lives in the hero
// above; these are the longer demos and deep-dives.
const productGuides: Guide[] = [
	{
		title: 'Shipping a real feature end to end',
		description: 'Follow an end-to-end session from task intake through design collaboration and implementation.',
		link: 'https://youtu.be/kBqRubi7dSk?si=TAsWUdpmTmBska7R&t=1846',
		label: 'Watch the live demo',
		videoId: 'kBqRubi7dSk',
		poster: '/install-videos/shipping-a-real-feature.jpg',
		start: 1846,
	},
	{
		title: 'How we use HumanLayer internally',
		description:
			'How the HumanLayer team uses HumanLayer internally for planning, delegation, review, and follow-up.',
		link: 'https://www.youtube.com/watch?v=eKWCx9nKe4I',
		label: 'Watch the deep dive',
		videoId: 'eKWCx9nKe4I',
		poster: '/install-videos/how-we-use-internally.jpg',
	},
]

// "Operating model & philosophy" guides explain how to work with agents well -
// the mental model, not the product UI. A mix of talks (thumbnails) and reading
// (link cards).
const philosophyGuides: Guide[] = [
	{
		title: 'Why Software Factories Fail',
		description: 'Why coding agents still need planning, context, review, and human judgment.',
		link: 'https://www.youtube.com/watch?v=Ib5GBkD555M',
		label: 'Watch the talk',
		videoId: 'Ib5GBkD555M',
		poster: '/install-videos/why-software-factories-fail.jpg',
	},
	{
		title: 'An introduction to RPI and QRSPI',
		description:
			'A conference walkthrough of the Research, Plan, Implement (RPI) workflow and its successor QRSPI.',
		link: 'https://hlyr.dev/qrspi-mlops',
		label: 'Watch the 2026 overview',
		videoId: 'YwZR6tc7qYg',
		poster: '/install-videos/qrspi-mlops.jpg',
	},
	{
		title: 'Advanced context engineering for coding agents',
		description: 'Patterns for giving coding agents enough project context to make useful, reviewable changes.',
		link: 'https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md',
		label: 'Read the guide',
	},
	{
		title: 'No Vibes Allowed: Solving Hard Problems in Complex Codebases with Harness Engineering',
		description: 'A deeper look at the workflows and tools behind high-leverage agent sessions.',
		link: 'https://hlyr.dev/nva',
		label: 'Watch the talk',
		videoId: 'rmvDxxNubIg',
		poster: '/install-videos/no-vibes-allowed.jpg',
	},
	{
		title: '12-factor agent principles for coding agent SDKs',
		description: 'Principles for building agent systems that stay debuggable, portable, and production-minded.',
		link: 'https://github.com/ai-that-works/ai-that-works/tree/main/2026-01-13-applying-12-factor-principles-to-coding-agent-sdks',
		label: 'Read the principles',
	},
]

// Answers to the questions new users most often have before they commit to the
// product, surfaced directly on the landing page instead of buried in docs.
const commonQuestions = [
	{
		question: 'What does HumanLayer keep in its database?',
		answer: 'HumanLayer stores the work you create with it: your tasks, the agent sessions you run, and the artifacts those sessions produce - research, design discussions, plans, and their versions and comments. It also keeps the settings and integrations you configure, like your organization, projects, and Linear or Jira connections, so agents have the context they need. Your code stays in your own environment and repositories; HumanLayer coordinates agents against it rather than storing your codebase.',
	},
	{
		question: 'How should I configure HumanLayer to help me succeed?',
		answer: 'Bring real work, capture context, and review as you go. Connect your issue tracker (Linear or Jira) so tasks arrive with their context, set up your projects so agents know where to work, and invite the teammates who review your PRs. Then lean on the operating model: start from a real task, let agents research and plan, collaborate on the artifacts, and review before you ship.',
	},
]

// A clickable YouTube-style thumbnail: poster + play glyph (+ optional duration
// badge) that opens a Dialog lightbox with an autoplaying embed. Mirrors the
// TaskArtifactViewer iframe-in-Dialog pattern, sized with an aspect-video box.
function VideoThumbnail({ guide }: { guide: Guide }) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<button
					type="button"
					className="group relative block aspect-video w-full overflow-hidden rounded-lg border bg-muted transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					{guide.poster ? (
						<img
							src={guide.poster}
							alt={guide.title}
							className="h-full w-full object-cover"
							loading="lazy"
						/>
					) : (
						<div className="h-full w-full bg-muted" />
					)}
					<span className="absolute inset-0 flex items-center justify-center bg-background/20 transition-colors group-hover:bg-background/10">
						<span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-primary bg-background/70">
							<Play className="h-6 w-6 fill-primary text-primary" />
						</span>
					</span>
					{guide.duration && (
						<span className="absolute bottom-2 right-2 border border-border bg-background/85 px-1.5 py-0.5 text-xs">
							{guide.duration}
						</span>
					)}
				</button>
			</DialogTrigger>
			<DialogContent className="border-0 bg-transparent p-0 shadow-none !w-[95vw] !max-w-[95vw]">
				<DialogTitle className="sr-only">{guide.title}</DialogTitle>
				<div className="aspect-video w-full">
					<iframe
						className="h-full w-full border-0"
						src={`https://www.youtube-nocookie.com/embed/${guide.videoId}?autoplay=1${guide.start ? `&start=${guide.start}` : ''}`}
						title={guide.title}
						allow="accelerometer; autoplay; encrypted-media; picture-in-picture; web-share"
						allowFullScreen
					/>
				</div>
			</DialogContent>
		</Dialog>
	)
}

// Grid cell for a video guide: thumbnail on top, title + description below.
function VideoGuideCard({ guide }: { guide: Guide }) {
	return (
		<div className="flex flex-col">
			<VideoThumbnail guide={guide} />
			<div className="mt-3">
				<h4 className="font-medium leading-none mb-1.5">{guide.title}</h4>
				<p className="text-sm text-muted-foreground">{guide.description}</p>
			</div>
		</div>
	)
}

// Grid cell for a non-video guide: the original external link card.
function GuideLinkCard({ guide }: { guide: Guide }) {
	return (
		<a
			href={guide.link}
			target="_blank"
			rel="noopener noreferrer"
			className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50 flex flex-col justify-between"
		>
			<h4 className="font-medium leading-none mb-2">{guide.title}</h4>
			<p className="text-sm text-muted-foreground mb-4">{guide.description}</p>
			<span className="text-sm text-primary hover:underline">{guide.label}</span>
		</a>
	)
}

// Render a guide as a video thumbnail if it has a videoId, else a link card.
function renderGuide(guide: Guide) {
	return guide.videoId ? (
		<VideoGuideCard key={guide.link} guide={guide} />
	) : (
		<GuideLinkCard key={guide.link} guide={guide} />
	)
}

function InstallPage() {
	const [copied, setCopied] = useState(false)
	const { signOut } = useAuth()

	// Use the humanlayer-* casks: they install the app under its real bundle
	// name (HumanLayer*.app), matching the `open` command.
	// The legacy riptide-* casks rename the bundle to Riptide*.app on install.
	const { cask, appName, downloadUrl } = INSTALL_TARGETS[env.publicEnvironment]
	const installCommand = `brew trust --tap humanlayer/humanlayer\nbrew install --cask humanlayer/humanlayer/${cask}\nopen /Applications/${appName}.app`

	const handleCopy = async () => {
		await navigator.clipboard.writeText(installCommand)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<div className="flex flex-col items-center p-8">
			<div className="w-full max-w-6xl space-y-6">
				{/* HERO: install command (primary) + featured "how to use it" video, side by side above the fold */}
				<div className="grid gap-6 lg:grid-cols-2">
					<Card>
						<CardHeader className="p-6">
							<CardTitle>Install HumanLayer and ship more without slop</CardTitle>
							<CardDescription>
								Turn vague ideas into high quality reviewed, shipped code. Run coding agents in parallel
								on real work - researching, planning, and implementing - while you stay in control by
								reviewing the artifacts they produce. Install the desktop app to get started.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4 pb-4">
							<div className="space-y-3">
								<div>
									<h3 className="font-medium text-foreground">Download for macOS</h3>
									<p className="text-sm text-muted-foreground">
										Download the latest HumanLayer app for Apple silicon.
									</p>
								</div>
								<Button asChild>
									<a href={downloadUrl} download>
										Download for Mac
										<Download className="h-4 w-4 ml-2" aria-hidden="true" />
									</a>
								</Button>
							</div>

							<div className="space-y-3 pt-2">
								<div>
									<h3 className="font-medium text-foreground">Or install with Homebrew</h3>
									<p className="text-sm text-muted-foreground">
										Prefer the command line? Use the Homebrew cask.
									</p>
								</div>
								<div className="relative">
									<pre className="overflow-x-auto rounded-lg bg-muted p-4 pr-14 font-mono text-sm">
										<code>{installCommand}</code>
									</pre>
									<Button
										onClick={handleCopy}
										variant="outline"
										size="icon"
										className="absolute right-2 top-2 h-8 w-8"
									>
										{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
									</Button>
								</div>
							</div>

							<div className="text-sm text-muted-foreground">
								<p className="mb-2">After installation:</p>
								<ol className="list-decimal list-inside space-y-1">
									<li>Open the HumanLayer application</li>
									<li>Sign in with your account</li>
									<li>Start using HumanLayer with your organization</li>
								</ol>
							</div>

							<div className="rounded-lg bg-accent/10 p-4 text-sm text-muted-foreground">
								<h3 className="font-medium text-foreground mb-2">Running on Linux or Windows?</h3>
								<p>
									The desktop app is macOS-only today, but you don't need it. Run the daemon anywhere
									and drive everything from your browser &mdash;{' '}
									<a
										href="https://docs.humanlayer.com/guide/remote-daemons"
										target="_blank"
										rel="noopener noreferrer"
										className="font-medium text-primary hover:underline"
									>
										follow the remote daemon guide
									</a>
									.
								</p>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="p-6">
							<CardTitle>Start here</CardTitle>
							<CardDescription>{featuredVideo.description}</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-1 flex-col space-y-4 pb-4">
							<VideoThumbnail guide={featuredVideo} />
							<a
								href="https://docs.humanlayer.com"
								target="_blank"
								rel="noopener noreferrer"
								className="flex flex-1 flex-col justify-center rounded-lg bg-accent/10 p-4 transition-colors hover:bg-accent/20"
							>
								<h3 className="font-medium text-foreground mb-1 flex items-center gap-2">
									<BookOpen className="h-4 w-4" />
									Read the docs
								</h3>
								<p className="text-sm text-muted-foreground">
									Guides, references, and how-tos for setting up HumanLayer and getting the most out
									of your agents.
								</p>
							</a>
						</CardContent>
					</Card>
				</div>

				{/* WATCH THE TALKS: product demos as clickable thumbnails */}
				<Card>
					<CardHeader className="pt-6 text-center">
						<CardTitle>End to end product deep dives</CardTitle>
						<CardDescription></CardDescription>
					</CardHeader>
					<CardContent className="pb-4">
						<div className="grid gap-4 md:grid-cols-2">{productGuides.map(renderGuide)}</div>
					</CardContent>
				</Card>

				{/* OPERATING MODEL & PHILOSOPHY: mixed grid of talks (thumbnails) + reading (links) */}
				<Card>
					<CardHeader className="pt-6 text-center">
						<CardTitle>The HumanLayer way</CardTitle>
						<CardDescription>Move fast, seek leverage, own the code.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 pb-4">
						{/* Blog-shaped reading first: full-width rows, one per line */}
						<div className="space-y-4">
							{philosophyGuides
								.filter((guide) => !guide.videoId)
								.map((guide) => (
									<GuideLinkCard key={guide.link} guide={guide} />
								))}
						</div>
						{/* Then the talks: two video thumbnails side by side */}
						<div className="grid gap-4 md:grid-cols-2">
							{philosophyGuides
								.filter((guide) => guide.videoId)
								.map((guide) => (
									<VideoGuideCard key={guide.link} guide={guide} />
								))}
						</div>
					</CardContent>
				</Card>

				{/* GET ORIENTED: first-task tips */}
				<Card>
					<CardHeader className="p-6">
						<CardTitle>Get oriented</CardTitle>
						<CardDescription>
							HumanLayer asks you to put in some time to learn a new way of building. A couple of tips for
							your first session.
						</CardDescription>
					</CardHeader>
					<CardContent className="pb-4">
						<div className="grid gap-4 md:grid-cols-2">
							<div className="rounded-lg bg-accent/10 p-4">
								<h3 className="font-medium mb-2">A good first task</h3>
								<p className="text-sm text-muted-foreground">
									Choose something real - pick a task you would actually work on. If you already have
									it very well specified, that's great, but HumanLayer really shines at taking vague
									requests and turning them into high-quality technical specifications for agents to
									implement.
								</p>
							</div>
							<div className="rounded-lg bg-accent/10 p-4">
								<h3 className="font-medium mb-2">Alignment and collaboration</h3>
								<p className="text-sm text-muted-foreground">
									As you're working, use docs and artifacts to develop a shared mental model with the
									agent - share a design discussion with a teammate{' '}
									{`(ideally whoever would be reviewing your PR)`} to get their comments and feedback,
									and then send those comments to the agent.
								</p>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* COMMON QUESTIONS: FAQ, moved to the bottom */}
				<Card>
					<CardHeader className="p-6">
						<CardTitle>Common questions</CardTitle>
						<CardDescription>The things new users most want to know before they dig in.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 pb-4">
						{commonQuestions.map((item) => (
							<div key={item.question} className="rounded-lg bg-accent/10 p-4">
								<h3 className="font-medium mb-2">{item.question}</h3>
								<p className="text-sm text-muted-foreground">{item.answer}</p>
							</div>
						))}
					</CardContent>
				</Card>

				<div className="flex justify-center gap-3">
					<Button variant="outline" asChild>
						<Link to="/organizations/select">
							<ArrowRightLeft className="h-4 w-4 mr-2" />
							Switch Organizations
						</Link>
					</Button>
					<Button variant="outline" onClick={() => signOut({ returnTo: window.location.origin })}>
						<LogOut className="h-4 w-4 mr-2" />
						Sign Out
					</Button>
				</div>
			</div>
		</div>
	)
}
