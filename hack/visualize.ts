#!/usr/bin/env bun

import { createInterface } from 'node:readline';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function getTypeColor(type: string): string {
  switch (type) {
    case 'system':
      return colors.magenta;
    case 'user':
      return colors.blue;
    case 'assistant':
      return colors.green;
    case 'tool_use':
      return colors.cyan;
    case 'tool_result':
      return colors.yellow;
    case 'message':
      return colors.dim;
    case 'text':
      return colors.reset;
    default:
      return colors.reset;
  }
}

function _formatHeader(json: any, lineNumber: number): string {
  const type = json.type || 'unknown';
  const typeColor = getTypeColor(type);

  let header = `${colors.dim}--- Line ${lineNumber} ${typeColor}[${type.toUpperCase()}]${colors.reset}`;

  // Add context based on type
  if (json.message?.role) {
    header += ` ${colors.dim}(${json.message.role})${colors.reset}`;
  }

  if (json.message?.content?.[0]?.name) {
    header += ` ${colors.cyan}${json.message.content[0].name}${colors.reset}`;
  }

  if (json.name) {
    header += ` ${colors.cyan}${json.name}${colors.reset}`;
  }

  if (json.subtype) {
    header += ` ${colors.dim}${json.subtype}${colors.reset}`;
  }

  return `${header} ${colors.dim}---${colors.reset}`;
}

function _colorizeJson(obj: any, indent = 0, path: string[] = []): string {
  const spaces = '  '.repeat(indent);

  if (obj === null) return `${colors.dim}null${colors.reset}`;
  if (typeof obj === 'boolean') return `${colors.yellow}${obj}${colors.reset}`;
  if (typeof obj === 'number') return `${colors.cyan}${obj}${colors.reset}`;
  if (typeof obj === 'string') {
    // Truncate very long strings
    if (obj.length > 200) {
      return `${colors.green}"${obj.substring(0, 197)}..."${colors.reset}`;
    }
    return `${colors.green}"${obj}"${colors.reset}`;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';

    // For content arrays, show summary
    if (path.includes('content') && obj.length > 3) {
      const summary = obj.slice(0, 2).map((item) => _colorizeJson(item, indent + 1, [...path]));
      return `[\n${summary.join(',\n')},\n${spaces}  ${colors.dim}... ${obj.length - 2} more items${colors.reset}\n${spaces}]`;
    }

    const items = obj.map((item) => `${spaces}  ${_colorizeJson(item, indent + 1, [...path])}`);
    return `[\n${items.join(',\n')}\n${spaces}]`;
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';

    // Show only key fields for deeply nested objects
    const importantKeys = [
      'type',
      'role',
      'name',
      'id',
      'input',
      'output',
      'content',
      'text',
      'subtype',
      'session_id',
    ];
    const keysToShow = indent > 2 ? keys.filter((k) => importantKeys.includes(k)) : keys;

    if (keysToShow.length === 0 && keys.length > 0) {
      return `${colors.dim}{...${keys.length} keys}${colors.reset}`;
    }

    const items = keysToShow.map((key) => {
      let coloredKey = `${colors.blue}"${key}"${colors.reset}`;

      // Highlight important keys
      if (['type', 'name', 'role'].includes(key)) {
        coloredKey = `${colors.bright}${colors.blue}"${key}"${colors.reset}`;
      }

      const value = _colorizeJson(obj[key], indent + 1, [...path, key]);
      return `${spaces}  ${coloredKey}: ${value}`;
    });

    if (keysToShow.length < keys.length) {
      items.push(
        `${spaces}  ${colors.dim}... ${keys.length - keysToShow.length} more keys${colors.reset}`
      );
    }

    return `{\n${items.join(',\n')}\n${spaces}}`;
  }

  return String(obj);
}

function formatTodoList(todos: any[]): string {
  let output = `📋 ${colors.bright}${colors.cyan}Todo List Update${colors.reset}\n`;

  const statusColors = {
    completed: colors.dim + colors.green,
    in_progress: colors.bright + colors.yellow,
    pending: colors.reset,
  };

  const statusIcons = {
    completed: '✅',
    in_progress: '🔄',
    pending: '⏸️',
  };

  const priorityColors = {
    high: colors.red,
    medium: colors.yellow,
    low: colors.dim,
  };

  todos.forEach((todo, index) => {
    const statusColor = statusColors[todo.status] || colors.reset;
    const statusIcon = statusIcons[todo.status] || '❓';
    const priorityColor = priorityColors[todo.priority] || colors.reset;
    const checkbox = todo.status === 'completed' ? '☑️' : '☐';

    output += `  ${checkbox} ${statusIcon} ${statusColor}${todo.content}${colors.reset}`;
    output += ` ${priorityColor}[${todo.priority}]${colors.reset}`;

    if (todo.status === 'in_progress') {
      output += ` ${colors.bright}${colors.yellow}← ACTIVE${colors.reset}`;
    }

    output += '\n';
  });

  // Add summary stats
  const completed = todos.filter((t) => t.status === 'completed').length;
  const inProgress = todos.filter((t) => t.status === 'in_progress').length;
  const pending = todos.filter((t) => t.status === 'pending').length;

  output += `\n  ${colors.dim}📊 Progress: ${colors.green}${completed} completed${colors.reset}`;
  output += `${colors.dim}, ${colors.yellow}${inProgress} active${colors.reset}`;
  output += `${colors.dim}, ${colors.reset}${pending} pending${colors.reset}`;
  output += `${colors.dim} (${Math.round((completed / todos.length) * 100)}% done)${colors.reset}`;

  return output;
}

function formatConcise(json: any): string {
  const type = json.type || 'unknown';
  const typeColor = getTypeColor(type);

  let output = `⏺ ${typeColor}${type.charAt(0).toUpperCase() + type.slice(1)}${colors.reset}`;

  // Special handling for TodoWrite calls
  if (type === 'assistant' && json.message?.content?.[0]?.name === 'TodoWrite') {
    const toolInput = json.message.content[0].input;
    if (toolInput?.todos && Array.isArray(toolInput.todos)) {
      return formatTodoList(toolInput.todos);
    }
  }

  // Add context based on type
  if (type === 'assistant' && json.message?.content?.[0]?.name) {
    const toolName = json.message.content[0].name;
    const toolInput = json.message.content[0].input;

    // Format tool name with key arguments
    let toolDisplay = `${colors.cyan}${toolName}${colors.reset}`;

    if (toolInput) {
      const keyArgs = [];

      // Extract the most important argument for each tool type
      if (toolInput.file_path) keyArgs.push(toolInput.file_path);
      else if (toolInput.path) keyArgs.push(toolInput.path);
      else if (toolInput.pattern) keyArgs.push(`"${toolInput.pattern}"`);
      else if (toolInput.command) keyArgs.push(toolInput.command);
      else if (toolInput.cmd) keyArgs.push(toolInput.cmd);
      else if (toolInput.query) keyArgs.push(`"${toolInput.query}"`);
      else if (toolInput.description) keyArgs.push(toolInput.description);
      else if (toolInput.prompt) keyArgs.push(`"${toolInput.prompt.substring(0, 30)}..."`);
      else if (toolInput.url) keyArgs.push(toolInput.url);

      if (keyArgs.length > 0) {
        toolDisplay += `(${colors.green}${keyArgs[0]}${colors.reset})`;
      }
    }

    output = `⏺ ${toolDisplay}`;

    // Show additional arguments on next lines for complex tools
    if (toolInput) {
      const additionalArgs = [];

      if (toolName === 'Bash' && toolInput.cwd) {
        additionalArgs.push(`cwd: ${toolInput.cwd}`);
      }
      if (toolInput.limit) additionalArgs.push(`limit: ${toolInput.limit}`);
      if (toolInput.offset) additionalArgs.push(`offset: ${toolInput.offset}`);
      if (toolInput.include) additionalArgs.push(`include: ${toolInput.include}`);
      if (toolInput.old_string && toolInput.new_string) {
        additionalArgs.push(
          `replace: "${toolInput.old_string.substring(0, 20)}..." → "${toolInput.new_string.substring(0, 20)}..."`
        );
      }
      if (toolInput.timeout) additionalArgs.push(`timeout: ${toolInput.timeout}ms`);

      if (additionalArgs.length > 0) {
        output += `\n  ⎿  ${colors.dim}${additionalArgs.join(', ')}${colors.reset}`;
      }
    }
  } else if (type === 'tool_result' && json.name) {
    output += `(${colors.cyan}${json.name}${colors.reset})`;
  } else if (type === 'user' && json.message?.content?.[0]) {
    const content = json.message.content[0];
    if (content.type === 'tool_result') {
      // Override the type display for tool results
      output = `⏺ ${colors.yellow}Tool Result${colors.reset}`;

      // Show result summary and first 2 lines
      if (content.content) {
        const resultText =
          typeof content.content === 'string' ? content.content : JSON.stringify(content.content);
        const lines = resultText.split('\n');
        const chars = resultText.length;
        output += `\n  ⎿  ${colors.dim}${lines.length} lines, ${chars} chars${colors.reset}`;
        if (content.is_error) {
          output += ` ${colors.red}ERROR${colors.reset}`;
        }

        // Show first 2 lines of content
        if (lines.length > 0 && lines[0].trim()) {
          output += `\n  ⎿  ${colors.reset}${lines[0]}${colors.reset}`;
        }
        if (lines.length > 1 && lines[1].trim()) {
          output += `\n      ${colors.dim}${lines[1]}${colors.reset}`;
        }
      }
    } else if (content.text) {
      const text = content.text.substring(0, 50);
      output += `: ${colors.dim}${text}${text.length === 50 ? '...' : ''}${colors.reset}`;
    }
  } else if (type === 'system' && json.subtype) {
    output += `(${colors.dim}${json.subtype}${colors.reset})`;
  }

  // Show assistant message content if it exists
  if (type === 'assistant' && json.message?.content) {
    const textContent = json.message.content.find((c) => c.type === 'text');
    if (textContent?.text) {
      const lines = textContent.text.split('\n').slice(0, 3); // Show first 3 lines
      output += `\n  ⎿  ${colors.reset}${lines[0]}${colors.reset}`;
      if (lines.length > 1) {
        output += `\n      ${colors.dim}${lines[1]}${colors.reset}`;
      }
      if (lines.length > 2) {
        output += `\n      ${colors.dim}${lines[2]}${colors.reset}`;
      }
      if (textContent.text.split('\n').length > 3) {
        output += `\n      ${colors.dim}...${colors.reset}`;
      }
    }
  }

  // Add summary line
  let summary = '';
  if (json.message?.usage) {
    const usage = json.message.usage;
    summary = `${usage.input_tokens || 0}/${usage.output_tokens || 0} tokens`;
  } else if (json.output && typeof json.output === 'string') {
    summary = `${json.output.length} chars output`;
  } else if (json.message?.content?.length) {
    summary = `${json.message.content.length} content items`;
  } else if (json.tools?.length) {
    summary = `${json.tools.length} tools available`;
  }

  if (summary) {
    output += `\n  ⎿  ${colors.dim}${summary}${colors.reset}`;
  }

  return output;
}

async function processStream() {
  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  const debugMode = process.argv.includes('--debug');
  const toolCalls = new Map(); // Store tool calls by their ID
  const pendingResults = new Map(); // Store results waiting for their tool calls

  rl.on('line', (line) => {
    if (line.trim()) {
      const timestamp = debugMode
        ? `${colors.dim}[${new Date().toISOString()}]${colors.reset} `
        : '';

      try {
        const json = JSON.parse(line);

        // Check if this is a tool call
        if (json.type === 'assistant' && json.message?.content?.[0]?.id) {
          const toolCall = json.message.content[0];
          const toolId = toolCall.id;

          // Store the tool call
          toolCalls.set(toolId, {
            toolCall: json,
            timestamp: timestamp,
          });

          // Check if we have a pending result for this tool call
          if (pendingResults.has(toolId)) {
            const result = pendingResults.get(toolId);
            displayToolCallWithResult(
              toolCall,
              json,
              result.toolResult,
              result.timestamp,
              timestamp
            );
            pendingResults.delete(toolId);
          } else {
            // Display the tool call and mark it as pending
            process.stdout.write(`${timestamp + formatConcise(json)}\n`);
            process.stdout.write(`${colors.dim}  ⎿  Waiting for result...${colors.reset}\n\n`);
          }
        }
        // Check if this is a tool result
        else if (json.type === 'user' && json.message?.content?.[0]?.type === 'tool_result') {
          const toolResult = json.message.content[0];
          const toolId = toolResult.tool_use_id;

          if (toolCalls.has(toolId)) {
            // We have the matching tool call, display them together
            const stored = toolCalls.get(toolId);
            displayToolCallWithResult(
              stored.toolCall.message.content[0],
              stored.toolCall,
              json,
              stored.timestamp,
              timestamp
            );
            toolCalls.delete(toolId);
          } else {
            // Store the result and wait for the tool call
            pendingResults.set(toolId, {
              toolResult: json,
              timestamp: timestamp,
            });
          }
        }
        // For all other message types, display normally
        else {
          process.stdout.write(`${timestamp + formatConcise(json)}\n\n`);
        }
      } catch (_error) {
        process.stdout.write(`${timestamp}${colors.red}⏺ Parse Error${colors.reset}\n`);
        process.stdout.write(`  ⎿  ${colors.dim}${line.substring(0, 50)}...${colors.reset}\n\n`);
      }
    }
  });

  // Keep the process alive
  return new Promise(() => {});
}

function displayToolCallWithResult(
  toolCall: any,
  toolCallJson: any,
  toolResultJson: any,
  callTimestamp: string,
  resultTimestamp: string
) {
  // Display the tool call header
  process.stdout.write(`${callTimestamp}${formatConcise(toolCallJson)}\n`);

  // Display the result
  const toolResult = toolResultJson.message.content[0];
  const isError = toolResult.is_error;
  const resultIcon = isError ? '❌' : '✅';
  const resultColor = isError ? colors.red : colors.green;

  process.stdout.write(
    `  ${resultTimestamp}${resultIcon} ${resultColor}Tool Result${colors.reset}`
  );

  if (toolResult.content) {
    const resultText =
      typeof toolResult.content === 'string'
        ? toolResult.content
        : JSON.stringify(toolResult.content);
    const lines = resultText.split('\n');
    const chars = resultText.length;

    process.stdout.write(` ${colors.dim}(${lines.length} lines, ${chars} chars)${colors.reset}`);

    if (isError) {
      process.stdout.write(` ${colors.red}ERROR${colors.reset}`);
    }

    // Show first few lines of result
    const linesToShow = Math.min(3, lines.length);
    for (let i = 0; i < linesToShow; i++) {
      if (lines[i].trim()) {
        const lineColor = i === 0 ? colors.reset : colors.dim;
        process.stdout.write(`\n    ⎿  ${lineColor}${lines[i]}${colors.reset}`);
      }
    }

    if (lines.length > linesToShow) {
      process.stdout.write(
        `\n    ⎿  ${colors.dim}... ${lines.length - linesToShow} more lines${colors.reset}`
      );
    }
  }

  process.stdout.write('\n\n');
}

if (import.meta.main) {
  processStream().catch(console.error);
}
