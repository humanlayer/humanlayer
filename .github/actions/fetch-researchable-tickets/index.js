import * as core from "@actions/core";
import { LinearClient } from "@linear/sdk";

async function run() {
	try {
		const numTickets = parseInt(core.getInput("num_tickets") || "10", 10);

		console.log(`Fetching ${numTickets} linear tickets...`);

		const apiKey = process.env.LINEAR_API_KEY;
		if (!apiKey)
			throw new Error(
				"Missing Linear API Key in environment (set LINEAR_API_KEY)",
			);

		const linear = new LinearClient({ apiKey });
		if (!linear)
			throw new Error("Linear client not initialized. Check your API key");

		// Fetch S / XS-sized linear tickets in the current cycle
		const result = await linear.issues({
			first: numTickets,
			filter: {
				and: [
					// XS = 1, S = 2 -- empirically tested
					{ or: [{ estimate: { eq: 1 } }, { estimate: { eq: 2 } }] },
					{
						state: {
							name: { eq: "research needed" },
						},
					},
				],
			},
		});

		// Return a list of linear ticket IDs e.g. ENG-XXXX NOT the UUID format
		core.setOutput(
			"researchable_ticket_ids",
			JSON.stringify(result.nodes.map((node) => node.identifier)),
		);
		console.log(
			`Fetched ${result.nodes.length} eligible tickets: `,
			result.nodes.map((node) => node.identifier).join(", "),
		);

		// We have to fetch  because it's an N+1
	} catch (error) {
		core.setFailed(error.message);
	}
}

run();
