# Sharp Removal Plan

## Current state (Bun 1.3.14)

Image optimization in `src/utils/imageProcessing.ts` uses **Bun.Image** as the primary backend. Sharp is kept as an **optional peer dependency** used only as a fallback when Bun.Image cannot encode the requested format on the current platform.

In practice, this means sharp is only invoked when:

1. The configured output format includes `avif`, AND
2. The runtime platform is not macOS on Apple Silicon M3+, AND
3. The runtime platform is not Windows with the AV1 Video Extension installed.

The most common case where sharp is actually loaded is **Linux servers configured to output AVIF**. Every other path (`jpeg`, `png`, `webp`, blur placeholders, EXIF auto-rotate, metadata) runs through Bun.Image with zero native dependencies.

## Why sharp is still here

Bun.Image's format support matrix (Bun 1.3.14):

| Format | macOS | Windows | Linux |
| ------ | -------------------------------------- | --------------------- | ----- |
| JPEG   | encode + decode                        | encode + decode       | encode + decode |
| PNG    | encode + decode                        | encode + decode       | encode + decode |
| WebP   | encode + decode                        | encode + decode       | encode + decode |
| GIF    | decode                                 | decode                | decode |
| BMP    | decode                                 | decode                | decode |
| TIFF   | decode                                 | decode                | — |
| HEIC   | encode + decode                        | encode + decode       | — |
| AVIF   | decode (encode on Apple Silicon M3+)   | encode + decode (with AV1 Video Extension) | — |

JPEG / PNG / WebP use statically-linked codecs (libjpeg-turbo, libspng, libwebp). HEIC, AVIF, and TIFF route through OS-level frameworks: **ImageIO + vImage** on macOS, **WIC** on Windows. Linux has no equivalent OS-installed framework, so Bun.Image declines those formats entirely.

The Bun team chose to dlopen libavif + dav1d on Linux for AVIF **decode** (PR [#30204](https://github.com/oven-sh/bun/pull/30204)), but AVIF **encode** requires vendoring an AV1 encoder (libaom / SVT-AV1 / rav1e) which is a significantly larger binary footprint and a separate effort.

## Removal trigger

Drop sharp entirely once **all** of the following are true:

- [ ] Bun.Image can encode AVIF on Linux (tracked by issue [#30199](https://github.com/oven-sh/bun/issues/30199); not yet covered by any open PR as of 2026-05-13 — #30204 adds decode only).
- [ ] Bun.Image can encode AVIF on macOS Intel and pre-M3 Apple Silicon (currently M3+ only).
- [ ] Bun.Image's JPEG encoder reaches `mozjpeg`-equivalent compression density, or we accept the small quality-per-byte regression.

## When that happens

1. Delete the sharp loader, `optimizeWithSharp`, and the `SharpPipeline` / `SharpFactory` types in `src/utils/imageProcessing.ts`.
2. Remove `sharp` from `peerDependencies` and `peerDependenciesMeta` in `package.json`.
3. Simplify `optimizeImage` to call `optimizeWithBunImage` directly with no fallback branch.
4. Update the warning message in `tryLoadSharp` callers — there will be none.
5. Delete this document.

## Notes for users

If you configure `formats: ['avif', 'webp']` and deploy to Linux without installing sharp, AVIF requests will fail and fall back to the original buffer (graceful degradation via the existing try-catch in `src/plugins/imageOptimizer.ts`). A one-time warning is logged. Either:

- Install sharp (`bun add sharp`) — full AVIF support, slightly larger node_modules and native build step.
- Drop `avif` from `formats` — WebP is the modern format that works everywhere with zero native deps.

## References

- Blog: <https://bun.com/blog/bun-v1.3.14>
- Issue (AVIF on Linux): <https://github.com/oven-sh/bun/issues/30199>
- PR (AVIF decode on Linux): <https://github.com/oven-sh/bun/pull/30204>
- Bun.Image type definitions: `node_modules/bun-types/bun.d.ts` (`namespace Image`)
