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

The dev server uses `127.0.0.1:3999` and the production server (`vp run start`) uses `127.0.0.1:3998`, both with strict port checking. Each command sets `PORT` explicitly so an inherited value from another dev server cannot redirect it.

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

## How it works

- A **pond** is a project folder plus the ducks new conversations start with. **General** is the pond with no folder.
- A **conversation** is one thread with its own copy of its ducks and its own shared notes.
- A **duck** is a persona with a provider, model, reasoning level, and outfit.
- **Mediator** hosts every conversation. It is always available and isn't part of the roster.

### Sending a message

The **To** row above the message box picks who answers. It stays visible and remembers your choice per conversation. On phones it shrinks to one button that opens the full list.

- **Mediator** (the default when a conversation has more than one duck, and always available) reads your message, answers clarifications itself, or brings in the ducks who can help. They can push back on each other, and Mediator then reports the recommendation, remaining disagreements, and at most one question for you.
- **Each separately** sends one message to every duck at once. Nobody sees the others' answers while writing, then Mediator sums up. It applies to that one message; the To row goes back to Mediator afterward.
- **A duck** gets your message directly. Type `@` to bring another duck into the same message; the selected duck still replies.
- **Stop** cancels the turn's provider calls and pending approvals. Completed and partial messages stay saved.

**Summarize** in the header asks Mediator to recap where things landed, what's still disagreed, and the one question worth answering next. It doesn't change who you're talking to. Click the conversation's title to rename it.

While ducks work, each running reply shows what it's doing and for how long, such as "reading docs/plan.md · 1:42". After a minute without new text or steps it says "no update for 1:10" instead. The line under the message box names the phase, such as "Mediator is choosing who answers · 0:42". Finished replies keep a collapsible list of the steps they took. A failed or stopped reply offers **Ask <duck> again**, which selects that duck and puts your last message back in the box.

You can switch conversations and ponds while a turn runs, and send in another conversation; a yellow dot marks conversations that are still replying. Notes stay editable during a turn. Ducks are view-only until the replies finish or you press Stop.

A duck that has nothing relevant to add replies `PASS`. The transcript shows it as "had nothing to add," so you can tell a quiet duck from one that wasn't asked. Passes still use that duck's subscription. A finished group reply collapses to one line, such as "Mediator consulted Skeptic · 2 passed"; **Show** expands it. Inside, Mediator's instructions to each duck fold to one line, such as "Mediator asked Skeptic: …", and expand on click. A reply round that is still running, failed, or was stopped stays expanded.

### Shared notes

**Notes** in the header holds text every duck in the conversation reads before it replies. Edit it right there. Clicking outside closes the panel unless you have unsaved edits. Summaries don't change notes; copy anything worth keeping into them yourself.

### Ducks

**Ducks** at the end of the To row opens the conversation's duck list. Mediator is listed first; it hosts every conversation and can't be removed. Click a duck to edit its name, provider, model, reasoning, perspective, and outfit, or to remove it. Changes apply on Save and affect only this conversation; earlier messages stay as they are. Check **Also make these the <pond> defaults** to save the same list as the pond's starting ducks. Closing with unsaved changes asks before discarding them.

**Add a duck** at the top of the list has four options:

- **Suggest** reads this conversation and its notes and proposes up to five missing perspectives, each with a reason. It needs a message or notes first, so it's the last tab until then. In pond settings it reads the pond's docs and code instead, in a read-only sandbox.
- **Describe** turns a short description into a full persona you can edit before adding.
- **Reuse** copies ducks from your other conversations, one at a time or a whole group. Ducks already in the list are marked and can't be added twice.
- **Write your own** adds a duck with an empty perspective for you to fill in.

Suggestions use GPT-5.6-Sol with Medium reasoning in one read-only Codex call. They never change the conversation. Requests can be cancelled and time out after two minutes (three for workspace inspection). Added ducks start with the first duck's provider and model.

**Draw outfit** in a duck's editor generates a custom duck picture with Codex image generation. It needs the conversation to be saved once. You can close the dialog while it draws.

Personas define a priority, temperament, limits, and what would change their mind. Example personas live in `design/personas/game-room.json`.

### Ponds

Pick a pond in the sidebar. **New pond…** at the bottom of that list creates a pond in an existing absolute folder, or opens the pond already saved there. **<pond> settings…** in the same list opens its name and the ducks new conversations start with. The pond's folder shows under the picker. **New conversation** starts with the pond's defaults. Existing conversations keep their own ducks. Use a conversation's **⋯** menu in the sidebar to rename it, move it to another pond, or delete it; moving keeps its messages and ducks, and later replies run in the new pond's folder. A search box appears above the list once a pond has more than six conversations.

The folder holds `.duckpond/pond.json` with the pond's ID, name, and duck settings, and `.duckpond/ducks/<duck-id>.md` with each persona. You can edit and commit these files. Duckpond reads them when you open pond defaults or start a conversation, and rejects a stale save if they changed meanwhile. A missing or malformed file marks the pond unavailable instead of silently using built-in ducks.

All ducks, Mediator, and suggestions run with the pond's folder as their working directory. Claude loads user, project, and local settings. Codex starts its App Server in that folder. Project instructions, skills, MCP configuration, trust, and permissions follow each provider's own rules; Duckpond doesn't create or change those files. General uses `DUCKPOND_AGENT_CWD` when set, otherwise `.data/agent`.

Conversations are saved when you send a message, save notes, or save ducks. An empty conversation you never touched disappears when you leave it. Drafts and your To choice stay in this browser.

### Settings

The gear at the bottom of the sidebar shows whether Claude and Codex are signed in and lists commands you chose to always allow, with a way to revoke each.

### The message box

The box grows as you type. On desktop, Enter sends and Shift+Enter adds a line. On phones, Return adds a line and the arrow sends. The microphone uses the browser's speech recognition: speech appends to your draft, nothing sends automatically, and editing pauses while it listens. It needs a supported browser and a secure page, such as the Tailscale HTTPS address or localhost. Duckpond doesn't record audio; the browser may use an online speech service.

Messages render Markdown, including tables. Fenced `mermaid` blocks become diagrams once a reply completes; invalid diagrams fall back to their source. The transcript follows new replies while you're at the bottom. Scroll up to pause; **New replies** jumps back. On phones and narrow windows, replies appear when each duck finishes; desktop streams text live.

### How Mediator runs a discussion

Mediator uses GPT-5.6-Luna with Medium reasoning. It sees each duck's stated priority when choosing speakers. Opinion discussions usually take one or two duck replies, with a hard limit of three including passes and independent assessments. Approved work has an eight-turn limit, and every turn has a 15-minute timeout. Ducks that aren't asked make no provider calls.

Room tools are scoped to the current conversation and speaker:

- `ask_duck` records a question for a named peer. `request_turn` records a concern the speaker wants to discuss.
- `start_review` lets Mediator collect independent judgments from up to two ducks before anyone else replies.
- `assign_action` records a task, owner, deliverable, and the message that authorized it, then runs that owner. An existing action ID resumes unfinished work.
- `report_action` lets the owner submit a result with evidence or a concrete blocker.
- `review_action` lets Mediator accept a result or send it back.
- `give_floor` picks one duck for an opening contribution, a specific challenge, or a response.
- `finish_discussion` publishes the result. Mediator must defer every unanswered request with a reason, and pending work must run before it finishes.

Requests, actions, evidence, and reviews stay saved with the conversation. After a server restart, a running action becomes pending; its owner checks partial work before resuming. Room tools use [Codex App Server dynamic tools](https://developers.openai.com/codex/app-server) and [Claude's in-process MCP tools](https://code.claude.com/docs/en/agent-sdk/custom-tools). They only coordinate the conversation, so they need no approval. Native tools keep their usual approval prompts, which appear above the message box.

Model lists come from the connected providers: Claude Agent SDK model discovery and Codex App Server `model/list`. Reasoning options depend on the selected model. Lists cache for five minutes and can be refreshed from settings. A blank model uses the provider default. Unsupported model/effort combinations are rejected when changed.

Conversations, settings, notes, and completed or stopped responses are stored in `.data/duckpond.sqlite` (`.data-dev/` for `vp run dev`, so development never touches the data the built app uses). These directories and `.env` files stay local and are excluded from Git. Leaving or closing the browser tab does not cancel a turn. The server continues until the replies finish, you press Stop, or the 15-minute turn limit expires. Returning to the tab, reconnecting, or reloading refreshes the room and its pending approval requests. While reconnecting to a running turn, the app polls its progress every two seconds. It does not resend the message. If a submission never reached the server, the app restores it to an empty draft for you to retry. A server restart stops active work. Saved provider sessions remain available for the next turn; the app does not automatically rerun an interrupted task.

## Provider access

Claude uses `ai-sdk-provider-claude-code` with the Vercel AI SDK. Codex uses its local App Server protocol; AI SDK's UI stream carries both providers' updates.

Ducks retain native tools, skills, and MCP configuration. Claude loads user, project, and local settings. Codex loads its normal configuration. Tool approval requests show the reason, command, and project directory, with raw provider data under Technical details. Allow once approves one request. Always allow in this project saves the exact command, directory, provider, and requested access for future requests from any duck. Different commands, projects, providers, or requested privileges require another approval. Saved command permissions persist across restarts and can be revoked in Settings. Revoking affects future requests, not already-running commands. Standard question and MCP form requests render input controls; more complex provider dialogs are not fully supported yet.

`DUCKPOND_AGENT_CWD` selects the working directory for both providers and their project-specific tools/settings. The default is `.data/agent`. Set it to a project directory when you want that project's configuration. `DUCKPOND_CLAUDE_BIN` can specify an absolute Claude executable path for a bundled build.

Each conversation keeps one native provider session per duck, plus one for Mediator's discussions and one for its summaries. Claude resumes its saved session ID; Codex resumes its saved thread across App Server connections. SQLite stores the IDs and delivered-message hashes. Native conversation files stay in the providers' local storage, so back those up alongside Duckpond's database.

The first call for a duck sends the room history once, using an archived handoff if it exceeds the request budget. Later calls append unseen or changed published messages. The provider already retains its own replies. Independent reviews receive only the frozen room snapshot, so they cannot see peers' current reviews. Persona instructions and room-tool definitions stay stable across conversation modes; current mode, roster, notes, assignments, and passing rules arrive with the next turn. Room coordination tools only execute during a mediated discussion.

Changing a duck's provider, model, tool shape, or working directory starts a separate session with a bounded room handoff. Compatible instruction and tool-guidance changes preserve its session. Changing reasoning effort or switching modes keeps the session. A missing or failed native session does not silently fall back to resending the full history. Rooms without saved session IDs need one initial setup call per duck. No provider calls run as part of setup or migration.

Session reuse supports prefix caching, but does not guarantee a cache hit. Cache expiry, native compaction, provider settings, and tool configuration can affect reuse. Cached input still counts as input tokens, and subscription allowance accounting is controlled by the provider. Turns have a 15-minute limit; Claude has a 20-turn tool limit per reply. There is no automatic paid-API fallback.

## Usage

`GET /api/usage` returns recorded input, output, cache-read, cache-write, and reasoning tokens. It includes call counts, resumed calls, failures, stopped calls, and unfinished calls, grouped by room, duck, selected provider/model, and reasoning setting. Mediator, passes, and duck suggestions all count. The endpoint uses the same hostname checks as the rest of the app.

- `/api/usage?roomId=ROOM_ID` filters one room.
- `/api/usage?provider=claude` filters one provider.
- `/api/usage?calls=1` includes individual calls, new-message counts, and prompt sizes.

Records persist in the `provider_usage` table in `.data/duckpond.sqlite`. Tracking starts when calls run through this version; earlier usage is not backfilled. Reading the report makes no provider calls.

Input totals include cached input; cache counts are subsets, not extra tokens. Reasoning counts are part of output. Missing counts remain null on individual calls, and totals report how many calls supplied each measurement. Claude's final totals include reported subagent and compaction usage. Codex counts each reported inference in the reply, including native tool steps, without counting repeated notifications twice. Failed or stopped calls may provide only partial usage; calls interrupted by a server restart can remain unfinished. These are provider-reported token counts, not subscription percentages or dollar charges.

## Development

```sh
vp check
vp test
vp run build
```

Tests cover independent review context, sequential mediation, question ownership and deferral, discussion limits, summaries and follow-ups, message grouping, mentions, model and reasoning validation, provider failures, recorded passes, cancellation, approvals across browser disconnects, duck suggestions, persisted provider sessions, incremental context, and token accounting.

Provider integration tests are opt-in and use the local subscriptions. Set `DUCKPOND_DATA_DIR` and `DUCKPOND_AGENT_CWD` to a temporary directory. Set `DUCKPOND_PROVIDER_INTEGRATION=1` to verify both room-tool bridges, `DUCKPOND_DISCUSSION_INTEGRATION=1` for a complete discussion, or `DUCKPOND_ACTION_INTEGRATION=1` for a real file inspection with assignment and result review, then run `vp test src/server/room-tools.integration.test.ts`.

`DUCKPOND_SESSION_INTEGRATION=1 vp test src/server/sessions.integration.test.ts` checks two short Codex turns across separate connections, including remembered context and room-tool access. It also requires isolated data and agent directories and consumes subscription usage.

The UI uses the base duck and four outfits in `public/brand/`. Their source artwork and generation prompts live in `design/duck-avatars/v1/`. Each duck chooses an outfit independently of its provider or persona.

## Draw an outfit

Open Ducks, expand a duck, and choose Draw outfit. Enter a hat and clothing description, or leave it blank for Codex to choose from the duck's perspective. The generator uses Sol 5.6 Medium with the native imagegen skill and `design/duck-avatars/v1/base.png`. It does not use an API-key fallback. Native image generation must be available in the signed-in Codex account.

Generation continues when settings or the browser tab closes. Reopen the duck to see its saved previews. Choose Use outfit, then Save. Existing replies keep their original outfit. Only one outfit generates at a time. If the generated PNG is opaque, the same session attempts one background correction using the supplied cleanup prompt. Both turns count toward usage. An outfit must contain actual transparent pixels before it is offered for use. A server restart interrupts an unfinished generation and shows an error so you can try again.

Generated PNGs and job records live in `.data/avatars`, or under `DUCKPOND_DATA_DIR` when configured. Each job also saves its prompt. Back up this directory with the database. Reported Codex token usage appears in the usage endpoint; it does not measure remaining image-generation quota.

Conversation mode and the selected reply duck are remembered per room in browser storage. Refresh also restores the last open room. These preferences stay local to each browser.

## Context and session recovery

Sessions survive changes to prompt wording, tool descriptions, and string-length guidance. Provider, model, working-directory, and tool-shape changes require a new session. Duckpond commits a replacement session only after it accepts input, so a failed replacement preserves the previous working session.

Duckpond bounds new room-context batches to 32,000 characters. Oversized batches start a fresh native session with selected original messages, prioritizing the latest human message, its preceding proposal, and recent replies. The full visible transcript stays under `.data/context` for native file-tool lookup. A replacement session is saved only after the provider accepts its input; a failed handoff preserves the working session. Short updates continue using the existing session and its cache, even when its accumulated context is large. The 32,000-character limit covers the app's input text, not provider instructions, tools, retained native history, or a token/spending limit. This handoff is a selection of original messages, not a generated summary. It identifies omitted history and requires checking original decisions and authorizing messages before acting. Oversized individual messages remain intact in the archive. Independent reviewers only receive archives of messages visible to their review.

Open Context usage at the bottom of a conversation's Ducks dialog for each agent's last reported input tokens and recorded compactions. Codex also reports the model's context window. Claude input counts include cached tokens, but no window percentage is shown without a reported capacity. These figures are separate from cumulative usage. Native compaction remains managed by the provider. Handoffs preserve published conversation history; earlier native tool output is not copied, so ducks must reopen cited files when those details matter.
