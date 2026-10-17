# Study Momentum

Choose **Design theme → Study Momentum** in the dashboard header or the floating selector on public pages. **Architecture Studio** and **Classic** remain available in the same selector. The selection persists across navigation and reloads; `?ui=momentum`, `?ui=studio`, and `?ui=classic` provide direct previews. Existing saved preferences are respected. First-time visitors start with Study Momentum.

Study Momentum uses the exact source palette and font rather than inventing dark or pearl variants. Returning to Studio or Classic restores the previously selected color mode.

## Reference and implementation

Reference: `D:\soulmed\soulmed\design-preview`, specifically `src/styles.css` (Study Momentum tokens and navigation), `src/app-flows.css` (dashboard continuation card and shortcuts), `src/landing.css`, and the `screenshots/momentum-*` desktop/mobile references.

- Ink `#232843`, muted `#5f637b`, accent `#4939b1`, hover `#38258e`, tint `#eeecfb`, canvas `#f4f4fa`, white surfaces, borders `#dbdbe9`, 12px cards, Trebuchet MS / Segoe UI typography.
- The reference's horizontal desktop navigation, mobile bottom navigation, progress summary, indigo continuation card, citron actions, and modular cards are adapted to CodeManus's existing modules and live data.
- `src/styles/momentum.css` is loaded last and scoped to `.ui-momentum`. Shared Studio components remain the base; no source styles or medical sample data are imported globally.
- The builder, pipeline forms, account connection, support dialogs, administration, settings, authentication, landing, blog, reference, and legal pages retain their existing handlers and access controls.
- The continuation card opens the newest saved architecture. Shortcuts respect the existing superadmin restrictions on AI and support.

## Verification

Run `npm run build` for TypeScript and production build validation. The local browser verification script is `tmp/verify-momentum.mjs`; it uses isolated API fixtures and blocks backend writes. It expects Vite at `http://127.0.0.1:4182` and the existing local Playwright installation referenced at the top of the script. Results and screenshots are saved in `output/momentum-ui`.

Browser coverage includes 1440px, 768px, and 390px layouts, theme selection and persistence, restoration of the previous color preference, all visible dashboard modules, public routes, graph preservation across all three designs, service search, property editing, undo, and support/AWS dialogs. This verifies frontend behavior; it does not exercise live cloud deployments.
