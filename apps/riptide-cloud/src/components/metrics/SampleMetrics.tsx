import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'

// Hand-set drawings, not the real cards fed fake rows: the real cards fetch, and an org without
// commit tracking is not entitled to the numbers those queries compute.
export function EfficiencySample() {
	return (
		<div className="flex flex-col gap-6">
			<div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
				<SampleKpi label="Cost per commit" value="$3.84" detail="1,284 commits" highlighted />
				<SampleKpi label="Cost per 1k lines" value="$1.19" detail="4.1M lines changed" />
				<SampleKpi label="Cost per merged PR" value="$27.60" detail="178 merged" />
			</div>
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
				<Card className="lg:col-span-3">
					<CardHeader>
						<CardTitle>Spend vs commits, by person</CardTitle>
						<CardDescription>Every member with a session in range</CardDescription>
					</CardHeader>
					<CardContent>
						<svg viewBox="0 0 420 190" className="h-[220px] w-full" role="presentation">
							<g className="stroke-border" strokeWidth="1">
								<line x1="44" y1="16" x2="410" y2="16" />
								<line x1="44" y1="58" x2="410" y2="58" />
								<line x1="44" y1="100" x2="410" y2="100" />
								<line x1="44" y1="142" x2="410" y2="142" />
							</g>
							<g className="fill-primary">
								<circle cx="78" cy="146" r="5" />
								<circle cx="104" cy="132" r="5" />
								<circle cx="131" cy="138" r="5" />
								<circle cx="158" cy="118" r="6" />
								<circle cx="176" cy="126" r="5" />
								<circle cx="199" cy="104" r="6" />
								<circle cx="221" cy="112" r="5" />
								<circle cx="246" cy="88" r="7" />
								<circle cx="268" cy="96" r="5" />
								<circle cx="291" cy="74" r="6" />
								<circle cx="314" cy="82" r="5" />
								<circle cx="337" cy="60" r="7" />
								<circle cx="362" cy="68" r="5" />
								<circle cx="386" cy="44" r="6" />
								<circle cx="352" cy="128" r="7" />
								<circle cx="128" cy="42" r="7" />
							</g>
							<g className="fill-muted-foreground" fontSize="9">
								<text x="8" y="20">
									$4k
								</text>
								<text x="8" y="104">
									$2k
								</text>
								<text x="8" y="164">
									$0
								</text>
								<text x="44" y="180">
									0
								</text>
								<text x="352" y="180">
									240 commits
								</text>
							</g>
						</svg>
					</CardContent>
				</Card>
				<Card className="lg:col-span-2">
					<CardHeader>
						<CardTitle>Cost per commit over time</CardTitle>
						<CardDescription>7-day trailing</CardDescription>
					</CardHeader>
					<CardContent>
						<svg viewBox="0 0 280 190" className="h-[220px] w-full" role="presentation">
							<g className="stroke-border" strokeWidth="1">
								<line x1="40" y1="24" x2="272" y2="24" />
								<line x1="40" y1="68" x2="272" y2="68" />
								<line x1="40" y1="112" x2="272" y2="112" />
								<line x1="40" y1="156" x2="272" y2="156" />
							</g>
							<polyline
								points="56,52 100,74 144,66 188,96 232,110 266,104"
								className="stroke-primary"
								fill="none"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
							<circle cx="266" cy="104" r="4" className="fill-primary" />
							<g className="fill-muted-foreground" fontSize="9">
								<text x="8" y="28">
									$6
								</text>
								<text x="8" y="116">
									$2
								</text>
							</g>
						</svg>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}

export function AdoptionSample() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Agent commits by repository</CardTitle>
				<CardDescription>1,284 commits across 11 repositories</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex flex-col gap-3">
					<SampleBar name="riptide-ui" width="100%" value="412" />
					<SampleBar name="riptide-api" width="71%" value="293" />
					<SampleBar name="riptide-daemon" width="48%" value="198" />
					<SampleBar name="packages/ui" width="31%" value="127" />
					<SampleBar name="pulumi-infra" width="17%" value="71" />
				</div>
			</CardContent>
		</Card>
	)
}

function SampleKpi({
	label,
	value,
	detail,
	highlighted = false,
}: {
	label: string
	value: string
	detail: string
	highlighted?: boolean
}) {
	return (
		<div className={`flex flex-col gap-1 rounded-lg border p-4 ${highlighted ? 'border-primary' : ''}`}>
			<span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
			<span className="font-semibold text-3xl tabular-nums">{value}</span>
			<span className="text-muted-foreground text-xs tabular-nums">{detail}</span>
		</div>
	)
}

function SampleBar({ name, width, value }: { name: string; width: string; value: string }) {
	return (
		<div className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3">
			<span className="truncate text-muted-foreground text-xs">{name}</span>
			<span className="h-3.5 bg-muted">
				<span className="block h-full bg-primary" style={{ width }} />
			</span>
			<span className="text-right text-xs tabular-nums">{value}</span>
		</div>
	)
}
