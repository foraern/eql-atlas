# Scope

This is the separate cross-platform EQL Atlas experiment. Keep all changes inside this folder. Do not modify the native Swift sibling `../EQLAtlas` or the installed native application.

# Stack and validation

- Plain JavaScript, Three.js, Vite, and Electron. Keep the renderer usable in an ordinary browser with local folder import.
- Map coordinates are `[mapX, mapY, Z]`; `/loc` is `[-mapY, -mapX, Z]`.
- Use only supplied map geometry. Do not invent traversable routes or treat map annotations as live NPC data.
- Default to layers 0–1. Layers 2–3 often contain diagrams outside the zone.
- Run `npm test`, `npm run build`, and targeted desktop checks after behavior changes.
- Read game files only. No game process access, network services, or map uploads.
- Keep Electron context isolation, sandboxing, and narrow validated IPC. Use a distinct app identifier and preferences directory.
- Package via `npm run package`; native Windows/Linux execution must be reported separately from macOS verification.
