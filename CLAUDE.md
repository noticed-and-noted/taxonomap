# Taxonomap

A visual explorer for GBIF occurrence data (Astro, Vue islands, MapLibre). `README.md` covers setup, architecture and deployment.

## Design system

Follow the design system for any visual change: colours, type, the logo, icons or new components. Use the tokens in `src/styles/tokens.css` rather than raw colour values, and check both the dark and light themes.

@docs/design-system.md

## Code standards

`pnpm lint` enforces most of these; run it with `pnpm check` and `pnpm test` before finishing.

- **Structure**: functions stay under 40 lines (50 for `use*.ts` composables) and do one thing; nesting is at most 3 levels (use guard clauses or helpers); extract shared logic rather than copying it; one concern per file. Components sit in atomic folders (atoms, molecules, organisms by feature, views); see "Code layout" in `docs/architecture.md`.
- **Naming**: no single-character names anywhere, including loop counters, lambda arguments and parameter names in types. Names say what a thing is (`activeUsers`, not `list`), booleans read as questions (`isValid`), and abbreviations are spelled out (`response`, not `res`). Named constants replace magic numbers and strings.
- **Formatting**: Prettier (`pnpm format`); one blank line between logical blocks and members; imports grouped Node, packages, `~/` aliases, then relative; no unused imports.
- **Dead code**: delete unused code and commented-out code. Don't leave `console.log`, `debugger`, or TODO/FIXME/HACK comments (lint errors); track follow-ups outside the code.
- **Documentation**: every exported function and class has a short docblock (purpose, and `@param`/`@returns`/`@throws` when not obvious); lint requires one. Comments explain why, never what.
- **Errors**: no empty `catch`; a deliberate swallow says why in a comment. Catch specific errors where practical, validate input at system boundaries, and keep internals out of user-facing messages.
- **External requests**: flag to the user, every time, any change that makes the app call a host it didn't call before (a new API, tile or font server, image CDN, analytics or third-party script), including a new endpoint on an existing host when it sends user input such as search text or location. Name the host, what is sent, and why. Don't add one silently: it needs the privacy and terms pages (`src/pages/privacy.astro`, `src/pages/terms.astro`) and, if cached, `integrations/service-worker.ts` updated to match.
- **Before publishing**: no secrets, keys, personal data or internal URLs in code, docs or fixtures; no `v-html`/`innerHTML` on unescaped data; no disabled lint rules or TLS checks.
