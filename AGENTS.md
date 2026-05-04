<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project-specific conventions

- Runtime stack is `next@16.2.4` + `react@19.2.4` (`package.json`). Use App Router under `src/app`.
- Keep route entries in `src/app/**/page.js` (e.g., `src/app/page.js`, `src/app/standings/page.js`) and shared UI in `src/app/component/*`.
- Use the `@/*` import alias for `src/*` paths (configured in `jsconfig.json`).
- Add `"use client"` to interactive components that use hooks/browser APIs (examples: `src/app/component/PlayersTab.js`, `src/app/component/TournamentTabs.js`, `src/app/component/LightSwitch.js`).
- Styling uses Tailwind CSS v4 + Skeleton (`src/app/globals.css`). Theme is `data-theme="cerberus"` on `<html>` in `src/app/layout.js`, with dark mode controlled via `data-mode`.
- `src/app/component/PlayersTab.js` currently owns player-table workflows (import mapping, filters, warnings, exports). Follow its existing constants/helpers pattern when extending player management behavior.
- Spreadsheet/file handling uses `xlsx` (`src/app/component/PlayersTab.js`): import supports `.xlsx/.xls/.csv/.txt`; export supports Excel/CSV/XML.

## Commands

- `npm run dev` starts local development.
- `npm run build` builds production assets.
- `npm run start` runs the production server.
- `npm run lint` runs ESLint (`eslint.config.mjs`, Next core-web-vitals preset).
- There is currently no `test` script in `package.json`.

