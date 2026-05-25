# Volunteers Week 2026 — Standalone

A standalone React app that recreates the Vincentt project `6a11a202235553b0e66afe7e` ("Volunteers Week 2026 filter") as hand-written TSX, instead of being driven by the dynamic ProjectConfig renderer.

## What's inside

- `src/App.tsx` — top-level: `XRProvider` + `XRScene` shell mirroring `xr-client`'s `ARPage`.
- `src/Scene.tsx` — the actual scene: a waving palm sprite, a full-screen decorative frame, and a bouncing "Show your hand" prompt. Includes the open-palm gesture pulse logic ported from the original `onInit` script.
- `public/assets/` — the 3 textures, downloaded once from staging S3.

## Run

```sh
npm install
npm run dev
```

Opens at http://localhost:5180.

## Notes

- `xr-sdk` is pulled from the staging CDN tarball (same as xr-client). To switch to a local build, replace the `@vincentt-sdks/xr-sdk` dep in `package.json` with `file:../../xr-sdk`.
- This skips the xr-client bootstrap layer (asset registry, scene-store, sandbox bridge, Sentry). Just enough to mount the canvas and run one scene forever.
- Originally generated from sandboxconfig `6a11a43cbc6a115383bd9a93` (v20).
