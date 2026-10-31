#!/usr/bin/env node
/**
 * The local (self-hosted) MCP server.
 *
 * Speaks MCP over stdio and forwards every call to the hosted REST surface, so
 * the tool list, pricing and validation are the server's — this process holds
 * nothing but the key and a pipe.
 *
 *   claude mcp add inreels -e INREELS_API_KEY=ir_live_... \
 *     -- npx -y inreels inreels-mcp
 *
 * Why this exists when there is already a hosted MCP endpoint: some clients
 * cannot set an Authorization header on a remote server, and some users would
 * rather hold a key in their own environment than complete an OAuth round-trip.
 * It is the same surface either way; only the transport differs.
 */

import { callTool, listTools, resolveKey } from './api.js';

const PROTOCOL_VERSION = '2025-06-18';

let buffer = '';

/**
 * Requests being served right now.
 *
 * Needed because stdin can close while a call is still waiting on the network,
 * and exiting then truncates the reply. A client that pipes its requests in
 * and closes the stream — which is also how this gets tested — would see the
 * handshake answered and everything after it silently dropped.
 */
let inFlight = 0;
let stdinClosed = false;

function exitWhenDrained() {
  if (stdinClosed && inFlight === 0) process.exit(0);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  // Newline-delimited JSON. A partial line stays in the buffer until the rest
  // arrives, which is what makes this safe against split writes.
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) {
      inFlight++;
      handle(line).finally(() => {
        inFlight--;
        exitWhenDrained();
      });
    }
  }
});

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = request;

  // Notifications carry no id and must not be answered at all.
  if (id === undefined || id === null) return;

  try {
    if (method === 'initialize') {
      if (!resolveKey()) {
        return fail(
          id,
          -32600,
          'No API key. Set INREELS_API_KEY, or run `npx inreels login <key>`. Create one at https://inreels.ai/dashboard/settings/api-keys'
        );
      }
      return respond(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'inreels', title: 'inReels', version: '0.1.0' },
        instructions:
          'Images, voice and video. Every generating tool returns a run_id — poll get_run_status with wait:true. Price first with quote. Failed runs are refunded.',
      });
    }

    if (method === 'ping') return respond(id, {});

    if (method === 'tools/list') {
      const tools = await listTools();
      return respond(id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input_schema,
          annotations: {
            title: tool.title,
            readOnlyHint: tool.cost === 'read_only',
            // Matches the hosted server: spending credits is irreversible from
            // the caller's side, so a spending tool is flagged destructive even
            // though nothing is deleted. Hosts read this to decide whether
            // blanket approval may be offered, and the two surfaces answering
            // differently for the same tool is a bug.
            destructiveHint: tool.cost === 'spends_credits',
            idempotentHint: tool.cost === 'read_only',
            openWorldHint: true,
          },
        })),
      });
    }

    if (method === 'tools/call') {
      const payload = await callTool(params?.name, params?.arguments ?? {});
      return respond(id, {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        // Keyed on the error's value, not its presence: a successful
        // get_run_status carries `error: null`, and a key check read that as a
        // failure — flagging every completed run as an error to the agent.
        isError: Boolean(payload && typeof payload === 'object' && payload.error),
      });
    }

    return fail(id, -32601, `Unsupported method "${method}"`);
  } catch (err) {
    // Reported as a tool result rather than a protocol error where possible, so
    // the agent can read the reason and correct its own call.
    if (method === 'tools/call') {
      return respond(id, {
        content: [{ type: 'text', text: err.message }],
        structuredContent: { error: 'request_failed', message: err.message },
        isError: true,
      });
    }
    return fail(id, -32603, err.message);
  }
}

process.stdin.on('end', () => {
  stdinClosed = true;
  exitWhenDrained();
});
