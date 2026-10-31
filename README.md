# inReels MCP

**Turn your AI agent into an ad studio.** Generate video ads, UGC ads, static
image ads, voiceover and faceless videos from Claude, Cursor, Codex, ChatGPT or
any MCP client.

```
https://www.inreels.ai/api/mcp
```

Remote MCP (Streamable HTTP) · 17 tools · 28 image, video and speech models ·
OAuth 2.1 with dynamic client registration, or a bearer API key

[Website](https://www.inreels.ai) · [Setup guide](https://www.inreels.ai/connect) · [llms.txt](https://www.inreels.ai/llms.txt)

## Connect

**Claude Code**

```bash
claude mcp add --transport http --scope user inreels https://www.inreels.ai/api/mcp
```

Then run `/mcp`, pick `inreels` and sign in from the browser.

**Claude, ChatGPT, Muse**: add a custom connector with the URL above and sign in
when asked.

**Cursor** (`~/.cursor/mcp.json`)

```json
{ "mcpServers": { "inreels": { "url": "https://www.inreels.ai/api/mcp" } } }
```

**Codex**

```bash
codex mcp add inreels --url https://www.inreels.ai/api/mcp
codex mcp login inreels
```

**Any other client**: use the URL above, plus either OAuth or an
`Authorization: Bearer <API key>` header. Create keys at
<https://www.inreels.ai/dashboard/settings/api-keys>.

**Local stdio** (for clients without remote MCP support, or to keep the key in
your own environment). This repo is that server; it forwards to the hosted API,
so the tool list, pricing and validation stay the server's.

```bash
INREELS_API_KEY=... npx -y inreels inreels-mcp
```

## Tools

| Group | Tools |
|---|---|
| Finished deliverables | `create_ad_video` · `create_faceless_video` · `quote_ad_video` · `quote_faceless_video` |
| Single assets, any model | `generate_image` · `generate_video` · `generate_speech` · `quote` |
| Assets | `upload_image` · `refresh_asset_url` |
| Discovery | `list_models` · `list_voices` · `list_styles` · `list_actors` |
| Runs and account | `get_run_status` · `list_runs` · `get_account` |

Read-only tools are free. Generating tools spend credits; `quote` returns the
exact price first, and failed runs are refunded in full.

Two layers, deliberately. **Capabilities** (`create_*`) return a finished
deliverable and choose the model for you, exposing creative controls only.
**Primitives** (`generate_*`) render one asset and expose the full parameter
surface, for an agent that wants to drive the models itself.

## Try it

> "Make me a 15-second UGC ad for this product: &lt;link or image&gt;"
>
> "Three static ad variations for my cold-brew cans, 1:1 for Instagram"
>
> "A 60-second faceless video about the history of coffee, for YouTube Shorts"

## How it behaves

- Every generating tool returns a run id immediately. Nothing blocks.
- `get_run_status` with `wait: true` blocks up to 45 seconds and usually
  returns a finished image in one call.
- Video is slower and has two stages — the scenes are built, then the MP4 is
  rendered. Roughly 5–10 minutes in total. A run reports `completed` only once
  the file exists, so an agent should keep polling rather than hand over a
  watch page as the finished thing.
- An unlisted model id is rejected, never quietly substituted.
- Every option is validated against the provider's live schema before it ships,
  so an agent cannot be handed a combination that fails.
- Tools are tagged read, write or sensitive write. Anything that spends credits
  is a sensitive write and is annotated destructive, so your host can ask you
  each time instead of taking blanket permission.
- No rate limits beyond the account's credit balance.

## CLI

The same surface from a terminal.

```bash
npx inreels login ir_live_...
npx inreels tools
npx inreels describe create_faceless_video
npx inreels run generate_image --prompt "serum bottle on wet marble" --wait
npx inreels status <run_id>
```

`--json` on any command for scripting. `inreels run` works for any tool,
including ones added after this version was published.

## REST

Every tool is also a plain endpoint, same key.

```bash
curl -X POST https://www.inreels.ai/api/v1/generate_image \
  -H "Authorization: Bearer ir_live_..." \
  -H "Content-Type: application/json" \
  -d '{"prompt":"serum bottle on wet marble","aspect_ratio":"9:16"}'
```

<https://www.inreels.ai/api/v1> returns every tool with its JSON Schema,
unauthenticated. <https://www.inreels.ai/llms.txt> is the same thing written for
an agent to read.

## Links

- Setup guide — <https://www.inreels.ai/connect>
- Support — <https://www.inreels.ai/support>
- Pricing — <https://www.inreels.ai/pricing>

MIT.
