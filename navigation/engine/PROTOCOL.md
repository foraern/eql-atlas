# Atlas navigation protocol v1

The bundled `AtlasNavigation` process reads one JSON object per line from stdin. Every request requires `version: 1`, a caller-owned `id`, and `command`. Responses echo version/id and use `event: progress`, `result`, or `error`. Diagnostics go to stderr. An error includes `code` and `message`; a result includes `result` and measured `elapsedMS`. Process termination cancels active work.

- `inventory`: `root` installation directory; returns content-identified `zones` (`key`, `format`) and archive inspection failures.
- `prepare`: `root`, `cache`, `zone`, `format` (`s3d` or `eqg`), optional `profile` (`height`, `radius`, `step`, `slope`). Returns `key`, `contentKey`, `cached`, `manifest`, and `surfaceFile`. The file contains arrays of three triangle vertices. `validateOnly: true` checks complete collision/region inputs without building a mesh. Geometry conversion occurs in task-owned cache scratch space.
- `projectPoint`: `point`; returns bounded candidate `{point, poly, distance}` records. The caller must choose between floors. No implicit expansion of projection limits occurs.
- `findRoute`: `start` and `end` candidate records from the currently prepared mesh; returns surface-sampled `points`, `distance`, and resolved endpoints. Partial or capacity-limited paths return errors. Identical endpoints are a valid zero-distance route.
- `fixture`: test-only triangle geometry, optional profile and blocked map-coordinate boxes. This enables deterministic engine tests without distributing game assets.

Wire vertices always use the existing map coordinate convention `[mapX, mapY, mapZ]`. Game `/loc` is `[-mapY, -mapX, mapZ]`. Conversion to upstream navigation coordinates is confined to `fromMap`/`toMap`; upstream water queries have their own separately tested axis convention. Display exaggeration never enters this protocol.

Polygon references are opaque decimal strings representing unsigned 64-bit integers; retain them losslessly without converting them to JavaScript numbers. They are valid only for the prepared mesh. The cache manifest records the engine version, walking profile and content hashes of source dependencies, including absent external dependencies. `contentKey` identifies that manifest. Source hash changes force rebuilding; the UI clears endpoints when a loaded mesh's content identity changes.

The Electron NavigationBackend loads the returned surface file for selected-zone display; batch preparation skips loading it. This is a main-process decision, not a raw renderer-controlled filesystem operation. The renderer uses validated prepare/project/route commands with opaque preparation contexts and request IDs.

## Explicit action crossings (additive protocol v1 extension)

`findRoute` accepts optional `movement` and `catalogs`. The dry mesh and its cache key are unchanged; crossing catalogs are revalidated for every route and are never baked into a mesh.

`movement` contains:

- `mode`: `walk` (default), `tested`, or `preview`.
- `capability`: nonempty name of the character movement setup (default `Standard movement`, maximum 120 characters). Include relevant size, speed, buffs and movement conditions when recording tests.
- `actions`: subset of `jump`, `drop`, `swim`, `door`, `lift`; default `["jump"]`.
- `jumpDistance`, `jumpRise`, `jumpDrop`, `drop`: horizontal jump gap, upward jump difference, downward jump difference and maximum drop, all in original game units. Defaults 16, 2, 2, 8 are proposal limits, not measured movement constants. Each accepts 0–100.

A catalog has `version: 1`, `zone`, `format`, `assets` and `links`. `assets` must exactly equal the prepared manifest's complete source dependency/hash dictionary. Stale catalogs are excluded with a diagnostic; never refresh hashes without reviewing the crossings. There are at most 64 catalogs per request and 64 matching-zone links in total.

Each link is **directed** and has a unique `id`, `kind`, `from` and `to` map-coordinate triples, and optional `label` and `note`. Non-jump actions can specify up to 512 `via` map-coordinate points for authored instructions. Jump links have takeoff and landing only. No airborne trajectory, collision-free flight, jump feasibility, lift timing, swim physics, door access or live obstruction clearance is inferred. Both endpoints must project unambiguously to a dry floor within the ordinary bounds. Use two independently reviewed links for two directions. Drops reject upward motion; jump and drop geometry must meet the selected limits after projection.

A link without matching test evidence is allowed only in `preview`. User test evidence is recorded as:

```json
"verification": {
  "status": "userTested",
  "capability": "Character and movement conditions used in the test",
  "date": "YYYY-MM-DD",
  "notes": "Observed takeoff, landing, speed/buffs, direction and result",
  "profile": {"height": 6.55, "radius": 1.31, "step": 2.0, "slope": 45}
}
```

The setup name and four profile values must match the request (profile tolerance 0.001). The helper treats this as an explicit user attestation, not an independently verified measurement. Test status applies to the crossing direction, not the entire journey. Profile/setup or source changes prevent using stale evidence in tested mode. Conditional passages still need the recorded conditions to hold; live conditions are not observed.

Successful responses include ordered `segments`: each has `kind`, `status`, `points` and `distance`; action segments also have `id`, `label`, `note` and matching `verification` when present. Top-level status is `static` for pure walking, `userTestedCrossings` for matching tested actions, or `requiresVerification` if any action is unverified. `crossings` and `unverifiedCrossings` are counts. `points` remains a flattened compatibility representation, but renderers must use `segments` to distinguish schematic crossings from surface-constrained walking. Distances include crossing chord/waypoint lengths, not simulated motion lengths.

A fully dry walking route is preferred. Otherwise the bounded action graph first minimizes unverified crossings, then walking/crossing distance plus a 50-unit action penalty. It does not claim globally optimal physical distance. Each walking edge must be a complete Detour route; there is no partial-path success. More than 4,096 walking queries or 200,000 output points returns an explicit capacity error.

A `noRoute` error now includes `details`: a clipped-renderable `reachable` triangle overlay for the start's walking component, `excluded` catalog/link reasons with known endpoints, and an `explanation`. Reachable overlays are bounded at 200,000 triangles. Unknown breaks remain explicitly unknown; the engine does not diagnose an unseen door or assert that an unrecorded journey is impossible.
