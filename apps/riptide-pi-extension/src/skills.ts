// Offers the skills in this package's `skills/` folder to pi, so `/skill:create-research` and friends
// work in pi as they do in HumanLayer sessions, with no HumanLayer app installed. The folder is pi's
// own copy of the rpi and humanlayer plugin skills, with a few left out or renamed.

import { fileURLToPath } from 'node:url'

export function bundledSkillPaths(): string[] {
	return [fileURLToPath(new URL('../skills/', import.meta.url))]
}
