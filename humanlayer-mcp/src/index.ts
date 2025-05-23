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

const DEBUG = process.env.DEBUG ? true : false;
const DEBUG_LOG_FILE = process.env.DEBUG_LOG_FILE || "log.txt";

async function log(message: any) {
  if (DEBUG) {
    await fs.appendFile(
      DEBUG_LOG_FILE,
      new Date().toISOString() + " " + JSON.stringify(message, null, 2) + "\n",
    );
  }
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
      },
      {
        name: "hardcoded",
        description: "Hardcoded tool",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

const hl = humanlayer({
  contactChannel: {
    slack: {
      channel_or_user_id: "",
      experimental_slack_blocks: true,
    },
  },
});

const handleRequestPermission = async (request: any) => {
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
  log("requesting permission");
  const toolName: string | undefined = request.params.arguments?.tool_name as
    | string
    | undefined;

  if (!toolName) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "Invalid tool name requesting permissions",
    );
  }

  const input: Record<string, any> = request.params.arguments?.input || {};
  const approvalResult: FunctionCallStatus = await hl.fetchHumanApproval({
    spec: {
      fn: toolName,
      kwargs: input,
    },
  });

  if (!approvalResult.approved) {
    return {
      result: false,
      message: approvalResult.comment,
    };
  }

  // todo we have no idea what response schema claude code expects here
  //
  return {
    result: true,
    message: "approved",
  };
};

const handleContactHuman = async (request: any) => {
  log("contacting human");
  const response = await hl.fetchHumanResponse({
    spec: {
      msg: request.params.arguments?.message,
    },
  });

  return {
    toolResult: response,
  };
  // return {
  //   content: [
  //     {
  //       type: "text",
  //       text: response,
  //     },
  //   ],
  // }
};
/**
 * a dummy tool you can use to test the server
 * or wrap with approval semantics to test approval
 *
 * @param request
 * @returns
 */
const handleReticulateSplines = async (request: any) => {
  log("reticulating splines");
  const splineType = request.params.arguments?.spline_type;
  if (!splineType) {
    throw new McpError(ErrorCode.InvalidRequest, "Invalid spline type");
  }
  const result = Math.random() * 100;
  await new Promise((resolve) => setTimeout(resolve, result));

  return {
    content: [
      {
        type: "text",
        text: `splines reticulated, ${result}ms`,
      },
    ],
  };
};

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  await log("============");
  await log("REQUEST");
  await log("------------");
  await log(request);

  if (request.params.name === "request_permission") {
    return handleRequestPermission(request);
  } else if (request.params.name === "contact_human") {
    return handleContactHuman(request);
  } else if (DEBUG && request.params.name === "reticulate_splines") {
    return handleReticulateSplines(request);
  } else if (
    DEBUG &&
    process.env.HARDCODED_PAYLOAD &&
    request.params.name === "hardcoded"
  ) {
    const payload = JSON.parse(process.env.HARDCODED_PAYLOAD || "{}");
    return payload;
  }
  throw new McpError(ErrorCode.InvalidRequest, "Invalid tool name");
});

const transport = new StdioServerTransport();
await server.connect(transport);
