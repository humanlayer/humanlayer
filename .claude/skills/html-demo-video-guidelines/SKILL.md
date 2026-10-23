---
name: html-demo-video-guidelines
description: |
  Dex's taste for product demo / hype videos built as HTML + JS motion graphics and
  rendered to MP4. ACTIVATE when making or revising a demo video, launch video, hype
  video, or animated product walkthrough. A short do / don't list, not a how-to.
---

# HTML demo video guidelines

Keep this list current. When Dex gives new feedback on a video, add it here in the same short form.

## Do

- Look at source footage through contact sheets to learn what the product looks like.
- Transcribe the source demos to learn how Dex talks about the feature, then write in that register.
- Build every visual as HTML / JS motion graphics and render frames from a timeline.
- When the source is Dex talking over a screen share, keep his original voice track, add music under it, and replace only the screen recordings.
- Redraw the product UI in simplified, on-brand form: real fonts, real colors, real layout, fewer details.
- Use one realistic task that runs through the whole video.
- Show real-looking work: a real code diff with syntax highlighting, and an artifact that reads like a real plan or doc.
- Show cause and effect side by side. The agent works on the left, the product reacts on the right, and both stay on screen.
- Move focus by growing the active panel and shrinking and dimming the other. Don't cut away.
- Make key UI actions easy to see: the button, the hover state, the click, the result.
- Use one short caption at a time: big, centered, near the bottom, on a dark backdrop.
- Write captions as a plain sentence that says what is happening on screen, like "teammates can comment on the diff while pi is working".
- Land a joke as a normal caption. Dry, not loud.
- Show collaboration with live cursors and named teammates.
- When the line is about the whole team's work, show the task board (kanban columns filling with teammates' tasks, one card moving across).
- End on the few core ideas drawn as a system: nodes, links, things flowing both ways, then collapse into the logo.

- Size for the screen, not the app. Focal content fills 70–85% of the frame; primary text ≥ 26px and code ≥ 22px at 1080p. Move the camera to the action.
- Hunt for sloppiness before calling it done: dense stills every 0.25–0.5s, looking for lines drawn through text, crops that cut words, dead frames over ~0.6s, key beats drawn too small, and blank frames between scenes.
- Make the "instead of the old way" beats literal: draw the old thing (a GitHub "Create pull request" button, a shared doc, a weekly sync) and strike it out.

- If the user asks for a retro, 1950s, Art Deco or other period cut, read `references/retro-1950s.md` (next to this file) first. It overrides parts of this list, including the voice and the opening.

## Don't

- Use raw frames or clips from source footage. Motion graphics only.
- Follow the demo talk track closely. The order and the details can change.
- Reuse the throwaway examples from the demos. Replace them with realistic ones.
- Open with hype: slam cuts, "until now", "your X, your Y, your Z", big trailer drops.
- Use a stock narrator for a modern cut. He hated the "funky MC" voice, and a calm stock voice (Sarah) in the modern tomorrow cut. Keep Dex's real voice track when there is one. For new lines, use the ElevenLabs instant clone of his voice (voice id `8Y0gqGyDDr7HsKEDM5w7`, model `eleven_multilingual_v2`, stability 0.5, similarity 0.9, style 0). Make 3 takes a line and pick by speech-to-text accuracy, then closeness to his real voice. Keep the lines plain and conversational.
- Pulse or bounce the screen to the beat.
- Hide important actions in tiny or low-contrast UI.
- Stack a headline over subtext. Nobody reads both.
- Write captions that sound like AI marketing: tool names, lists of three, "X, as it happens", clever fragments.
- End on a grid of feature tiles.

## Vertical (9:16) cuts

Make one for every video. Same audio, same timings, new layouts.

- Redesign, don't resize. Rewrite each scene for the portrait stage (1080x1920).
- Keep key content in x 60–1020, y 200–1600. The usable box above the captions is nearly square (about 960x1160). Platform UI covers the bottom ~300px and the right edge.
- Put captions on their own layer at a fixed height (about y 1400–1560): 56–64px bold, at most two lines. Plan every layout around that band.
- Turn side-by-side into stacked: cause on top, effect below. Move focus by resizing and dimming panels, not by scaling them down; text must never shrink.
- Cut before you shrink: fewer rows and columns, code under ~58 characters a line, no minimaps. UI text at least ~26px, code at least ~24px.
- Pan inside panels to follow the newest line or hold on the thing being clicked. Open comment boxes under the line they point at.
- Keep horizontal whips between scenes. A vertical swipe looks like scrolling to the next video.
- Space orbits and scatters evenly along tall ellipses so they don't collide.
- Check stills at phone size (360x640), not only full size.
