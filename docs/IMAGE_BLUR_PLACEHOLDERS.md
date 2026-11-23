# Blur placeholders

A blurred, tiny version of an image, shown while the real one loads.

```tsx
<Image src="/assets/png/hero.png" width={1200} height={600} placeholder="blur" />
```

That is the whole of it. The build generates the placeholder; nothing else
is needed.

## What changed

`placeholder="blur"` used to do **nothing** unless you also computed a
base64 thumbnail yourself and passed it as `blurDataURL`. The prop was
accepted, resolved to `undefined`, and no placeholder was rendered. The
type even said `blurDataURL` was "auto-generated for build-time images" —
nothing generated it.

## What gets a placeholder

Every `.png`, `.jpg`, `.jpeg`, `.webp` and `.avif` under your assets and
public directories, at build time.

**SVG is excluded** deliberately: it is already tiny and
resolution-independent, so a raster thumbnail of one is usually bigger
than the file it stands in for.

Images over 12MB are skipped — decoding one to produce an 8×8 thumbnail
costs more than the placeholder is worth, and a file that big is usually a
mistake worth noticing rather than paying for on every build.

An image the build never saw — a remote URL, one chosen at runtime — has
no generated placeholder. Pass `blurDataURL` yourself for those.

## Cost

Measured on a 427KB PNG: **3.2ms** to generate, **255 bytes** of output.
A hundred images is about a third of a second of build time.

The build writes `blur-placeholders.json` beside your build output. It is
server-only, so it is never served.

## Each page carries only its own

A page's HTML includes the placeholders for the images **that page
renders**, and no others.

This matters more than it sounds. The browser asset manifest that already
rides every page carries the whole app's entries; doing the same with blur
data would put 255 bytes × every image in the project into every page,
whether that page shows them or not — 25KB a page at a hundred images, and
base64 webp barely compresses.

A blur exists to cover the moment before an image paints, so the only
entries a page needs are the ones it is about to paint. The filtering is a
pure function of the rendered HTML, so there is no per-request collection
and nothing for two concurrent renders to interleave.

## Why the client gets them at all

The same component renders on the server and then hydrates. If only the
server could resolve a placeholder, the client would recompute the style
without it and strip the blur the server had just painted. Both sides read
the same map, so hydration produces the same style.

Soft navigation works for the same reason: the new page's HTML carries its
own placeholders.

## Turning it off

Pass `placeholder="empty"`, which is the default, or leave `placeholder`
unset. Nothing is generated into a page that does not ask for a blur.
