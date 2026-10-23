export async function waitFor(condition: () => boolean, interval: number = 250): Promise<void> {
	return new Promise((resolve) => {
		setInterval(() => {
			if (condition()) resolve()
		}, interval)
	})
}
