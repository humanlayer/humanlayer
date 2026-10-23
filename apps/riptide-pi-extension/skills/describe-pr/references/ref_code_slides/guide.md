# Code Slide Deck Guide

Use this reference when a substantial PR benefits from an HTML slide deck that explains how the implementation works. The deck is not a table of contents, a review checklist, or a prettier PR description. It is a progressive visual explanation that lets a reviewer build the right mental model before encountering implementation details.

Start from `template.html` in this directory. Preserve its visual system, slide sizing, navigation, and reusable diagram primitives, then replace every placeholder with facts and real code from the PR.

## Core Narrative: Descend in Altitude

Structure the deck as a continuous zoom from product intent to code:

1. **50,000 ft — product and system move.** Show what changes for users, why the change exists, the rollout boundary, and what remains on the old path. Prefer one system flow and one mocked product layout over prose.
2. **25,000 ft — program architecture.** Show package/application boundaries, responsibility layers, component composition, and state ownership. Make the shape of the program visible.
3. **10,000 ft — runtime behavior.** Show the main data pipeline and the important call stacks or event sequences. Explain how user intent travels through hooks, pure models, state, and rendering.
4. **Code level — decisive implementation details.** Use real, focused snippets with numbered annotations and worked examples. Explain the algorithms and subtle ordering constraints that make the behavior correct.
5. **Landing — resulting foundation.** State what is now true, what is deliberately absent, and which architectural seam later work will reuse.

The levels must build on one another. Do not tell the reviewer what files to read or prescribe a review order. Show the system at increasing resolution so the reviewer arrives at the code already understanding why it has its shape.

## Required Research Before Writing

- Read the complete PR diff, not only commit summaries.
- Read the implementation files that own the principal runtime path.
- Read pure-model tests when they reveal invariants, edge cases, or worked examples.
- Identify the real entry point, rollout boundary, package boundaries, state owners, event handlers, pure transformations, and rendering endpoint.
- Verify every function name, prop, state field, constant, branch condition, and snippet against live code.
- Prefer code from the PR. Use conceptual pseudocode only for a tiny boundary diagram, and label it conceptual.

## Visual Language

The deck renders inside an IDE-like artifact viewer and should match that environment:

- **Palette:** poimandres-inspired dark terminal colors. Deep navy background, pale blue headings, mint success/data flow, pink annotations, rose warnings, yellow special conditions.
- **Typography:** system sans for prose; IBM Plex Mono for code, labels, stats, file names, keys, and diagram chrome.
- **Geometry:** square corners only. Use one-pixel borders, dark panels, and restrained translucent fills.
- **Density:** fill a 1440×900 viewport with useful structure, but keep clear grouping and strong alignment. Avoid both giant empty regions and unreadable walls of text.
- **Hierarchy:** a small mono kicker establishes altitude and subject; a concise heading states the slide's conclusion; the visual body proves it.
- **Color semantics:** use colors consistently. Accent for architecture, mint for active/new/data-flow paths, pink for numbered annotations, rose for caveats, muted gray for unchanged or secondary paths.

Do not introduce unrelated brand styling, rounded cards, generic presentation gradients, oversized decorative titles, or light-theme slides.

## Layout Rules

- Each slide is exactly `100vw × 100vh` and uses `overflow: hidden` at desktop size.
- Design for 1440×900 first. Content must fit without scrolling at that viewport.
- Use a fixed header area and a flexible `.body` with `min-height: 0`.
- Keep headings concise enough to stay on one or two lines.
- Prefer diagrams, grids, code, and annotations over paragraphs.
- Use responsive fallbacks for narrow screens, where slide scrolling is acceptable.
- Keep navigation controls, slide numbers, progress bar, arrow keys, Page Up/Down, Space, Home, and End.
- Test all slides for content, clipping, and accidental dead space. A slide with a heading in the upper-left and an empty lower half is not complete.

## High-Value Visual Patterns

### 1. System Flow with a Fork

Use bordered boxes and connector arrows to show a host, gate, and old/new paths. This is ideal for feature flags, migrations, adapters, compatibility layers, and phased rollouts.

Include a small real or clearly conceptual boundary snippet inside the gate when it helps. Visually dim unchanged paths and highlight the path introduced by the PR.

### 2. Mocked Product Layout with Numbered Pins

Build a simplified CSS mock of the actual interface instead of embedding a screenshot when the layout itself explains the feature.

- Represent the real regions: sidebar, toolbar, document, panel, rail, canvas, or modal.
- Show representative states such as active rows, focus rings, badges, or selected blocks.
- Place numbered pins directly on the relevant UI areas.
- Pair the mock with matching numbered callout cards that explain behavior and implementation significance.
- Include relevant keyboard shortcuts as keycaps beneath the mock.

The mock should teach spatial relationships and interaction ownership, not imitate every visual detail.

### 3. Layered Program Architecture

Use a vertical stack for responsibility boundaries. Typical layers include:

- host surfaces
- rollout or routing boundary
- app composition
- shared layout/components
- pure domain models
- persistence or view extensions

Place files or modules inside their owning layer. Add side rails such as “models & props down” and “events & callbacks up” to make directionality explicit. The goal is to show why code lives where it does, not merely list directories.

### 4. Annotated Component Tree

Render a real component tree in monospace with box-drawing characters. Annotate each node inline with:

- state ownership
- keyed remount boundaries
- data subscriptions
- callback refs
- persisted layout state
- plugin/extension ownership
- caller-supplied children

Pair the tree with state-ownership cards. This makes composition and lifecycle much clearer than prose or a flat file list.

### 5. Pipeline Bands

Use horizontal bands for transformations such as:

```text
INPUT → PARSE → INDEX → BEHAVE → RENDER
```

Each band should name real functions and real data structures. Show where work is pure, where DOM or network reality enters, and where separate paths converge.

### 6. Call Stacks and Sequence Diagrams

Use lifelines and directional arrows for interactions where ordering matters:

- user action → component callback → state owner → plugin/API/DOM
- event → observer/hook → pure selector → render
- request → contract → procedure → database → sync → client

Label messages with real function calls and important arguments. Add self-call boxes for local computation. Use dashed arrows for callbacks, measurements, or responses when useful.

One sequence should explain one scenario. Split unrelated scenarios side by side only when comparison is the lesson.

### 7. Detailed Code with Numbered Annotations

Use real snippets, trimmed to the decisive logic. Preserve enough context to understand inputs, branches, and outputs.

- Add `①`, `②`, `③`, and `④` at important lines.
- Pair the code with matching annotation cards.
- Syntax-color keywords, functions, strings, comments, and punctuation consistently.
- Include worked input/output examples for algorithms.
- Explain why ordering, fallback behavior, identity, cleanup, or mapping matters.
- Do not dump an entire file or paste code merely because it changed.

The best code slides answer “why is this correct?” rather than “what syntax was added?”

## Choosing Slides

Scale the deck to the PR. A substantial architectural PR usually needs 8–14 slides. A useful default is:

1. 50k system move and rollout boundary
2. 50k product behavior mock
3. 25k layered program architecture
4. 25k component tree and state ownership
5. 10k runtime data pipeline
6. 10k primary call stack
7. 10k secondary event flow or lifecycle
8. code-level core algorithm
9. code-level canonical model or data transformation
10. code-level state/plugin/persistence mechanism
11. code-level integration edge case
12. resulting foundation and deliberate exclusions

Remove slides that do not teach anything. Add slides when two distinct runtime paths cannot be explained legibly together.

## Content Standards

- Every slide title should make a claim, not name a topic.
- Every diagram label should use domain language from the codebase.
- Every file/module shown must have a reason to appear.
- Include important negative space in the design: unchanged paths, intentionally absent features, and explicit non-goals.
- Distinguish persistent state, React state, derived values, external-store state, and transient editor/view state.
- Surface subtle correctness constraints such as ordering, cleanup, remount behavior, duplicate identity, race suppression, transaction mapping, or fallback rules.
- Explain mirrored implementations or parity boundaries without duplicating whole slides.
- Avoid unsupported metrics. If using counts, derive them from PR metadata or tests.

## Anti-Patterns

- “Read these files in this order.”
- A deck that is mostly headings and bullet lists.
- Generic architecture boxes labeled only “frontend,” “backend,” and “database.”
- File inventories without ownership or dataflow.
- Decorative diagrams that do not correspond to runtime behavior.
- Tiny code pasted across an entire slide.
- Huge title typography that leaves most of the viewport empty.
- Screenshots with no annotations or explanation.
- Repeating the PR description verbatim.
- Placeholder content left in the final artifact.
- Claims inferred from a plan but not verified in the implementation.

## Validation Checklist

Before publishing:

- Confirm the narrative descends 50k → 25k → 10k → code.
- Confirm the first two slides explain the product and system without requiring code knowledge.
- Confirm at least one visual product mock appears when the PR changes visible UI.
- Confirm component trees and architecture diagrams reflect actual ownership.
- Confirm call stacks use real handlers, hooks, procedures, or methods.
- Confirm code snippets are real, focused, and annotated.
- Confirm all placeholder tokens are gone.
- Confirm exactly one slide is active initially.
- Confirm every slide has a kicker, heading, body, and slide number.
- Confirm controls and keyboard navigation work.
- Confirm all desktop slides fit at 1440×900 with no clipping.
- Confirm there are no sparse slides with large accidental dead zones.
- Confirm the final slide states both the resulting foundation and deliberate exclusions.
