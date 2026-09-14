# Scope

This is the Electron EQL Atlas source repository for macOS, Windows and Linux. Keep all changes inside this folder. Do not modify the native Swift sibling `../EQLAtlas` or the installed native application.

# Stack and validation

- Plain JavaScript, Three.js, Vite, and Electron. Keep the renderer usable in an ordinary browser with local folder import.
- Map coordinates are `[mapX, mapY, Z]`; `/loc` is `[-mapY, -mapX, Z]`.
- Use only supplied map geometry. Do not invent traversable routes or treat map annotations as live NPC data.
- Default to layers 0–1. Layers 2–3 often contain diagrams outside the zone.
- Run `npm test`, `npm run build`, and targeted desktop checks after behavior changes.
- Use `npm run test:regressions` for repeatable desktop and browser-mode checks with generated map fixtures; the installed-map suites require their original corpus.
- Read game files only. No game process access, network services, or map uploads.
- Keep Electron context isolation, sandboxing, and narrow validated IPC. Use a distinct app identifier and preferences directory.
- Package via `npm run package`; native Windows/Linux execution must be reported separately from macOS verification.

# Navigation

- The C++17 helper lives in `navigation/engine`, with pinned vendored dependencies in `navigation/Vendor`. Preserve licences and record upstream patches.
- Run `npm run build:navigation` before tests. Use `npm run test:navigation` for engine fixtures and `npm run test:navigation-ui` for sandboxed Electron fixtures; neither needs game assets.
- Keep helper paths, cache/source authority and process ownership in `electron/navigation.cjs` and `electron/main.cjs`. Renderer code uses bounded commands and opaque context IDs, never raw helper commands or file paths.
- Polygon references cross JSON as decimal strings. Display height scaling never changes routing coordinates.
- Current profile defaults: height 6.55, radius 1.31, step 2.0, slope 45; these are modelling assumptions.
- Never turn disconnected walking paths into successful routes. Explicit action crossings remain separate segments; unverified crossings require preview mode, source/profile/setup-bound user evidence is required in tested mode.
- Browser mode remains a map viewer; no inferred routes from map lines.
- Build helpers on their target OS/architecture. Packaging a Mac helper into a Windows/Linux package is invalid. Report runtime checks separately for each platform.
