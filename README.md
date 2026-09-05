# Duckpond

A room full of rubber ducks that talk back. Think through a game idea, question a decision, or get several perspectives on something you are building.

Duckpond is a personal POC that connects to your local Claude Code and Codex subscriptions. Each duck has its own persona, model, reasoning setting, and outfit. The UI uses charcoal backgrounds and yellow accents.

Built with Vite Plus, TanStack Start, React, the Vercel AI SDK, and SQLite.

## Run

Requires Node 24+, Vite Plus, and the `claude` and `codex` commands on PATH. Sign in through their normal subscription logins on the machine running Duckpond. API keys are not required.

```sh
git clone https://github.com/ApocDev/duckpond.git
cd duckpond
vp install
vp run dev
```

Duckpond uses `127.0.0.1:3998`, with strict port checking. The launch command sets `PORT` explicitly so an inherited value from another dev server cannot redirect it.

For a built version:

```sh
vp run build
vp run start
```

## Remote access

Use Tailscale Serve to reach the local app from your tailnet:

```sh
tailscale serve --bg --https=3998 http://127.0.0.1:3998
```

Copy `.env.example` to `.env` and set `DUCKPOND_ALLOWED_HOSTS` to your exact Tailscale hostname. Separate multiple hostnames with commas. For Cloudflared, point the tunnel at `http://127.0.0.1:3998` and add its hostname to the same setting. This personal app relies on Tailscale access controls or Cloudflare Access, and has no separate account/login system.

To remove only Duckpond's Tailscale endpoint:

```sh
tailscale serve --https=3998 off
```

## Conversations

- **Conversation:** the selected duck replies. An explicit `@explorer`, `@skeptic`, or `@simplifier` overrides that selection. Multiple mentions invite multiple ducks.
- **Independent review:** all ducks receive the same conversation snapshot. They do not see each other's current reviews while writing their own. Guide summarizes their input afterward and asks at most one next question.
- **Discuss together:** independent reviews followed by one round of responses to those reviews, then a Guide summary. There is no unlimited automatic discussion loop.
- **Guided conversation:** Guide replies alone, even if observers are enabled or you mention another duck. It helps work through unresolved choices one question at a time. Switch to Independent review to get everyone's input again.
- **Observers:** opt in from room settings. Unaddressed ducks check completed replies and speak only if they have something to add. These checks consume subscription usage even when they stay quiet.
- **Stop:** cancels the room's provider calls and pending approval requests. Completed and partial messages remain saved.

Room settings add and remove ducks, and edit their names, perspectives, outfits, provider, model, and reasoning level. Keep at least one duck in a room. Removal preserves earlier messages. Changes apply when you save the room.

Type `@` or tap **Invite a duck** to choose participants. The picker inserts a stable handle, so renaming a duck does not break its mentions. Keyboard users can filter, move with arrow keys, select with Enter or Tab, and dismiss with Escape.

The message box starts at one line and grows as you type, up to a scrollable height. On mobile, Return inserts a new line and the arrow button sends the message. On desktop, Enter sends and Shift+Enter adds a new line.

Tap **Dictate** beside **Invite a duck** to use the browser's speech recognition. Allow microphone access when prompted. Speech appends to the current draft, with interim words updated as recognition improves. Tap **Stop dictation** to edit or send; dictation never sends automatically. If the browser stops listening or reports an error, recognized text stays in the draft. Tap Dictate again to continue. Editing and sending pause while dictation is active so later speech results cannot overwrite edits or spill into another message.

Dictation needs a supported browser and a secure page, such as the Tailscale HTTPS address or localhost. Duckpond does not record or upload audio itself. The browser handles recognition and may use an online speech service. See [browser speech recognition support](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

Parallel replies appear in an expandable round, with each duck's status visible. Tap a row to read its full response. Guide summaries stay expanded. Existing conversations use this layout without changing their saved messages.

The transcript follows replies while you are at the bottom. Scrolling up or opening a duck's reply pauses following and preserves your reading position when other replies grow above it. **New replies** returns to the bottom and resumes following.

**Summarize and guide** catches up on the current conversation and switches to Guided conversation. It preserves any unsent draft. Guide uses GPT-5.6-Sol with Medium reasoning through Codex, reads the transcript and shared notes, and separates decisions from suggestions and disagreements. Its summaries use an additional provider call after each review or discussion round. Guide keeps native tool access and the same approval controls as the other ducks. Stopping a round skips its remaining replies and automatic summary.

**Suggest a duck**, in room settings, asks GPT-5.6-Sol with Medium reasoning for one missing perspective using the conversation, current draft roster, and shared notes. It explains why the suggested persona would help, or says when another duck is unnecessary. The suggestion opens as an editable draft card. Save the room to add it, or remove the card to dismiss it. This uses the Codex subscription in a read-only session; the helper reads the supplied discussion and does not change the conversation. A request can be cancelled and has a two-minute limit.

Model lists come from the connected providers: Claude Agent SDK model discovery and Codex App Server `model/list`. Reasoning options depend on the selected model. Lists cache for five minutes and can be refreshed from settings. A blank model uses the provider default. Unsupported model/effort combinations are rejected when changed.

Conversations, settings, notes, and completed or stopped responses are stored in `.data/duckpond.sqlite`. The `.data/` directory and `.env` files stay local and are excluded from Git. Leaving or closing the browser tab does not cancel a turn. The server continues until the replies finish, you press Stop, or the 15-minute turn limit expires. Returning to the tab, reconnecting, or reloading refreshes the room and its pending approval requests. While reconnecting to a running turn, the app polls its progress every two seconds. It does not resend the message. If a submission never reached the server, the app restores it to an empty draft for you to retry. Runtime state is not durable across a server restart.

## Provider access

Claude uses `ai-sdk-provider-claude-code` with the Vercel AI SDK. Codex uses its local App Server protocol; AI SDK's UI stream carries both providers' updates.

Ducks retain native tools, skills, and MCP configuration. Claude loads user, project, and local settings. Codex loads its normal configuration. Tool approval requests appear in the app and do not automatically approve themselves. Standard question and MCP form requests render input controls; more complex provider dialogs are not fully supported in this POC.

`DUCKPOND_AGENT_CWD` selects the working directory for both providers and their project-specific tools/settings. The default is `.data/agent`. Set it to a project directory when you want that project's configuration. `DUCKPOND_CLAUDE_BIN` can specify an absolute Claude executable path for a bundled build.

Each reply starts a fresh provider session with the shared transcript and notes. This keeps independent reviews separate, but repeats context and costs more than resuming provider sessions. Turns have a 15-minute limit; Claude has a 20-turn tool limit per reply. There is no automatic paid-API fallback.

## Development

```sh
vp check
vp test
vp run build
```

Tests cover independent review context, bounded discussion, Guide summaries and follow-ups, message grouping, mentions, model and reasoning validation, provider failures, silent observers, cancellation, approvals across browser disconnects, and duck suggestions.

The UI uses the base duck and four outfits in `public/brand/`. Their source artwork and generation prompts live in `design/duck-avatars/v1/`. Each duck chooses an outfit independently of its provider or persona.
