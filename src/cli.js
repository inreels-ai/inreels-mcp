#!/usr/bin/env node
/**
 * The inReels CLI.
 *
 * Every command is a thin shell over one tool call, because the tool list is
 * the product's only surface — a CLI that grew its own vocabulary would be a
 * second thing to keep in step. `inreels run <tool>` works for any tool,
 * including ones added after this version was published.
 */

import { callTool, listTools, waitForRun, readConfig, writeConfig, resolveBase } from './api.js';

const [, , command, ...rest] = process.argv;

const HELP = `inreels — ad creatives, UGC ads and faceless video for agents

  inreels login <key>              Save an API key (~/.inreels/config.json, 0600)
  inreels whoami                   Account and credit balance
  inreels tools                    Every tool, with its cost
  inreels describe <tool>          A tool's parameters
  inreels run <tool> [--k v ...]   Call any tool
  inreels status <run_id>          Check a run
  inreels wait <run_id>            Block until a run finishes

  inreels mcp                      Run as a local MCP server over stdio

Flags
  --json                           Raw JSON, for scripting
  --wait                           On run: block until the run finishes

Create a key at https://inreels.ai/dashboard/settings/api-keys
`;

/** `--key value` and `--flag` into an object; repeated keys become an array. */
function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const name = token.slice(2);
    const next = argv[i + 1];

    if (next === undefined || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }
    i++;

    // Numbers and booleans arrive as strings on a command line; the schemas are
    // typed, so convert the unambiguous cases and leave everything else alone.
    let value = next;
    if (next === 'true') value = true;
    else if (next === 'false') value = false;
    else if (next !== '' && Number.isFinite(Number(next))) value = Number(next);

    if (name in flags) {
      flags[name] = Array.isArray(flags[name]) ? [...flags[name], value] : [flags[name], value];
    } else {
      flags[name] = value;
    }
  }
  return flags;
}

function out(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === 'string') {
    console.log(value);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const flags = parseFlags(rest);
  const asJson = Boolean(flags.json);

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return;

    case 'mcp': {
      // Delegated rather than duplicated — same binary, different entry point.
      await import('./stdio.js');
      return;
    }

    case 'login': {
      const key = rest[0];
      if (!key || key.startsWith('--')) {
        console.error('Usage: inreels login <key>');
        process.exit(1);
      }
      writeConfig({ ...readConfig(), apiKey: key });
      const account = await callTool('get_account', {}, { key });
      console.log(`Signed in. ${account.credits} credits.`);
      return;
    }

    case 'whoami': {
      out(await callTool('get_account', {}), asJson);
      return;
    }

    case 'tools': {
      const tools = await listTools();
      if (asJson) return out(tools, true);
      for (const tool of tools) {
        console.log(`${tool.name.padEnd(24)} ${String(tool.cost).padEnd(16)} ${tool.title}`);
      }
      return;
    }

    case 'describe': {
      const name = rest[0];
      const tool = (await listTools()).find((t) => t.name === name);
      if (!tool) {
        console.error(`No tool "${name}". Run \`inreels tools\`.`);
        process.exit(1);
      }
      if (asJson) return out(tool, true);

      console.log(`${tool.name} — ${tool.description}\n`);
      const schema = tool.input_schema ?? {};
      for (const [field, spec] of Object.entries(schema.properties ?? {})) {
        const required = schema.required?.includes(field) ? 'required' : 'optional';
        const allowed = spec.enum ? ` (${spec.enum.join(' | ')})` : '';
        console.log(`  --${field.padEnd(22)} ${required}${allowed}`);
        if (spec.description) console.log(`      ${spec.description}`);
      }
      return;
    }

    case 'run': {
      const name = rest[0];
      if (!name || name.startsWith('--')) {
        console.error('Usage: inreels run <tool> [--key value ...]');
        process.exit(1);
      }
      const { json: _json, wait, ...args } = flags;
      const result = await callTool(name, args);

      if (wait && result.run_id) {
        if (!asJson) console.error(`Submitted ${result.run_id}, waiting…`);
        const final = await waitForRun(result.run_id, {
          onTick: (view) => {
            if (!asJson && view.status !== 'completed') {
              console.error(`  ${view.status}${view.progress ? ` ${view.progress}%` : ''}`);
            }
          },
        });
        return out(asJson ? final : (final.output_url ?? final), asJson);
      }
      return out(result, asJson);
    }

    case 'status': {
      out(await callTool('get_run_status', { run_id: rest[0] }), asJson);
      return;
    }

    case 'wait': {
      const final = await waitForRun(rest[0], {
        onTick: (view) => {
          if (!asJson && view.status !== 'completed') console.error(`  ${view.status}`);
        },
      });
      out(asJson ? final : (final.output_url ?? final), asJson);
      return;
    }

    default:
      console.error(`Unknown command "${command}".\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  if (err.status === 401) {
    console.error(`\nCreate a key at ${resolveBase()}/dashboard/settings/api-keys`);
  }
  process.exit(1);
});
