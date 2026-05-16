# Random Diptychs

An interactive pairing engine for my photography portfolio.

→ Live: https://random.thisisfed.xyz

Every click presents two of my photographs side by side. The interesting problem: with N images there are N(N-1)/2 possible pairs, and most are visually unremarkable. The site precomputes a colour signature for every image, scores every pair, and biases selection toward the strongest pairings while making sure every photo in the catalogue eventually surfaces.

All photographs and videos shot on iPhone.

## What's technically interesting

**Pair scoring.** Each image gets a signature — dominant palette, compositional density, saturation. Pair quality is computed with palette contrast and density contrast as *multiplicative* factors, not additive, so a pair with strong density difference but a shared palette gets little reward — that's where most "fake-contrast" pairings come from. Repetition and joint-desaturation penalties handle the common failure modes (two-brick pairs, two-greyscale pairs).

**Selection.** The picker draws from a quality-ranked top-N pool most of the time. About 1 in 3 clicks it switches to a per-image-staleness branch, dominated by photos that haven't been shown recently — converting the per-image guarantee from a coin flip into a long-term rotation engine. A click marks 20 images as recently-seen so pairs don't cycle.

**Sunrise/sunset theme.** Light mode during the day, dark at night, computed from the user's timezone — longitude derived from the standard UTC offset (DST handled correctly), latitude estimated from IANA region. Uses civil twilight, not geometric horizon, because there's plenty of natural light before and after the sun's disc is visible. Re-evaluated every minute so the transition fires live if you're on the page at sunset.

**Gated first paint.** Splash → welcome → analytics consent on first visit. The diptych is hidden via a CSS class until the last gate card *starts* fading out — without this, the partial-opacity cross-fade between two text cards lets the first pair faintly show through. The gate is lifted as the final card begins its fade, so the diptych is smoothly revealed underneath.

**iPhone safe-area handling.** All full-screen cards use `100dvh` and `env(safe-area-inset-*)` padding so content sits within the visually-balanced safe zone. Without this, centering in the full layout viewport reads as off-centre on phones with notch + home indicator.

**Accessibility.** Keyboard navigation (Space, Enter, arrows, Tab, Escape), focus-visible outlines, proper `aria-hidden` on dismissed cards, semantic markup throughout.

## Architecture: one file

The whole site is a single `index.html` — HTML, CSS, and JavaScript in one document. No framework, no bundler, no build step.

To be explicit: this is deliberate, not a shortcut. The site ships as one asset over HTTP/2, there's no `node_modules` to maintain, and the source you read is exactly the output that runs. Working under the constraints of single-file pushed me toward decisions that are simpler and more readable than the equivalent React app. The comments throughout aim to make the code self-documenting — they explain *why* a thing is the way it is, not what it does.

## Running it

```
git clone <this-repo>
open index.html
```

That's the whole thing.

The image set (`images/jpg/`, `images/avif/`) and the video set (`videos/`) are not in this repo — they're the work, copyright held. The site auto-discovers media by probing `images/jpg/ff1.jpg`, `ff2.jpg`, etc. in batches, so any sequence of correctly-named files in those folders will work as a stand-in.

## License

The code is yours to read, learn from, and borrow ideas from. Please don't redistribute the site as-is.

Photographs, videos, and the Random Diptychs concept are © Federico Ferrari. All rights reserved.
