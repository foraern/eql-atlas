# Local changes to the pinned upstream snapshot

- Force the selected S3D/EQG family; no fallback to a different installed zone version.
- Record archive and external zone-file reads for source-content cache validation.
- Rename the offline water-map writer types so they coexist with the runtime reader.
- Send registered upstream diagnostics to stderr, preserving the JSON stdout protocol.
- Fix an assignment used as a condition in WLD fragment reference resolution (`0x2d`).
- Make water-map destruction virtual and expose const bounding-box transforms.
- Validate S3D water BSP child indices, cycles and recursion depth. Build conservative blocked-subtree data so proven-dry navigation tiles need no per-voxel region queries.
- Add a conservative region bounding-box query to the EQG water reader. Exact point classification remains authoritative where a blocking region may intersect.

Atlas's headless adapter, cache handling, tiled generation, vertical layer handling and route sampling live outside the upstream sources in `navigation/engine/`.
- Reject missing referenced placeables/models and unreadable present EQG region/collision files rather than returning partial geometry. Absent optional EQG water/invisible-wall records are handled according to the format's empty-region semantics.

Electron portability: external PFS/ZON reads resolve against a read-only source root instead of symlinking the installation into scratch (works without Windows symlink privileges). UTF-8 external paths use wide file APIs on Windows. Bundled zlib is linked statically. SHA-256 and process IDs no longer require Apple-only APIs.
