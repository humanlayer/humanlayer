/**
 * What the composer says when this deployment lacks an integration's keys. No action goes with
 * it: only whoever runs the deployment can add the keys.
 */
export function integrationNotSetUpMessage(name: string): string {
	return `${name} is not set up on this instance. Check with your admin.`
}
