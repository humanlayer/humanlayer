#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import fs from "fs/promises";
import { FunctionCallSpec, FunctionCallStatus, humanlayer } from "humanlayer";

async function log(message: any) {
  await fs.appendFile("log.txt", new Date().toISOString() + " " + JSON.stringify(message, null, 2) + "\n");
}

const server = new Server(
  {
    name: "mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "request_permission",
        description: "Request permission to perform an action",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string" },
          },
          required: ["action"],
        },
      },
      {
        name: "reticulate_splines",
        description: "Reticulate splines",
        inputSchema: {
          type: "object",
          properties: {
            spline_type: { type: "string" },
          },
          required: ["spline_type"],
        },
      }
    ],
  };
});

const hl = humanlayer({
  contactChannel: {
    slack: {
      channel_or_user_id: "",
      experimental_slack_blocks: true,
    }
  }

});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  await log("============")
  await log("REQUEST")
  await log("------------")
  await log(request)

  /* params looks like 
  {
  "name": "request_permission",
  "arguments": {
    "tool_name": "Bash",
    "input": {
      "command": "touch \"/Users/dex/go/src/github.com/humanlayer/humanlayer/humanlayer-mcp/blah.txt\"",
      "description": "Create empty blah.txt file"
    }
  }
} */

  if (request.params.name === "request_permission") {
    log("requesting permission")

    const toolName: string|undefined  = request.params.arguments?.tool_name as string|undefined;
    if (!toolName) {
      throw new McpError(ErrorCode.InvalidRequest, "Invalid tool name requesting permissions");
    }
    const input: Record<string, any> = request.params.arguments?.input || {};

    const result: FunctionCallStatus = await hl.fetchHumanApproval({
      spec: {
        fn: toolName,
        kwargs: input,
      }
    });

    if (!result.approved) {
      return {
        result: false,
        message: result.comment,
      }
    }

    return {
      result: true,
      message: "approved",
    };

  } else if (request.params.name === "reticulate_splines") {
    log("reticulating splines")
    const splineType = request.params.arguments?.spline_type;
    const result = Math.random() * 100;
    await new Promise(resolve => setTimeout(resolve, result));

    return {
      content: [
        {
          type: "text",
          text: `splines reticulated, ${result}ms`,
        },
      ]
    };
  } else if (request.params.name === "approve") {
    const payload = JSON.parse(process.env.APPROVE_PAYLOAD || "{}");
    return payload;
  }
  throw new McpError(ErrorCode.InvalidRequest, "Invalid tool name");
});

const transport = new StdioServerTransport();
await server.connect(transport);
