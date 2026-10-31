/**
 * The shared client. Both the CLI and the stdio MCP server go through this.
 *
 * Deliberately dependency-free: `fetch` and `node:` builtins only. A published
 * package that an agent installs with `npx` on first run should not pull a tree
 * of transitive dependencies, and every one of them would be a supply-chain
 * surface on a package that holds an API key.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

// The www host, not the bare one: inreels.ai 308s to www, and paying a
// redirect on every API call is avoidable.
export const DEFAULT_BASE = process.env.INREELS_BASE_URL || 'https://www.inreels.ai';

const CONFIG_PATH = join(homedir(), '.inreels', 'config.json');

export function readConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function writeConfig(config) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  // 0600: the file holds an API key, and a default-permission file in a shared
  // home directory is readable by anyone on the machine.
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** The key, in precedence order: environment, then the saved config. */
export function resolveKey() {
  return process.env.INREELS_API_KEY || readConfig().apiKey || null;
}

export function resolveBase() {
  return process.env.INREELS_BASE_URL || readConfig().baseUrl || DEFAULT_BASE;
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Call one tool.
 *
 * Against the REST surface rather than MCP, because both expose the identical
 * tool list and REST is one request with no handshake.
 */
export async function callTool(name, args, { key, base } = {}) {
  const apiKey = key ?? resolveKey();
  if (!apiKey) {
    throw new ApiError(
      'No API key. Run `inreels login <key>`, or set INREELS_API_KEY.',
      401,
      null
    );
  }

  const res = await fetch(`${base ?? resolveBase()}/api/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(args ?? {}),
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(`Unexpected response from ${name}`, res.status, text);
  }

  if (!res.ok) {
    throw new ApiError(body.message || body.error || `${name} failed`, res.status, body);
  }
  return body;
}

/** The tool catalogue with JSON Schemas. Unauthenticated. */
export async function listTools({ base } = {}) {
  const res = await fetch(`${base ?? resolveBase()}/api/v1`);
  if (!res.ok) throw new ApiError('Could not read the tool list', res.status, null);
  const body = await res.json();
  return body.tools ?? [];
}

/**
 * Poll a run to completion.
 *
 * `wait: true` already blocks server-side for up to 45s, so this loop exists
 * only for work that genuinely outlasts that — a video, not an image.
 */
export async function waitForRun(runId, { onTick, timeoutMs = 20 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const view = await callTool('get_run_status', { run_id: runId, wait: true });
    if (onTick) onTick(view);

    if (['completed', 'failed', 'cancelled'].includes(view.status)) return view;
    if (Date.now() >= deadline) {
      throw new ApiError(`Run ${runId} did not finish within the timeout`, 408, view);
    }
  }
}
