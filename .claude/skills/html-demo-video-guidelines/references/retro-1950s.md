# Retro / 1950s / Art Deco cuts

Extra guidance for period restyles. Everything in the main skill still applies unless this file says otherwise. The worked example is the 1950s cut of the "tomorrow" video in `~/Desktop/hl-retro/`; its `STYLE.md` has the full design kit and scene plan.

## The idea

- Tell the same script with another era's tools: a 1950s black-and-white Art Deco industrial film (BioShock's Rapture, radio-era optimism, accountants doing it all by hand on paper).
- Agents are thinking machines that print on paper tape. Sessions are teletype rolls. Artifacts are typed memos. A task is a case file. A diff is a ledger page with pencil corrections. Approval is a signature and a rubber stamp. Slack is a telegram.
- Make every object period-true: no screens, laptops, emoji or modern icons. Keep the real task content (names, files, the real plan). Play it straight; never wink.
- Black and white only. Film flicker, gate weave, dust and scratches. Transitions are dissolves, wipes, irises and cuts; always an iris between reels.

## Voice

- Use a period announcer, not a modern stock voice and not Dex's clone.
- Dex liked these ElevenLabs library voices best (model `eleven_multilingual_v2`):
  - Clyde: `QMJTqaMXmGnG8TCm8WQG`
  - Max (1940s): `dqbqOZM4uhsyx1WtTAgT`
  - Celeste: `MftN0gvsFPPOYnV3DU0Y`
  - Jim: `MttcBdHlfJSKTSBOKkJB`
  - Retro Radio Man (`7bkVPISi1Px9rahRsmjF`) was also cut. No verdict yet.
- Dex rejected Sarah (`EXAVITQu4vr4xnSDxMaL`) on a second listen. Velvet Noir, Mikey Slater and Steven Dollenberg were auditioned but not picked.
- Settings: stability 0.45, similarity 0.8, style 0.3. Jim needs more push: stability 0.28, style 0.65.
- Always use the radio-treated version: band-limited (about 150 Hz to 6 kHz), a presence bump, tube warmth, a small plate room and light wow and flutter. Dex preferred it to the clean voice every time.
- Make 3 takes a line. Pick by speech-to-text accuracy, then by the liveliest delivery.

## Opening

The main skill's "no hype" rule gives way here. Open like a wartime newsreel:

1. A film-leader countdown ("3, 2", beep).
2. A brass fanfare stinger on the cut to the title card: short notes, then a held chord. It must be a horn, not just a swell in the score.
3. The narrator calls out the title: "HumanLayer! The Software Forge... of Tomorrow!" Record this line hot (stability about 0.3, style about 0.75) and make 4 takes. Pick one that clearly says "HumanLayer"; takes often come out as "Human Lair".
4. Hang the motion on the sound:
   - The logo's three bars slam down on the fanfare's three notes.
   - The held chord flashes the frame and opens light rays.
   - The logo holds through "HumanLayer!", then rises out of the way.
   - Each word of the title lands as it's spoken.

## Music and sound

- The score: a 1950s industrial-film orchestra with a small swing band, mono and warm, one steady tempo, with sections that follow the story. Generate it from one ElevenLabs composition plan with section lengths taken from the narration.
- Keep the score silent under the fanfare and the spoken title; bring it in on the first line.
- Land a big brass hit on "software forge", and a last chord on the end card that rings out under the fade.
- Period sound effects on the action: typewriter, teletype, stamp, pneumatic tube, rotary dial, drawer and bell.
- Beds under everything: projector whir and optical crackle.
- Master like an optical track: narrow stereo, 60 Hz to 10 kHz, -14 LUFS.

## Several narrators, one picture

- Build the scenes once, on one narrator's word times. For every other narrator, map real time onto those authored times (a smooth, monotone time warp anchored on every shared word) instead of re-timing scenes. Captions and sound cues stay on the real clock.
- Each narrator needs their own score take, because section lengths follow the narration. If you can't generate one, retime another voice's score by cutting or repeating whole bars inside sections, where the rhythm matches.
- Check the ending: the last chord must land on the end card, not under the fade.
- Budget ElevenLabs credits. One full cut costs about 6,500: about 2,800 for three takes of every line, plus about 3,700 for two score takes. The Starter plan's 40,000 runs out after a few narrators.
