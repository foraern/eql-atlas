# EQL Atlas Cross-Platform

EQL Atlas is an offline Electron and Three.js map viewer with local geometry routing. The same interface also supports browser map viewing with local folder import. This repository is the source of the macOS, Windows and Linux edition. Version 0.2.0 adds automatic routes from local zone geometry.

## Try the desktop app

Download a package from [GitHub Releases](https://github.com/foraern/eql-atlas/releases). These packages include the runtime; Node.js is only needed to build from source.

| Package | How to launch | Validation |
| --- | --- | --- |
| `EQL-Atlas-0.2.0-macOS-arm64.zip` | Extract, move the app to Applications, and open it. Requires an Apple Silicon Mac. | Native macOS build and packaged smoke tests. |
| `EQL-Atlas-0.2.0-Windows-x64.zip` | Extract the entire folder, then open `EQL Atlas Cross-Platform.exe`. Keep its supporting files together. | Native Windows build and packaged smoke tests in CI. |
| `EQL-Atlas-0.2.0-Linux-x64.tar.gz` | Extract the archive, then run `./EQL Atlas Cross-Platform` from the extracted folder. | Native Ubuntu build and packaged smoke tests in CI. |

This preview is unsigned and the Mac app is not notarized. macOS may block the first launch; after trying to open it, use **System Settings → Privacy & Security → Open Anyway** if you choose to trust this download. Windows may also show an unknown-publisher warning. Linux desktop dependencies and sandbox configuration vary by distribution; CI covers Ubuntu 24.04; other distributions may require additional system libraries. `SHA256SUMS.txt` accompanies the downloads for integrity checks.

Choose the **maps** folder in your EverQuest installation. The app indexes the root maps and collections one folder below it, such as Brewall. It remembers the chosen folder in its own preferences. A new macOS app may prompt for access if the game is on an external drive.

No game maps are distributed with the application, and no game files are modified or uploaded. Installed map collections may contain zones not available in the current EQL release.

## Controls

- Search zones by display name or short name; choose a source where several are installed.
- **3D:** drag to rotate, Shift-drag or right-drag to pan, scroll to zoom. Touch gestures are provided by Three.js OrbitControls.
- **Top / Side N / Side W:** fixed views; drag to pan. Top is north up, side N looks north, side W looks west.
- **Height slice:** clip to an exact Z range. Ghost other heights to retain context. Lower/higher slice buttons move through the height range.
- **Side height scale:** expand vertical spacing by 1×–16×. The ruler continues to show actual game Z coordinates.
- **Side cutaway:** limit depth to isolate rooms that overlap in the side projection.
- **Vertical edges:** emphasize sloped/vertical structure in muted orange above the teal map lines. These edges are not confirmed paths.
- **Landmarks:** filter annotations, choose one to center it, copy its `/loc`, or isolate its height. Brewall reference labels are opt-in and are not verified EQL spawn locations.
- **Your location:** enter `/loc` coordinates in **Y, X, Z** order, then mark. This is manual placement, not live tracking.
- **Save image:** export the map, labels, route, crossing annotations and route caveat as PNG.

The viewer retains supplied coordinates. It does not infer missing passages or guarantee that a drawn connection is traversable. Layers 2–3 are off by default because they frequently contain legends outside the actual zone.

Height limits, framing, and location checks include geometry from both layers 0 and 1. Switching maps clears the previous geometry and disables map controls until the new source loads. If loading fails, select another source or reopen the folder to retry. Unreadable optional Brewall references produce a warning without preventing the selected map from opening.

## Run from source

Requires Node.js 22.12+ (Node 24 recommended), npm, CMake 3.16+ and a C++17 compiler. Use Xcode command-line tools on macOS, Visual Studio C++ Build Tools on Windows, or GCC/Clang on Linux. The helper follows the upstream GPL v2 licence (`navigation/engine/LICENSE`); dependency notices remain with their sources. Dependencies and their licences are vendored; users of a packaged app need no compiler, Python or runtime package installation.

```sh
npm ci
npm start
```

To launch the desktop app with an explicit initial folder:

```sh
npm start -- --maps "/path/to/EverQuest/maps"
```

For the browser edition:

```sh
npm run dev
```

Open the printed local address and select your maps folder. Browser mode uses only the files explicitly selected through the directory picker; reopen the folder after reloading the page. A browser with WebGL 2 and directory input support is required. The production `dist/` output is static and can also be served by a local web server. No backend or Electron API is required for this mode.

## Build and package

```sh
npm run build
npm run package
```

The default package compiles and bundles the helper for the host OS and CPU. Build on each target system for macOS ARM64, Windows x64 and Linux x64. `.github/workflows/desktop.yml` defines native build and smoke-test jobs; a local successful Mac build does not establish Windows/Linux runtime support.

For explicit packaging, a matching native helper must already exist under `navigation/runtime/<platform>-<arch>/navigation`. The packager refuses to substitute a helper for a different target:

```sh
npm run package -- --platform win32 --arch x64
npm run package -- --platform linux --arch x64
npm run package -- --platform darwin --arch arm64
```

For an offline or retried package build, `node scripts/package.mjs --electron-zip-dir DIRECTORY` accepts an Electron ZIP and its `SHASUMS256.txt` release manifest, verifies the checksum, and uses that exact archive.

Builds land in `release/`. The helper, crossing catalogs, complete helper source and vendored licence notices are bundled alongside the Electron resources. Packaging is not code signing or notarization for public distribution. The desktop workflow builds and tests all three packages on their target operating systems; CI checks do not replace testing on every supported desktop configuration.

## Tests

```sh
npm run build:navigation
npm test
npm run test:navigation
npm run test:navigation-ui
npm run test:regressions
npm run test:maps -- "/path/to/maps"
npm run test:desktop -- --maps "/path/to/maps"
npm run test:browser -- --maps "/path/to/maps"
```

Core tests cover parsing, source grouping, location conversion, exact clipping, and decoration bounds. The installed-map check compares Kedge with known source counts and scans the full collection. Desktop integration checks actual rendered map pixels, source/zone switching, slicing, scale, location markers, PNG generation, and renderer isolation. Browser checks exercise a real directory input without the desktop bridge and check responsive layouts. Integration tests use a separate test profile under `qa/`.

`test:regressions` generates temporary synthetic map files and runs both desktop and browser modes in Electron. It verifies layer 1 bounds, failed-load cleanup and recovery, optional-reference failures, export filenames during zone switching, PNG output, renderer isolation, and responsive layouts. It needs no game installation and removes its fixture files afterward; reports and screenshots remain under `qa/`. The `test:maps`, `test:desktop`, and `test:browser` commands retain their assertions against the original installed-map snapshot, including its Kedge counts and 581 text-map zones (installed geometry-only zones are additional). They are additional corpus checks, not tests for an arbitrary map folder.

## Structure

- `src/core.js`: platform-independent parsing, coordinates, and clipping.
- `src/viewer.js`: Three.js orthographic renderer and canvas annotations.
- `src/app.js`: shared browser/desktop interface.
- `src/node-maps.js`: desktop filesystem adapter, restricted to indexed map paths.
- `electron/`: desktop window, sandboxed preload bridge, and integration checks.

The desktop renderer is sandboxed, with context isolation and Node integration disabled. Filesystem operations stay in the main process; IPC accepts only catalog zone/source identifiers, explicitly chosen folders, formatted coordinates, bounded PNG exports and validated navigation operations. The renderer cannot choose a helper executable, cache path, arbitrary file path or raw helper command. Only the main process spawns and cancels its owned navigation process. External navigation and network requests are disabled in the desktop app.

## Routing

Enter **Start** and **Destination** in `/loc` Y, X, Z order, or use each field's menu to pick a visible floor, use the selected landmark, or use the manual location marker. Click **Find route**. The first request prepares the zone asynchronously; large outdoor zones can take several minutes. Tile progress and cancellation remain visible. Later requests reuse validated caches. Map controls remain available during preparation. **Cancel** stops the owned helper and retains completed caches. **Fit**, **Swap** and **Clear** are next to the fields.

Geometry is discovered beside the selected maps folder. For another layout, use **Route options → Game folder** and choose the directory containing the zone archives. Content inspection excludes character/object-only archives. Installed zones without text maps receive a navigation-surface view. Missing assets remain unavailable; text lines never become inferred walking paths. If both S3D and EQG are installed, Atlas requires a geometry version choice and remembers it. Changing the reference map collection preserves the route, with a navigation-surface fallback if its text drawing is empty or unreadable; changing zone, geometry, endpoints, profile or movement settings clears it.

**Route options** contains the clearance profile: height 6.55, radius 1.31, step **2.0**, and maximum slope 45°. Horizontal/vertical voxel resolution is 0.8/0.4 game units. The profile and movement preferences are remembered. These are adjustable modelling assumptions, not verified EQL movement constants. Step 2.0 is the later stair-connectivity default; the original 1.5 proposal rejected the two Mistmoore regression journeys. Height exaggeration only changes the drawing. Distances and calculations use original game units.

Point projection searches no more than twice the radius horizontally and one character height vertically. The resolved `/loc` and adjustment are shown. Ambiguous floors require a choice; distant coordinates are rejected. Map picking raycasts against clipped navigation surfaces and offers visible overlapping heights. Routes, endpoints and crossing annotations respect the height/depth slice and ghost option; hidden portions are reported. Identical endpoints produce a zero-distance route. An incomplete search never counts as successful arrival.

Walking-only routes use collision surfaces, headroom, clearance, supported steps and slopes. Water, lava and special transitions are excluded. **Based on static geometry; door access and live obstructions are unverified.** No automatic movement, live tracking, combat avoidance or cross-zone travel is performed.

When walking cannot connect the endpoints, Atlas shows the reachable walking surface and known excluded crossing reasons. This does not prove the journey is impossible in-game. The later routing work is also included: optional directed jump, drop, swim, door and lift catalogs can connect independently walkable sections. **Allow tested crossings** requires matching user-supplied evidence for the exact assets, direction, profile and named character setup. **Preview unverified crossings** shows an orange, dashed, explicitly unverified proposal; it is not a passability claim. Expand **Route instructions** for ordered walking/crossing endpoints, crossing notes and recorded test conditions. Special movement is schematic, without inferred jump physics, door state, lift timing or swimming clearance. Jump/drop limits are proposal limits, not measured movement constants.

The bundled Sol B entrance–Efreeti pilot contains four proposed jump crossings in each direction. They are all unverified. Walking-only and tested modes must reject this journey until appropriate evidence exists. Import/export asset-bound catalogs under Route options; see `navigation/engine/PROTOCOL.md` for the schema. A changed game asset or profile invalidates old crossing evidence; importing a catalog never silently refreshes its source hashes.

**Prepare all zones** runs one preparation worker, records each ready, failed and unavailable zone, and continues after failures. Run it again to resume through cached completed work; cache/source checks still run. Results are saved under the application's `userData/navigation-cache/coverage.json`. This is separate from game data. Navigation entries include engine/profile identity and hashes of all referenced assets; corrupt or stale entries rebuild, and complete meshes are published from temporary scratch output. Source changes detected before projection or route queries require re-preparation. Requests carry IDs and preparation contexts so cancelled or stale results cannot replace a newer route.

## Navigation validation

The C++ engine tests cover collision/region loading, placed-object transforms, axes, steps/slopes, headroom, narrow gaps, stacked floors, disconnected islands, wall detours, water, tile seams, full arrival, surface sampling, capacities and directed crossing evidence. Node tests exercise the actual JSON helper, portable SHA256 identity, Unicode paths, cancellation, stale contexts and batch failure/resumption. Generated Electron fixtures cover all endpoint methods, ambiguous floor choices, map raycasts, geometry-only views and lifecycle changes. Browser regressions preserve directory import without routing access.

Optional read-only installed-game checks (caches and reports are written only to the chosen output directories):

```sh
python3 navigation/Tests/real_navigation.py GAME_DIRECTORY CACHE_DIRECTORY
python3 navigation/Tests/mistmoore_routes.py GAME_DIRECTORY CACHE_DIRECTORY REPORT_DIRECTORY
python3 navigation/Tests/efreeti_routes.py GAME_DIRECTORY CACHE_DIRECTORY REPORT_DIRECTORY
python3 navigation/Tests/representative_routes.py GAME_DIRECTORY CACHE_DIRECTORY REPORT_DIRECTORY
python3 navigation/Tests/coverage.py GAME_DIRECTORY CACHE_DIRECTORY REPORT_DIRECTORY
npm run test:navigation-ui -- --maps "/path/to/EverQuest/maps"
```

Installed coverage includes S3D/WLD, standard EQG and EQG v4; missing referenced external model assets are reported as preparation failures. Coverage results must distinguish these from parser errors, empty dry surfaces and disconnected routes. These checks establish static geometry behavior, not successful in-game walk-throughs. Native Windows/Linux build and runtime validation must pass on those platforms before a release claims they are verified.
