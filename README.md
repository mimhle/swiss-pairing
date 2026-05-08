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
- QR code generator utility with color, logo, dot style, margin, and error-correction controls.
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
- Advanced section support for running multiple groups inside one event.
- More card templates and reusable tournament branding presets.
- Import presets saved per organizer for recurring spreadsheet formats.
- Optional role-based access for assistants, arbiters, and scorekeepers.

## Notes

- Pairing generation depends on the bundled files in `public/bbpPairings`. Keep `bbpPairings.js` and `bbpPairings.wasm` available when deploying.
- The app is designed to run mostly client-side. Browser storage availability affects persistence and backup behavior.

## Credits

- Swiss pairing generation is powered by [`bbpPairings`](https://github.com/BieremaBoyzProgramming/bbpPairings), bundled here as a browser-loaded WebAssembly build.
