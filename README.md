# Swiss Pairing

A browser-based Swiss tournament manager built with Next.js. It helps organizers import players, generate Swiss pairings, record results, calculate standings, and keep multiple tournaments on the same device.

The pairing flow uses the bundled `bbpPairings` WebAssembly build in `public/bbpPairings`, so pairing generation runs in the browser without a separate backend service.

Live site: [https://swiss-pairing.vercel.app/](https://swiss-pairing.vercel.app/)

## Features

- Multiple tournament profiles with create, rename, duplicate, and delete actions.
- Player management with editable fields for name, rating, title, federation, club, group, gender, FIDE ID, team ID, and type.
- Player import from pasted CSV-style text or spreadsheet files, with column mapping and Vietnamese/English header detection.
- Player export as Excel, CSV, and XML.
- Automatic Swiss pairings through `bbpPairings` WASM.
- Manual pairing support with drag-and-drop boards, byes, skips, forfeits, and validation against previous opponents.
- Round result entry with wins, draws, forfeit scores, double forfeits, byes, and pending results.
- Score import from pasted data or spreadsheets, including multi-round imports.
- TRF export for tournament interoperability.
- Individual standings with configurable tiebreak priority, including Buchholz, Buchholz Cut 1, virtual Buchholz Cut 1, Sonneborn-Berger, wins, direct encounter, progressive score, wins as black, and games as black.
- Team standings by club or federation with configurable counted-player rules and ranking order.
- Player round-history modal from standings and rounds views.
- Player card generator with template layers, image assets, per-tournament saved config, single-card downloads, and ZIP batch export.
- Complete local data backup, restore, and clear actions.
- Optional Google Drive backup/restore sync through a public OAuth Client ID and the Drive app data folder.
- QR code generator utility with color, logo, dot style, margin, and error-correction controls.
- Optional in-app AI assistant for tournament questions, standings explanations, player histories, and pairing previews, with browser-saved API keys (BYOK).
- Light and dark mode.

## Tech Stack

- Next.js 16
- React 19
- Tailwind CSS 4
- Skeleton UI
- `bbpPairings` compiled to WebAssembly
- IndexedDB and `localStorage` for browser-side persistence
- `xlsx`, `qrcode`, `jszip`, `@dnd-kit`, and `lucide-react`

## Getting Started

Install dependencies:

```bash
npm install
```

Optional Google Drive sync requires a browser OAuth Client ID:

```bash
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Available Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

`npm run dev` starts the local development server. `npm run build` creates a production build, and `npm run start` serves that build. `npm run lint` runs ESLint.

## AI Assistant

The app includes an optional in-app tournament assistant. Open it from the sparkle button in the bottom-right corner. It can answer questions about the active tournament, explain standings and tiebreaks, look up player histories, and preview the next round's pairings. It can also add players, update player fields, remove unpaired players, apply a template to a whole column (the same templates available from the Players header right-click menu), and enter or update round results. It cannot generate pairings or change tournament settings; use the Rounds and Settings tabs for those actions.

### Bring your own key

Open the assistant and click the settings gear. Enter:

- API base URL, such as `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, or a local Ollama endpoint.
- Your API key.
- A model name. Use a tool-capable model so the assistant can read tournament data.
- A reasoning level: Auto, Low, or Off. Low is the default and reduces thinking time. Off disables reasoning where the provider supports it.

The key, base URL, model, and reasoning setting are saved in this browser's `localStorage`. They are sent with each assistant request and forwarded by the app's server to your provider. The server does not store the key. The assistant header shows "Your key" when your key is active, or "Server key" when the deployment's fallback key is used.

Provider presets in the settings panel fill in the base URL and model for OpenAI, OpenRouter, and local Ollama. For OpenRouter, `deepseek/deepseek-v4.1-flash-1017` supports tools. For local Ollama, run the app on the same machine as Ollama and pull a tool-capable model first.

Answers stream as they are generated. While the assistant works, the drawer shows the current step, the active action, elapsed time, and a short activity log. For example, after a write it can show "Added players — 2 added; total 12".

### Server fallback (optional)

You can also configure a deployment-wide key with environment variables. This is useful for a self-hosted instance where visitors should not need to bring a key. Copy `.env.example` to `.env.local` and set:

```bash
AI_API_KEY=sk-...
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
AI_REASONING=low
```

Set `AI_REASONING` to `auto`, `low`, or `off` for the server fallback. The browser setting takes precedence when a browser key is used.

Other provider examples:

```bash
# OpenRouter
AI_API_KEY=sk-or-v1-...
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=deepseek/deepseek-v4.1-flash-1017

# Local Ollama (keeps tournament data on your machine)
AI_API_KEY=ollama
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=llama3.1
```

Restart `npm run dev` after changing environment variables. The assistant shows "Not configured" until either a browser key or a server key is present. Set `NEXT_PUBLIC_AI_ASSISTANT_ENABLED=false` to hide the assistant UI entirely.

### How it works

- The chat drawer sends the conversation to `POST /api/assistant`.
- If the browser has a saved key, it sends the key in the `x-ai-api-key` header and the base URL, model, and reasoning level in the request body.
- The route calls the configured AI provider with tool definitions. A browser-supplied key is used only with the browser-supplied base URL, so the server fallback key is never sent to a user-supplied endpoint.
- If the model asks for tournament data or asks to change it, the browser executes the tool against IndexedDB and sends the result back to the route. Writes use the same store functions as the UI, and the app reloads visible views after a write.
- The route streams the answer back as server-sent events. The drawer renders tokens as they arrive and shows the current step and tool activity. Tool calls still round-trip through the browser because tournament data lives in IndexedDB.

### Security notes

- With BYOK, the key is stored in the browser's `localStorage`. Anyone with access to that browser profile can read it. Use a limited key and avoid shared computers.
- The key is sent through the app's server to the provider. The server forwards it and does not store it. If you do not want keys to transit the server, host the app yourself or call the provider directly from a trusted client.
- A public deployment should restrict `POST /api/assistant`. The endpoint is rate-limited per IP on a best-effort basis, but it is still an open proxy for visitors' keys. Consider adding authentication or limiting access to trusted users.
- The route accepts a browser-supplied base URL when the browser also supplies its own key. On a public deployment, set `AI_ALLOWED_BASE_URLS` to an allowlist of provider base URLs to reduce SSRF risk. Leave it unset for local development.
- Tournament data, including player names and results, is sent to the configured AI provider. Use a local model or a provider you trust if that is a concern.
- The assistant can read and, when asked, modify the active tournament. It cannot generate pairings or change tournament settings. Pairing previews are not saved.
- OpenRouter requests send `X-OpenRouter-App-Visibility: hidden`, so the app is not listed in public rankings. This applies only when OpenRouter first creates the app entry.

## Basic Workflow

1. Create or select a tournament from the tournament selector.
2. Add players manually or import a player list from text, CSV, or Excel.
3. Configure the tournament round count and tiebreak order.
4. Generate automatic pairings or create manual pairings.
5. Enter or import round results.
6. Review individual or team standings.
7. Export TRF files, player lists, player cards, or a full backup when needed.

## Data Storage

The app stores tournament data locally in the browser:

- Tournament list and active tournament: `localStorage`
- Players, mappings, card assets, tournament config, rounds, and backups: IndexedDB

No server database is required. Because the data is local to the browser profile and device, use the backup export feature before clearing browser storage, switching devices, or reinstalling the browser.

## Project Structure

```text
src/app/           Next.js route files and app shell
src/components/    Shared layout, modal, and utility components
src/context/       Tournament context provider
src/features/      Feature screens for tournament management and utilities
src/hooks/         Reusable React hooks
src/lib/           Storage, pairing engine, and standings logic
public
  bbpPairings/     Browser-loaded pairing engine assets
```

## Future Feature Ideas

- Public read-only standings and pairings page for players and spectators.
- Tournament report export as PDF, including standings, pairings, results, and metadata.
- Cloud sync or optional backend storage for cross-device tournament management.
- Arbiter audit log for pairing edits, result changes, imports, and deletions.
- FIDE/USCF federation export formats beyond TRF where applicable.
- Player registration form with QR/share link and organizer approval queue.
- Round timer, board display mode, and printable pairing sheets.
- More card templates and reusable tournament branding presets.
- Import presets saved per organizer for recurring spreadsheet formats.
- Optional role-based access for assistants, arbiters, and scorekeepers.
- Expose tournament operations to an external MCP server so AI agents can manage tournaments directly.

## Notes

- Pairing generation depends on the bundled files in `public/bbpPairings`. Keep `bbpPairings.js` and `bbpPairings.wasm` available when deploying.
- The app is designed to run mostly client-side. Browser storage availability affects persistence and backup behavior.

## Credits

- Swiss pairing generation is powered by [`bbpPairings`](https://github.com/BieremaBoyzProgramming/bbpPairings), bundled here as a browser-loaded WebAssembly build.
