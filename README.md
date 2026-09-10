# EQL Atlas Cross-Platform

A separate JavaScript/Three.js edition of EQL Atlas. The native Swift application remains independent. This edition runs as an Electron desktop application or as a browser interface with local folder import.

## Try the desktop app

Download a package from [GitHub Releases](https://github.com/foraern/eql-atlas/releases). These packages include the runtime; Node.js is only needed to build from source.

| Package | How to launch | Validation |
| --- | --- | --- |
| `EQL-Atlas-0.1.1-macOS-arm64.zip` | Extract, move the app to Applications, and open it. Requires an Apple Silicon Mac. | Tested on macOS. |
| `EQL-Atlas-0.1.1-Windows-x64.zip` | Extract the entire folder, then open `EQL Atlas Cross-Platform.exe`. Keep its supporting files together. | Experimental; packaged on macOS, not tested on Windows. |
| `EQL-Atlas-0.1.1-Linux-x64.tar.gz` | Extract the archive, then run `./EQL Atlas Cross-Platform` from the extracted folder. | Experimental; packaged on macOS, not tested on Linux. |

The initial release is unsigned and the Mac app is not notarized. macOS may block the first launch; after trying to open it, use **System Settings → Privacy & Security → Open Anyway** if you choose to trust this download. Windows may also show an unknown-publisher warning. Linux desktop dependencies and sandbox configuration vary by distribution; this preview has not been validated against them. `SHA256SUMS.txt` accompanies the downloads for integrity checks.

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
- **Save image:** export the map and its labels as PNG.

The viewer retains supplied coordinates. It does not infer missing passages or guarantee that a drawn connection is traversable. Layers 2–3 are off by default because they frequently contain legends outside the actual zone.

Height limits, framing, and location checks include geometry from both layers 0 and 1. Switching maps clears the previous geometry and disables map controls until the new source loads. If loading fails, select another source or reopen the folder to retry. Unreadable optional Brewall references produce a warning without preventing the selected map from opening.

## Run from source

Requires Node.js 22.12+ (Node 24 recommended) and npm.

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

The default package targets the host OS and CPU. To request another target:

```sh
npm run package -- --platform win32 --arch x64
npm run package -- --platform linux --arch x64
npm run package -- --platform darwin --arch arm64
```

Builds land in `release/`, separate from the native app. Packaging is not code signing or notarization for public distribution. Windows and Linux packages are explicitly experimental until their runtime behavior is verified on those systems.

## Tests

```sh
npm test
npm run test:regressions
npm run test:maps -- "/path/to/maps"
npm run test:desktop -- --maps "/path/to/maps"
npm run test:browser -- --maps "/path/to/maps"
```

Core tests cover parsing, source grouping, location conversion, exact clipping, and decoration bounds. The installed-map check compares Kedge with known source counts and scans the full collection. Desktop integration checks actual rendered map pixels, source/zone switching, slicing, scale, location markers, PNG generation, and renderer isolation. Browser checks exercise a real directory input without the desktop bridge and check responsive layouts. Integration tests use a separate test profile under `qa/`.

`test:regressions` generates temporary synthetic map files and runs both desktop and browser modes in Electron. It verifies layer 1 bounds, failed-load cleanup and recovery, optional-reference failures, export filenames during zone switching, PNG output, renderer isolation, and responsive layouts. It needs no game installation and removes its fixture files afterward; reports and screenshots remain under `qa/`. The `test:maps`, `test:desktop`, and `test:browser` commands retain their assertions against the original installed-map snapshot, including its Kedge counts and 581-zone catalog. They are additional corpus checks, not tests for an arbitrary map folder.

## Structure

- `src/core.js`: platform-independent parsing, coordinates, and clipping.
- `src/viewer.js`: Three.js orthographic renderer and canvas annotations.
- `src/app.js`: shared browser/desktop interface.
- `src/node-maps.js`: desktop filesystem adapter, restricted to indexed map paths.
- `electron/`: desktop window, sandboxed preload bridge, and integration checks.

The desktop renderer is sandboxed, with context isolation and Node integration disabled. Filesystem operations stay in the main process; IPC accepts only catalog zone/source identifiers, explicitly chosen folders, formatted coordinates, and bounded PNG exports. External navigation and network requests are disabled in the desktop app.
