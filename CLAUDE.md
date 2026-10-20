# Taxonomap

A visual explorer for GBIF occurrence data (Astro, Vue islands, MapLibre). `README.md` covers setup, architecture and deployment.

## Design system

Follow the design system for any visual change: colours, type, the logo, icons or new components. Use the tokens in `src/styles/tokens.css` rather than raw colour values, and check both the dark and light themes.

@docs/design-system.md

## Code standards

`pnpm lint` enforces most of these; run it with `pnpm check` and `pnpm test` before finishing.

- **Structure**: functions stay under 40 lines (50 for `use*.ts` composables) and do one thing; nesting is at most 3 levels (use guard clauses or helpers); extract shared logic rather than copying it; one concern per file.
- **Naming**: no single-character names anywhere, including loop counters, lambda arguments and parameter names in types. Names say what a thing is (`activeUsers`, not `list`), booleans read as questions (`isValid`), and abbreviations are spelled out (`response`, not `res`). Named constants replace magic numbers and strings.
- **Formatting**: Prettier (`pnpm format`); one blank line between logical blocks and members; imports grouped Node, packages, `~/` aliases, then relative; no unused imports.
- **Dead code**: delete unused code and commented-out code. Don't leave `console.log`, `debugger`, or TODO/FIXME/HACK comments (lint errors); track follow-ups outside the code.
- **Documentation**: every exported function and class has a short docblock (purpose, and `@param`/`@returns`/`@throws` when not obvious); lint requires one. Comments explain why, never what.
- **Errors**: no empty `catch`; a deliberate swallow says why in a comment. Catch specific errors where practical, validate input at system boundaries, and keep internals out of user-facing messages.
- **Before publishing**: no secrets, keys, personal data or internal URLs in code, docs or fixtures; no `v-html`/`innerHTML` on unescaped data; no disabled lint rules or TLS checks.
