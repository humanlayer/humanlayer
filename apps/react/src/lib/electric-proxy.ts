const ELECTRIC_URL =
	process.env.ELECTRIC_URL ?? 'http://localhost:3000/v1/shape'

export async function proxyToElectric(request: Request, table: string) {
	// build the query parameters to electric from the original request
	const originUrl = new URL(ELECTRIC_URL)
	const url = new URL(request.url)
	url.searchParams.forEach((value, key) => {
		originUrl.searchParams.set(key, value)
	})

	// TODO figure out the token and the source ID
	//originUrl.searchParams.set(`token`, Resource.electricInfo.token)
	//originUrl.searchParams.set(`source_id`, Resource.electricInfo.database_id)

	originUrl.searchParams.set(`table`, table)
	// TODO this is where you would do a query or a clause to check if the requested document belongs to the organization based on the user's auth token

	// Create a copy of the original headers to include in the fetch to the upstream.
	const requestClone = request.clone()
	const headersClone = new Headers(requestClone.headers)

	console.log(`Fetching shape from Admin Electric: ${originUrl.toString()}`)

	const response = await fetch(originUrl.toString(), {
		headers: headersClone,
	})

	return response
}
