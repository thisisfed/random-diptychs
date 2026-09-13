# Random Diptychs

A personal photography experiment by **Federico Ferrari**. Every click pulls two images side by side from an ongoing pool of stills and short videos — all shot and filmed entirely on iPhone, for the fun of it.

Live at **[random.thisisfed.xyz](https://random.thisisfed.xyz/)**.

There's no menu, no grid, no back button. Tap or press anywhere; once a pair is gone, it's gone. Swipe up on a pair to be told why it was chosen.

---

## How it works

The site is static: `index.html`, `app.js`, `captions.json`, with `styles.css` kept as the readable source for the stylesheet that ships minified inside `index.html`. No build step, no framework, no dependencies. Photography is the only thing on screen; everything else is engineered to disappear.

Pairing runs on three layers, in the order they were built.

### 1. Measurement

Every image is downsampled to a 256-wide canvas and summarised: a **7-bin lightness histogram**, a **centre-weighted 4-colour palette** carrying both HSL and OKLab coordinates, average saturation, density, mean lightness, edge energy, vertical balance, and the centre of visual weight. OKLab drives colour similarity because Euclidean distance there tracks how the eye reads colour difference; HSL drives hue-family detection (two reds are "the same family" even at different lightnesses). Signatures are computed once and stored in `captions.json`, so returning visitors skip the analysis entirely.

`pairScore(a, b)` rewards palette contrast (the dominant signal, raised to a power so moderate similarity loses ground fast), density contrast gated by palette, lightness contrast, and smaller terms for edge-energy and balance differences. It penalises hue-family repetition, joint desaturation, two busy frames, two empty frames. Pairs under a palette-contrast floor are rejected outright — unless the captions give a strong enough reason (see below), which is how CLOSED ends up beside OPEN 7 DAYS.

### 2. Captions

`captions.json` holds a hand-written caption for every frame: subject, one telling detail, light, surface, category, scale, distance, mood, shape, structure, plus flags for sky (and its hour), hands, logos, plants picked or growing. The scorer reads them. It rewards the same subject seen in a different world (gated by how different the context really is), words that answer each other — opposed, shared, or echoed — scale jumps, hands in both frames, matching structure or accent colours; it suppresses the same subject in the same context, and caps pairs whose depth or crowding clash.

The captions also feed the **why panel** (swipe up on touch, two-finger swipe on a trackpad): one line describing the two frames, one naming the reason they were paired. The reasons are rules over the same data — "Skies hours apart", "Size lies", "One says the opposite", "Nothing pairs better" for the pairs that top each other's rankings — with punctuation stripped and screen order respected.

### 3. Editorial layer

Measurement can't see whether a photograph is good, so the last word is manual, near the top of `app.js`:

- `EXCLUDE_IMAGES` — frames pulled from circulation. They appear in no pair, no pool, no count; the file and caption stay, so restoring one is deleting a line and rebuilding the pool.
- Tags, derived from each caption (`deriveTags`) with `IMAGE_TAGS` as a per-frame override. `BAN_TAG_PAIRS` rejects subject collisions that never look intentional (bathroom × food); `BOOST_TAG_PAIRS` nudges families that keep producing strong pairs (lamp × lamp, stairs × stairs, object × street); `TYPE_TYPE_PENALTY` suppresses two found-type frames unless their words actually spark.
- `PAIR_BAN` / `PAIR_BOOST` — single pairs by id, for known disasters and known gems.

`window.__score('7','31')` in the console gives any pair's score under the full stack.

### Selection

All ~29,000 combinations are scored; the top `TOP_PAIRS_POOL` (800) plus each image's five best partners form the reachable set — currently the figure the splash counts to. Each click either serves a stale image with its best available partner (`GUARANTEE_RATE`, half the time) or draws from the top pairs with a quality bias. Images seen in the last 40 clicks are held out; favourites are 2.5× likelier; which frame lands left is a coin flip; videos have their own rate, higher in the first clicks.

The strongest 500 photo pairs are also **baked into `index.html`** between `BUILD:pool` markers, along with the reachable count. The inline head script draws the opening pair from them and starts preloading before `app.js` exists, avoiding repeats across visits via a small localStorage ring. Run `__buildPool()` in the console after changing captions or scoring: it downloads a fresh `index.html` with the pool, the splash figures, and the counter kept in step.

### Theme and loading

Always near-black (`#111111`), white type, one font size everywhere. There is no day/night theme and nothing depends on where or when the visitor is.

The splash counts pairs — `0 / 1179` up to the full figure — climbing fast then creeping, and only finishing once the first pair is actually on screen behind it. Signatures come from the cache on return visits; scoring is deferred until after the first swap whenever the opening pair is already known.

### Shareable pairs

Every diptych has a URL (`#42,v12`), kept canonical via `history.replaceState`. Desktop: press **S** to copy. Mobile: long-press for the native share sheet.

---

## Project layout

```
.
├── index.html        # splash, cards, inlined stylesheet, baked opening pool
├── app.js            # everything else
├── captions.json     # caption + colour signature for every frame
├── styles.css        # readable source of the inlined stylesheet
├── tools/            # add-photo panel + wasm AVIF encoder (loads only when asked)
├── images/           # not in git — ff{N}.jpg/avif at 600/1000/1500 + full
└── videos/           # not in git — ff{N}.mp4 + ff{N}-poster.jpg
```

Images are discovered by probing `images/jpg/ff{N}.jpg` in parallel batches; videos likewise in their own namespace, addressed as `v{N}`. Each image ships at three widths in JPG and AVIF plus a full size capped at 2400px; the browser picks via `srcset`. Posters give videos real colour signatures — without one, a video pairs on a neutral fallback.

## Adding a photograph

On the live site, run `__addPhoto()` in the console. A panel opens over the page: drop a JPG, take the suggested number, paste the caption prompt into Claude with the photo attached, paste the reply back, press **Make the zip**. The zip contains every image size in both formats, `captions.json` with the new entry, and `index.html` with the pool rebuilt to include it — unzip into the site folder and upload. Everything runs in the browser; nothing is uploaded anywhere.

Tags derive from the caption automatically, so a new photo joins the editorial layer the moment it is captioned. A frame without a caption is scored by colour alone, which is how bad pairs come back.

## Configuration

All knobs live at the top of `app.js`. The ones that matter most:

| Constant | Value | Meaning |
|---|---|---|
| `TOP_PAIRS_POOL` | `800` | Ranked pairs eligible for selection, before per-image bests are added. |
| `GUARANTEE_RATE` | `0.5` | Probability a click serves a stale image with its best partner instead of a top pair. |
| `QUALITY_BIAS_POWER` | `1.2` | Skew toward the top of the ranking when drawing. |
| `RECENT_CLICKS_BLOCK` | `40` | Clicks an image is held out after being shown. |
| `MIN_PALETTE_CONTRAST` | `0.25` | Colour floor; below it a pair needs a caption reason ≥ `WORD_OVERRIDE` to survive. |
| `FAVORITE_IMAGES` / `FAVORITE_BOOST` | 16 ids / `2.5` | Frames drawn more often. |
| `EXCLUDE_IMAGES` | 3 ids | Frames pulled from circulation. |
| `VIDEO_RATE` | `0.35` | Chance a draw reaches for a video pair, after the early-session rate. |

Caption-term weights (`TEXT_OPPOSITION_BONUS`, `RHYME_BONUS`, `COLLISION_PENALTY`, …) sit alongside, each with a comment saying why its value is what it is.

## Browser support

Safari (macOS and iOS), Chrome, Firefox, current versions. AVIF with JPG fallback per `<picture>`; the Safari preload path pins an explicit srcset rung so the preloaded bytes are the bytes used.

## Deploying

Any static host. Upload the files, keep `images/` and `videos/` alongside; there is nothing to build and no server code.

## Credits

Photography, film, and direction: Federico Ferrari. Engineering built conversationally with Claude (Anthropic).
