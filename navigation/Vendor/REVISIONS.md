All vendored components are from EQEmu/zone-utilities commit b361e63dd067e8959f5bf2341579f481d2374fd5.
Includes its pinned Recast/Detour, GLM and nlohmann JSON snapshots. Licence notices are retained in source headers and accompanying files.
Local patches: headless diagnostics/dependency tracking, selected archive format, region-writer class namespace separation, and loader correctness fixes documented in PATCHES.md.

The runtime Detour build uses 64-bit polygon references. Cached meshes are versioned and cannot be interchanged with standard EQEmu .nav files.

Zlib core v1.3.1: madler/zlib commit 51b7f2abdade71cd9bb0e7a373ef2610ec6f9daf. Core compression sources are built statically on every platform; its LICENSE is retained in zlib/.
