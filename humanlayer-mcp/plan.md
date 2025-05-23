Implementing the humanlayer-mcp CLI (TypeScript MCP Server)

In this guide, we will create a TypeScript-based Model Context Protocol (MCP) server CLI called humanlayer-mcp. This CLI tool will handle permission prompts for Anthropic’s Claude Code and integrate with HumanLayer’s approval API. We’ll go step-by-step from project setup to testing the dummy server and then integrating the real HumanLayer API.

Step 1: Project Setup (New Folder in Repo)

<DONE>

2. Initialize a Node project in humanlayer-mcp:
   DONE
3. Add a TypeScript config (tsconfig.json) to compile to Node-compatible JavaScript. For example:
   <DONE>

### Step 2: Implementing the Dummy MCP Server (Stdio JSON-RPC)

The MCP server will communicate via STDIO – reading JSON-RPC requests on stdin and writing responses to stdout. We’ll handle MCP tools/call requests in a minimal way: log the request, wait 10 seconds, then respond with an approval. Open src/index.ts and add the following code:
ts
Copy
Edit
#!/usr/bin/env node

// Simple MCP server that approves all permission requests after a delay.
import \* as process from 'process';

// Helper: Sleep for N milliseconds (returns a Promise)
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// Read STDIN stream for incoming JSON-RPC requests
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
buffer += chunk;
// Process each complete JSON object (assuming newline-delimited JSON)
const lines = buffer.split('\n');
buffer = lines.pop() || ''; // keep incomplete part if any
for (const line of lines) {
if (!line.trim()) continue;
try {
const request = JSON.parse(line);
console.log("Received MCP request:", request); // Log the incoming request

      if (request.method === 'tools/call') {
        // Simulate processing: sleep for 10 seconds
        await sleep(10000);
        // Prepare an "approved" result. We return a JSON-RPC response with the same id.
        const response = {
          jsonrpc: "2.0",
          id: request.id,
          result: "approved"   // Indicate permission granted
        };
        // Write the response to STDOUT (as a single line JSON)
        process.stdout.write(JSON.stringify(response) + '\n');
      } else {
        // Optionally handle other methods like 'initialize' or 'tools/list' if needed
        const response = {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: `Method ${request.method} not implemented` }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err) {
      console.error("Error processing MCP input:", err);
    }

}
});

A few notes on this implementation:

We include a shebang (#!/usr/bin/env node) at the top so the script can be executed directly when installed as a CLI tool.
We accumulate data from stdin and split by newline. We assume each JSON-RPC message is delimited by newline. (Claude Code’s MCP transport uses JSON-RPC 2.0 over stdio
arshren.medium.com
.)
On receiving a JSON RPC request:
We log it (to stderr via console.log, which will show up in Claude’s console logs).
If method === "tools/call", we handle it:
In this dummy version, we simulate a slow external check by sleeping 10 seconds.
Then we construct a JSON-RPC response with the same id and a result indicating approval.
We choose the string "approved" as the result. (Claude expects an approval response like "approved" or "yes" to allow the action
github.com
.)
We write the response back to stdout, followed by a newline, so the Claude client can parse it.
If other methods come (like initialize or tools/list), we simply respond with a JSON-RPC error indicating it’s not implemented. (For a complete server, you might implement initialize and tools/list to announce the available tool(s), but Claude Code can often work without an explicit list if the tool name is known and allowed.)
After writing this code, run npm run build to compile to JavaScript. Ensure that dist/index.js is generated and has the expected content (including the shebang).

.
--allowedTools "mcp**auth**prompt" explicitly allows the use of our prompt tool
docs.anthropic.com
docs.anthropic.com
(Claude requires all tools to be whitelisted for security).
--permission-prompt-tool mcp**auth**prompt tells Claude to use this MCP tool whenever a permission prompt is needed (in non-interactive mode)
docs.anthropic.com
. Claude will then spawn our server and call the prompt tool via JSON-RPC whenever it needs to ask “Should I proceed with X?”.
Claude Desktop: In Claude Desktop, you can similarly configure custom MCP servers. Claude Desktop typically reads a config file for MCP (often the same format). If Claude Desktop has a UI or config directory, add the above JSON to its MCP servers configuration (commonly in a servers.json or via a “Claude MCP Hub”). For example, some users have reported adding custom servers in config/mcphub/servers.json for Claude Desktop
hexdocs.pm
. Ensure the entry for "auth" matches the format above. Then enable the permission prompt tool in Desktop settings or launch parameters similarly to the CLI (Desktop may have a way to specify allowed tools and permission prompt tool; if not via UI, you might run the Desktop app with equivalent flags or ensure they are set in configuration).
Testing the dummy server: Using the Claude CLI example above, try a command that would normally require a permission. For instance, asking Claude to write to a file or execute code often triggers a permission prompt. When you run the CLI command:
Claude will start, detect it’s in non-interactive mode with a permission prompt tool configured.
When the AI attempts a privileged action (like file write), Claude will send a JSON-RPC request to our auth server (method tools/call, tool name prompt). You should see our console.log output showing the received request (including details of the request) in the terminal running Claude.
Our server will wait 10 seconds, then respond with "approved". Claude will interpret that as the permission being granted and proceed with the action (e.g. it will actually create the file or continue the task, as if the user said "Yes").
You should see Claude’s normal output after the delay, now performing the action without manual approval. If you enable verbose logging in Claude, you may also see logs about connecting to the MCP server and the tool call.
(If something doesn’t work: double-check that the server was started (Claude will show if it failed to launch the tool). Ensure --allowedTools includes the exact mcp**auth**prompt string. Also verify your servers.json is being loaded by adding a nonsense server to see if Claude errors out, to ensure it’s reading the file.)
Step 5: Example servers.json for Claude Desktop Integration
To integrate with Claude Code Desktop, use a similar configuration. Here’s an example servers.json entry as we created above, which you can adapt for Claude Desktop:
json
Copy
Edit
{
"mcpServers": {
"auth": {
"command": "npx",
"args": [ "-y", "humanlayer-mcp" ]
}
}
}
In Claude Desktop, locate the settings or configuration folder for MCP servers. If a servers.json exists (or you can create one), insert the "auth" server definition. The Desktop app might have a UI to add an MCP server by providing the command and name – if so, use auth as the server name, npx as the command, and -y, humanlayer-mcp as the arguments (and include any needed environment variables or paths if applicable). After adding the server, ensure you also configure Claude Desktop to allow the mcp**auth**prompt tool and set it as the permission prompt tool. This might be done in a config file or via launching Claude Desktop with flags. For example, if Claude Desktop supports CLI flags or a config file for allowed tools, include:
Allowed tools: mcp**auth**prompt (to whitelist our prompt tool).
Permission prompt tool: mcp**auth**prompt (to direct permission queries to our server).
Once set up, Claude Desktop will behave like the CLI: whenever a permission is required, it will route the prompt to our humanlayer-mcp server. The dummy server will auto-approve after 10 seconds, allowing Claude Desktop to proceed without manual clicks.
Step 6: Replacing Dummy Logic with HumanLayer API Calls
So far, our humanlayer-mcp tool just auto-approves every request. In a real scenario, we want to call HumanLayer’s FunctionCall API to get human approval for each request. HumanLayer’s platform allows you to create an approval workflow (e.g., send a Slack message or email to a human for confirmation) and wait for a response
humanlayer.dev
humanlayer.dev
. We will modify our server to use HumanLayer’s API instead of a fixed delay. Integrating HumanLayer:
Install the HumanLayer SDK in our project:
bash
Copy
Edit
npm install humanlayer
This gives us access to HumanLayer’s TypeScript SDK for making API calls
npmjs.com
. (Ensure you have your HumanLayer API key from the dashboard and set it as an environment variable or configuration.)
Decide on the function to call: We will use HumanLayer’s Function Call API to request approval. We can name the function request_permission (this will be the fn in the API call) to clearly indicate its purpose. In HumanLayer, “Function Calls” are a way to ask a human for approval or input on executing an AI-invoked function
humanlayer.dev
humanlayer.dev
. By using fn: "request_permission", we label this call as a permission request. (You may need to set up this function in HumanLayer’s dashboard or it could be implicit. Check HumanLayer docs for whether arbitrary function names can be used or if they need pre-registration.)
Extract context from the MCP request: The JSON-RPC tools/call request from Claude will contain details of the action requiring approval. Typically it looks like:
json
Copy
Edit
{
"jsonrpc": "2.0",
"id": 42,
"method": "tools/call",
"params": {
"name": "prompt",
"arguments": {
// ... details about the permission request
}
}
}
We need to inspect request.params.arguments to understand what is being asked. Claude might provide a message like: e.g. { "message": "Claude wants to run rm -rf /tmp/test. Allow?" } or similar. (If not, you might construct a message from the broader context — for instance, if the AI attempted a Bash command or file write, the Claude system likely formats a prompt.) For now, assume we get a string or description in the arguments.
Call HumanLayer API: Using the SDK or direct fetch, we create a function call request. For example, using the SDK:
ts
Copy
Edit
import { humanlayer } from 'humanlayer';
const hl = humanlayer({
apiKey: process.env.HUMANLAYER_API_KEY, // ensure your API key is set
runId: 'claude-permission', // an identifier for this run (e.g., session or app)
});

// Inside the tools/call handler:
const promptMsg: string = request.params?.arguments?.message || "Permission request";
const callId = crypto.randomUUID(); // unique ID for this call
const functionCall = await hl.createFunctionCall({
fn: 'request_permission',
kwargs: { prompt: promptMsg } // pass the prompt message or details
}, { callId });
What this does:
hl.createFunctionCall will POST to HumanLayer’s /function_calls API
humanlayer.dev
humanlayer.dev
, creating a new approval request. We provide:
fn: "request_permission" as the function name (signifying the type of request),
kwargs with details – here we send the prompt message or any structured info about the action.
We also send a callId (unique ID for tracking) – the SDK likely handles this, but we can specify or generate one.
On HumanLayer’s side, this triggers the configured human approval workflow (e.g., sending a Slack message or email to your team). The human can respond with approve or deny. (By default, HumanLayer’s response options might be named "approve" and "deny"
npmjs.com
npmjs.com
, but you can customize them. Ensure your HumanLayer project is set up to handle request_permission calls, or use their requireApproval helpers.)
The createFunctionCall returns immediately with an object containing details (likely including a status or an ID to poll).
Wait for a human response: The tricky part is waiting for the approval. HumanLayer supports waiting synchronously for a response via their SDK (e.g., await hl.requireApproval(...) in Python/TS halts until a decision)
npmjs.com
npmjs.com
. In our case, since we’re writing a CLI tool, we might not want to block indefinitely. However, to keep it simple, we can poll or use their blocking call:
ts
Copy
Edit
// Option 1: If SDK has requireApproval:
const result = await hl.requireApproval(functionCall);
// Option 2: Polling manually (pseudo-code):
let decision: string | null = null;
const timeoutMs = 300000; // e.g., 5 minutes max wait
const pollInterval = 5000;
const start = Date.now();
while (!decision && Date.now() - start < timeoutMs) {
const status = await hl.getFunctionCallStatus(callId);
if (status.decision) {
decision = status.decision; // e.g. "approve" or "deny"
break;
}
await sleep(pollInterval);
}
However you implement it, the goal is to get a final decision. HumanLayer’s API will eventually mark the function call as approved or rejected by a human.
Return the decision to Claude: Once we have a human decision, send the JSON-RPC response:
If approved, respond with a result indicating approval (e.g. "approved" or "yes").
If denied, you have a choice: you could respond with an error to the tools call (so Claude knows it was denied), or respond with a result that clearly indicates denial (perhaps "denied" or an error message). In an interactive Claude session, a denial would typically stop the action (Claude might print something like “Permission denied”). For consistency, returning an error via JSON-RPC might be appropriate for a denial. For example:
ts
Copy
Edit
if (decision === 'approve') {
response = { jsonrpc: "2.0", id: request.id, result: "approved" };
} else if (decision === 'deny') {
response = {
jsonrpc: "2.0",
id: request.id,
error: { code: 1, message: "Permission denied by user" }
};
}
process.stdout.write(JSON.stringify(response) + '\n');
Claude will then handle this accordingly (treating an error as a refusal).
Testing the real integration: Rebuild your project (npm run build) and run the same Claude CLI command as before. Now, when Claude asks for permission, our server will call out to HumanLayer:
You (or your team) will receive a notification via the configured channel (Slack, email, etc.) describing the action (from the promptMsg we sent). For example: “AI agent requests permission to write to output.txt. Approve?”
When the human responds, HumanLayer will capture the decision and our CLI will receive it (via the waiting/polling).
Our CLI then immediately responds to Claude. If approved, Claude proceeds; if denied, Claude should halt that action and likely report the denial.
Security & polish considerations: In a production setting, you’d want to refine this:
Use proper error handling and timeouts for the API calls.
Potentially handle multiple outstanding requests (if Claude could ask for multiple permissions concurrently, though in practice it might be one at a time).
Securely manage the HumanLayer API key (e.g., via environment variable).
Possibly log or record each permission request/decision for auditing.
Following the above steps, you have a working humanlayer-mcp CLI tool that Claude Code can use for permission requests. It is installed via npx, communicates over stdio as an MCP server, and initially approves everything after 10 seconds. After testing, we integrated it with HumanLayer’s approval workflow so that real humans can vet the AI’s actions. This setup aligns with Anthropic’s recommended tool naming (mcp**auth**prompt)
docs.anthropic.com
docs.anthropic.com
and leverages HumanLayer’s Function Call API for robust human-in-the-loop oversight.
