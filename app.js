try {
    window.__build = "v146"
} catch (e) {}
/* Startup timestamps, ms after navigation, printed with ?debug when the first
   pair lands. First write wins, so a mark means "the first time this
   happened". */
const BOOT_T = { "app.js": Math.round(performance.now()) };

function bootMark(e) {
    BOOT_T[e] || (BOOT_T[e] = Math.round(performance.now()))
}
const IMAGES_BASE = "images",
    VIDEO_BASE = "videos",
    FORMATS = ["avif", "jpg"],
    SIZES = [600, 1e3, 1500],
    /* The tallest an image can render, matching --image-height in the
       stylesheet. It drives the srcset sizes hint, so overstating it makes
       the browser fetch a rung larger than it can use. Change both together. */
    IMAGE_VH = 75,
    ANALYSIS_WIDTH = 256,
    CONTACT_MIN = 4,
    CONTACT_MAX = 7;

function rollNextInterlude() {
    return 4 + Math.floor(4 * Math.random())
}
/* How many clicks an image is held out for after being shown. Measured over
   120-click sessions on this catalogue of 212 images:

     25 (original)  ~139 images seen, busiest tenth took 32% of appearances
     40 (current)   ~155 images seen, busiest tenth took roughly 24%
     60             ~170 images seen, busiest tenth took 18%
     100            all 212 seen, busiest tenth took 15%

   The trade is pairing quality: the recency filter rejects candidate pairs,
   so the longer the window, the more often pickPair is forced past its best
   options into weaker ones. Lowering it hands those options back. 40 keeps
   most of the variety 60 bought while leaving the scorer more room to choose
   well; 25 is the original if the pairs still aren't strong enough. */
const RECENT_CLICKS_BLOCK = 40,
    SIBLING_GROUPS = [
        ["97", "98"]
    ],
    FAVORITE_IMAGES = new Set(["11", "14", "17", "51", "58", "64", "69", "75", "81", "109", "112", "114", "117", "122", "124", "v24"]),
    /* Photographs pulled from circulation. Excluded before scoring, so they
       appear in no pair, no pool, no guarantee — the file stays on disk and
       the caption stays in captions.json, so putting one back is deleting a
       line here and rebuilding the pool. Excluding a weak single beats
       inventing a clever partner for it.

       Candidates looked at and left in, for now: ff126 (GREAT lorry side) and
       ff138 (BARGAINS shop window) — found type, but each holds a wall on its
       own; ff9 (tiled toilet wall) and ff139 (Victorian urinals) — bathroom
       register but composed, not crude. */
    EXCLUDE_IMAGES = new Set([
        "74",   /* Mon Chéri wrapper flat on a void — a dead single */
        "194",  /* Bethel church front — a snapshot; only its red ever paired */
        "v16"   /* toilet from above — crude outside its own register */
    ]),
    /* Editorial tags. Derived from each caption (category, subject, light,
       flags) by deriveTags below, so a new photograph is tagged the moment it
       is captioned. An entry here REPLACES the derived set for that frame —
       use it where the caption reads one way and the picture another. */
    IMAGE_TAGS = {},
    /* Subject collisions that never look intentional, whatever the colours
       say. A pair carrying both tags of any row is rejected outright. */
    BAN_TAG_PAIRS = [
        ["bathroom", "food"],
        ["bathroom", "hand"],
        ["bathroom", "body"]
    ],
    /* Families that keep producing the strongest pairs: the same kind of
       thing in two worlds, or a thing against the street it lives on. Small
       additive nudges — the colour terms still decide. */
    BOOST_TAG_PAIRS = [
        ["light-fixture", "light-fixture", .14],
        ["stairs", "stairs", .14],
        ["object", "street", .12],
        ["interior", "street", .12]
    ],
    /* Two found-type frames with no verbal spark is the same idea twice —
       the GREAT lorry beside the BARGAINS window. Words that answer each
       other (opposed, shared, echoed) are exempt: CLOSED against OPEN 7 DAYS
       is the pair the site exists for. */
    TYPE_TYPE_PENALTY = .35,
    /* Known single pairs, by sorted ids joined with a bar: "7|31". Ban wins
       over boost; both survive a pool rebuild. Filled by looking, not scored. */
    PAIR_BAN = new Set([]),
    PAIR_BOOST_SET = new Set([]),
    PAIR_BOOST_BONUS = .15,
    FAVORITE_BOOST = 2.5,
    FIRST_PAIR_FAVORITE_PROB = .5,
    PROGRESS_RATE_PER_SEC = 2e3,
    SPLASH_FADE_MS = 300,
    SPLASH_MAX_WAIT_MS = 3e4,
    INTERLUDE_APPEAR_MS = 800,
    VIDEO_DISPLAY_TIMEOUT_MS = 8e3,
    VIDEO_ANALYSIS_TIMEOUT_MS = 1e4,
    IMAGE_DECODE_TIMEOUT_MS = 1500,
    DISCOVER_BATCH = 20,
    SPLASH_PRELOAD_TARGET = 8,
    BG_LOAD_CONCURRENCY = 4,
    /* A pair has to be worth showing. pairScore returns -10 for a rejection and
       negative values for pairs whose penalties outweigh everything they have
       in common; neither belongs in front of anyone. */
    MIN_SHOWN_SCORE = 0,
    /* 800, not 500: the opening pool is the strongest stretch of the catalogue,
       and it is what a visitor sees before the per-image partners take over. */
    TOP_PAIRS_POOL = 800,
    QUALITY_BIAS_POWER = 1.2,
    TONAL_WEIGHT = .05,
    PALETTE_WEIGHT = .38,
    DENSITY_WEIGHT = .28,
    LIGHTNESS_WEIGHT = .17,
    SAT_WEIGHT = .05,
    BUSYNESS_WEIGHT = .08,
    ORIENTATION_WEIGHT = .08,
    HORIZON_WEIGHT = .05,
    EDGE_CONTRAST_NORM = .25,
    HORIZON_ALIGN_TOL = .25,
    PALETTE_CONTRAST_POWER = 2,
    REPETITION_PENALTY = 1.1,
    /* Caption-aware terms. These only apply when BOTH frames have a caption in
       captions-manifest.json; without it the term is exactly 0 and scoring is
       identical to before. Set any of them to 0 to switch that behaviour off. */
    RHYME_BONUS = .16,          /* same subject, different context: reward */
    COLLISION_PENALTY = .9,     /* same subject, same context: suppress */
    /* Calibrated against this catalogue: with the surroundings held identical,
       context distance runs 0.09 (p10) to 0.31 (p90); when light, surface and
       placement all differ it runs 0.35 to 0.57. So below .30 a repeated
       subject is the same picture twice, and by .52 it is unmistakably the
       same thing seen somewhere else. Re-measure if the catalogue changes
       character. */
    RHYME_CONTEXT_MIN = .3,     /* below this much context difference it's a collision */
    RHYME_CONTEXT_FULL = .52,   /* at or above this, the rhyme bonus is at full strength */
    DISTANCE_BONUS = .07,       /* close against far */
    LINE_BONUS = .06,           /* curved against vertical, etc. */
    /* Two frames that both carry legible words. The strongest new signal:
       a diptych where two unrelated signs answer each other is the thing a
       person browsing would never find and the scorer can. Weighted above the
       other caption terms for that reason. */
    TEXT_PAIR_BONUS = .13,
    /* ...unless they say the same thing, which reads as a duplicate rather
       than a rhyme. */
    TEXT_SAME_PENALTY = .25,
    /* The words themselves, not just their presence. A shared word or an
       opposed one is the rarest thing in the catalogue — CLOSED against OPEN 7
       DAYS, or "Hold me" against "I just want you to hold me" — and the sort of
       pair a person browsing would never assemble. Weighted above every other
       caption term for that reason. */
    TEXT_ECHO_BONUS = .3,
    TEXT_OPPOSITION_BONUS = .42,
    /* How good a caption reason has to be to survive the palette floor, and what
       it forfeits for the weak contrast. Set WORD_OVERRIDE above
       TEXT_PAIR_BONUS so merely having words on both sides is not enough — it
       takes a shared word, an opposition, or a subject rhyme. */
    /* Same form, different world. Two frames that share a dominant direction
       and sit close on geometry, while belonging to unrelated categories — a
       contrail and a handrail, a gable and a paper fold. The formal echo is
       what a viewer notices; the gulf between the subjects is what makes it
       worth noticing. Neither half is interesting alone, which is why both
       conditions have to hold. */
    /* Hands in both frames. Distinct from the people term because a hand is
       the one body part that recurs across completely unrelated pictures — a
       gloved hand on a lighter, a painted angel's fingers on a harp — and
       reads as a rhyme rather than a repetition. */
    /* Two frames built the same way — a lattice of poles against a lattice of
       shelves, a tiled wall against a mosaic. The structure is what a viewer
       recognises before they identify the objects, and none of the other
       fields could see it: scaffolding and shelving share no noun, no line
       direction and no category. Only assigned where the frame IS the
       structure, so a match means something. */
    /* The same small colour twice — a yellow sign against a yellow numberplate,
       red graffiti against a red light. The palette in signatures.json cannot
       see these: it keeps four swatches by area, and an accent is by
       definition too small to make that list. LET'S FLY has no yellow in its
       palette at all. So the accent is carried in the caption instead. */
    /* The visual block. Five fields describing what kind of picture a frame is,
       rather than what is in it. Weights are relative to the caption terms
       above: depth is the heaviest because a facade beside a receding room is
       the fastest way a diptych feels wrong, whatever else the two share.

       Scaled to this scoring range, where a strong pair sits around .8. */
    /* A shared geometry — two triangles, two circles — is a rhyme a viewer
       sees before they identify either subject. Rectangles are excluded from
       the bonus: in a catalogue of buildings and signs almost everything is a
       rectangle, so matching on it means nothing. */
    SHAPE_MATCH = .14,
    DEPTH_MATCH = .12,
    DENSE_MATCH = .10,
    PEOPLE_MATCH = .10,
    TEMP_MATCH = .08,
    MOOD_MATCH = .06,
    /* A clash is worse than a miss. Flat against deep, or an empty frame
       against a crowded one, caps the pair no matter what else agrees —
       these are the two that override a matching subject. */
    CLASH_CAP = .65,
    ACCENT_ECHO_BONUS = .12,
    STRUCTURE_ECHO_BONUS = .13,
    HANDS_ECHO_BONUS = .11,
    FORM_RHYME_BONUS = .14,
    WORD_OVERRIDE = .28,
    WEAK_CONTRAST_COST = .12,
    /* Real-world size, which the pixels know nothing about: a lighter framed
       like a cathedral. Scored on the gap between the two scales. */
    SCALE_JUMP_BONUS = .09,
    /* A hand against a hand, doing different things, is a rhyme. Two whole
       figures back to back read as a portrait sequence rather than a pairing,
       so that one is discouraged. */
    PEOPLE_ECHO_BONUS = .07,
    PEOPLE_CROWDING_PENALTY = .12,
    CAPTIONS_MAX_WAIT_MS = 1200,
    JOINT_DESAT_PENALTY = .5,
    JOINT_DESAT_THRESHOLD = .3,
    JOINT_FULL_PENALTY = .45,
    JOINT_FULL_THRESHOLD = .55,
    JOINT_EMPTY_PENALTY = .3,
    JOINT_EMPTY_THRESHOLD = .35,
    FALLBACK_TRUST_PENALTY = .4,
    MIN_PALETTE_CONTRAST = .25,
    VIDEO_RATE = .35,
    VIDEO_MIN_GAP = 1,
    GUARANTEE_RATE = .5,
    COLOR_SAMPLE_SIZE = 96,
    PALETTE_SIZE = 4,
    HIST_BINS = 7;

function altFor(e) {
    return `Federico Ferrari — Random Diptych ${e}`
}
let images = [];
const validImages = [],
    colorSignatures = new Map;
/* Set by the boot code: tells the splash counter the first pair is on screen,
   so it can run to 100% and let the splash go. Declared up here because the
   boot code runs before the rest of the file has been evaluated. */
var splashFinish = () => {};
let topPairs = [],
    imageBests = [],
    bestsPerImage = new Map,
    /* "srcA|srcB" for pairs that top each other's rankings; see computeTopPairs. */
    mutualBests = new Set,
    lastShown = new Map,
    recent = new Map,
    clickCount = 0,
    clicksSinceVideo = 1 / 0,
    interludePreload = null,
    interludeLoadTrigger = null,
    currentInterlude = null,
    lastInterlude = null,
    preparedNext = null,
    prepInflightId = 0;

function path(e, t, n) {
    return n ? `images/${t}/ff${e}-${n}.${t}` : `images/${t}/ff${e}.${t}`
}

function srcset(e, t) {
    return SIZES.length ? SIZES.map(n => `${path(e,t,n)} ${n}w`).join(", ") : path(e, t)
}

function srcToNum(e) {
    const t = e && e.match(/ff(\d+)(?:-\d+)?\.(?:jpg|avif|webp)$/i);
    return t ? t[1] : null
}

function numToSrc(e) {
    return `images/jpg/ff${e}.jpg`
}

function isVideo(e) {
    return /\.mp4$/i.test(e)
}

function videoNumToSrc(e) {
    return `videos/ff${e}.mp4`
}

function videoPosterUrl(e) {
    return e.replace(/\.mp4$/i, "-poster.jpg")
}

function srcToId(e) {
    if (isVideo(e)) {
        const t = e.match(/ff(\d+)\.mp4$/i);
        return t ? "v" + t[1] : null
    }
    return srcToNum(e)
}

function idToSrc(e) {
    if (!e) return null;
    const t = String(e);
    /* Must be v + digits, not "any string starting with v". */
    if (/^v\d+$/i.test(t)) return videoNumToSrc(t.slice(1));
    if (/^\d+$/.test(t)) return numToSrc(t);
    return null;
}
const SIBLINGS = new Map;
for (const e of SIBLING_GROUPS) {
    const t = e.map(idToSrc).filter(Boolean);
    for (const e of t) SIBLINGS.set(e, t.filter(t => t !== e))
}
async function discoverBy(e) {
    const t = [];
    let n = 1,
        a = 0;
    for (;;) {
        const o = Array.from({
                length: 20
            }, (e, t) => n + t),
            i = (await Promise.all(o.map(t => fetch(e(t), {
                method: "HEAD"
            }).then(e => e.ok ? t : null).catch(() => null)))).filter(e => null !== e);
        if (t.push(...i), 0 === i.length) {
            if (a > 0) {
                a--, n += 20;
                continue
            }
            break
        }
        if (i.length < o.length) {
            const t = n + 40;
            if (!await fetch(e(t), {
                    method: "HEAD"
                }).then(e => e.ok).catch(() => !1)) break;
            a = 1
        } else a = 0;
        n += 20
    }
    return t.sort((e, t) => e - t)
}
const discoverImages = () => discoverBy(e => `images/jpg/ff${e}.jpg`),
    discoverVideos = () => discoverBy(e => `videos/ff${e}.mp4`),
    SIG_CACHE_VERSION = 4,
    SIG_CACHE_KEY = "ff_signatures";

function readSignatureCache() {
    try {
        const e = localStorage.getItem(SIG_CACHE_KEY);
        if (!e) return {};
        const t = JSON.parse(e);
        return t && 4 === t.v && (t.sigs && "object" == typeof t.sigs) ? t.sigs : {}
    } catch {
        return {}
    }
}

function writeSignatureCache() {
    try {
        const e = {},
            t = {};
        for (const [n, a] of colorSignatures) a && !a.isFallback && (e[n] = a, isVideo(n) || !(a.aspect > 0) || (t[srcToNum(n)] = a.aspect));
        localStorage.setItem(SIG_CACHE_KEY, JSON.stringify({
            v: 4,
            sigs: e
        })), localStorage.setItem("ff_sig_meta", JSON.stringify({
            v: 4,
            n: Object.keys(e).length
        })), localStorage.setItem("ff_aspects", JSON.stringify(t))
    } catch {}
}
window.addEventListener("pagehide", writeSignatureCache);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") writeSignatureCache();
    else if (typeof startVisibleVideos === "function") startVisibleVideos();
});

function writeNextPair() {
    try {
        if (!preparedNext || !preparedNext.pair) return void localStorage.removeItem("ff_next_pair");
        const [e, t] = preparedNext.pair;
        if (isVideo(e) || isVideo(t)) return void localStorage.removeItem("ff_next_pair");
        localStorage.setItem("ff_next_pair", JSON.stringify([srcToNum(e), srcToNum(t)]))
    } catch {}
}

function readNextPair() {
    try {
        const e = localStorage.getItem("ff_next_pair");
        if (localStorage.removeItem("ff_next_pair"), !e) return null;
        const t = JSON.parse(e);
        return Array.isArray(t) && 2 === t.length && t[0] && t[1] && t[0] !== t[1] ? t : null
    } catch {
        return null
    }
}
window.addEventListener("pagehide", writeNextPair);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") writeNextPair(); });
const DISCO_CACHE_VERSION = 1,
    DISCO_CACHE_KEY_IMAGES = "ff_disco_images",
    DISCO_CACHE_KEY_VIDEOS = "ff_disco_videos";

function readDiscoCache(e) {
    try {
        const t = localStorage.getItem(e);
        if (!t) return null;
        const n = JSON.parse(t);
        return n && 1 === n.v && Array.isArray(n.indices) ? n.indices : null
    } catch {
        return null
    }
}

function writeDiscoCache(e, t) {
    try {
        localStorage.setItem(e, JSON.stringify({
            v: 1,
            indices: t
        }))
    } catch {}
}
const SEED_IMAGE_INDICES = [],
    SEED_VIDEO_INDICES = [],
    DISCO_REFRESH_MS = 216e5;

function discoSeed(e) {
    return "ff_disco_images" === e ? SEED_IMAGE_INDICES : "ff_disco_videos" === e ? SEED_VIDEO_INDICES : []
}

function discoStamp(e) {
    try {
        localStorage.setItem(e + "_ts", String(Date.now()))
    } catch {}
}

function discoRefreshDue(e) {
    try {
        return Date.now() - (+localStorage.getItem(e + "_ts") || 0) > DISCO_REFRESH_MS
    } catch {
        return !0
    }
}

function discoTailIndices(e) {
    const t = e && e.length ? e.reduce((e, t) => t > e ? t : e, 0) : 0;
    return Array.from({
        length: DISCOVER_BATCH
    }, (e, n) => t + 1 + n)
}

function mergeNewImages(e) {
    window.__discoImages = e;
    const t = e.map(numToSrc).filter(e => !images.includes(e));
    t.length && (images = images.concat(t), backgroundLoadRest(t))
}

function mergeNewVideos(e) {
    window.__discoVideos = e;
    const t = e.map(videoNumToSrc).filter(e => !images.includes(e));
    if (!t.length) return;
    images = images.concat(t);
    for (const e of t) validImages.includes(e) || validImages.push(e), colorSignatures.has(e) || colorSignatures.set(e, fallbackSignature()), loadVideoPosterForAnalysis(e);
    scheduleTopPairs(!0)
}

function discoRefresh(e, t, n, a, o) {
    const i = () => Promise.all(discoTailIndices(a).map(e => fetch(n(e), {
        method: "HEAD"
    }).then(e => e.ok).catch(() => !1))).then(e => e.some(Boolean) ? t() : null).then(t => {
        t && t.length && (writeDiscoCache(e, t), o && o(t)), discoStamp(e)
    }).catch(() => {});
    setTimeout(() => {
        "function" == typeof requestIdleCallback ? requestIdleCallback(i, {
            timeout: 1e4
        }) : i()
    }, 4e3)
}
async function loadBootstrap() {
    try {
        if ("1" === localStorage.getItem("ff_boot_missing")) return null
    } catch {}
    try {
        const e = await fetch("signatures.json");
        if (!e.ok) {
            try {
                localStorage.setItem("ff_boot_missing", "1")
            } catch {}
            return null
        }
        const t = await e.json();
        return t && t.sigs && "object" == typeof t.sigs ? t : null
    } catch {
        return null
    }
}
window.__exportSignatures = function() {
    const e = {};
    let t = 0;
    for (const [n, a] of colorSignatures) a && !a.isFallback && (e[n] = a, t++);
    const o = new Set(window.__discoImages || []),
        i = new Set(window.__discoVideos || []);
    for (const t in e) {
        const n = isVideo(t),
            a = n ? (srcToId(t) || "v").slice(1) : srcToNum(t);
        a && (n ? i : o).add(+a)
    }
    const s = [...o].sort((e, t) => e - t),
        l = [...i].sort((e, t) => e - t),
        c = JSON.stringify({
            v: 4,
            images: s,
            videos: l,
            sigs: e
        }, (e, t) => "number" == typeof t && !Number.isInteger(t) ? +t.toPrecision(6) : t),
        d = document.createElement("a"),
        h = URL.createObjectURL(new Blob([c], {
            type: "application/json"
        }));
    return d.href = h, d.download = "signatures.json", document.body.appendChild(d), d.click(), d.remove(), setTimeout(() => URL.revokeObjectURL(h), 5e3), t + " signatures / " + s.length + " images / " + l.length + " videos, " + Math.round(c.length / 1024) + " KB"
};


window.__exportCaptions = function() {
    const out = { __meta__: { version: 1 } };
    const keys = new Set();
    for (const k of subjects.keys()) keys.add(k);
    for (const src of colorSignatures.keys()) {
        const id = srcToId(src);
        if (id == null) continue;
        keys.add(isVideo(src) ? String(id) : ("ff" + id));
    }
    const list = [...keys].sort((a, b) => {
        const av = /^v/i.test(a), bv = /^v/i.test(b);
        if (av !== bv) return av ? 1 : -1;
        return parseInt(String(a).replace(/\D/g, ""), 10) - parseInt(String(b).replace(/\D/g, ""), 10);
    });
    for (const key of list) {
        const cap = subjects.get(key) || {};
        const src = captionKeyToSrc(key);
        const sig = src && colorSignatures.get(src);
        const entry = Object.assign({ kind: /^v/i.test(key) ? "video" : "image" }, cap);
        if (sig && !sig.isFallback) {
            entry.signature = {
                histogram: sig.histogram,
                palette: sig.palette,
                averageSaturation: sig.avgSat,
                meanLight: sig.meanL,
                density: sig.density,
                histogramMagnitude: sig.histMag,
                aspect: sig.aspect,
                edgeEnergy: sig.edgeEnergy,
                vertical: sig.vertical,
                centerX: sig.cx,
                centerY: sig.cy
            };
        }
        out[key] = entry;
    }
    const blob = new Blob([JSON.stringify(out, (k, v) => typeof v === "number" && !Number.isInteger(v) ? +v.toPrecision(6) : v, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "captions.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return Object.keys(out).length - 1 + " frames";
};

function discoverWithCache(e, t, n, a) {
    const o = readDiscoCache(e),
        i = o && o.length ? o : discoSeed(e);
    return i && i.length ? (discoRefreshDue(e) && discoRefresh(e, t, n, i, a), Promise.resolve(i)) : t().then(t => (writeDiscoCache(e, t), discoStamp(e), t))
}
const ROTATION_CACHE_VERSION = 1,
    ROTATION_CACHE_KEY = "ff_rotation";

function readRotationCache() {
    try {
        const e = localStorage.getItem("ff_rotation");
        if (!e) return null;
        const t = JSON.parse(e);
        return t && 1 === t.v ? "number" != typeof t.clickCount ? null : Array.isArray(t.recent) && Array.isArray(t.lastShown) ? t : null : null
    } catch {
        return null
    }
}

function writeRotationCache() {
    try {
        localStorage.setItem("ff_rotation", JSON.stringify({
            v: 1,
            clickCount: clickCount,
            recent: [...recent.entries()],
            lastShown: [...lastShown.entries()]
        }))
    } catch {}
}
window.addEventListener("pagehide", writeRotationCache);
/* Interludes remembered across visits, so a returning visitor isn't shown
   them again. "share" is deliberately NOT here: it carries the instructions
   (how to share, how to see why a pair was chosen), and those are worth
   repeating every session — someone who saw them once three months ago has
   not retained them, and without this they could never see them again. */
const PERSISTENT_INTERLUDES = ["welcome"],
    SEEN_INTERLUDES_KEY = "ff_seen_interludes",
    SEEN_INTERLUDES_VERSION = 1;

function readSeenInterludes() {
    try {
        const e = localStorage.getItem(SEEN_INTERLUDES_KEY);
        if (!e) return [];
        const t = JSON.parse(e);
        return t && 1 === t.v && Array.isArray(t.seen) ? t.seen.filter(e => PERSISTENT_INTERLUDES.includes(e)) : []
    } catch {
        return []
    }
}

function writeSeenInterludes() {
    try {
        const e = [...seenInterludes].filter(e => PERSISTENT_INTERLUDES.includes(e));
        localStorage.setItem(SEEN_INTERLUDES_KEY, JSON.stringify({
            v: 1,
            seen: e
        }))
    } catch {}
}

function rgbToHsl(e, t, n) {
    e /= 255, t /= 255, n /= 255;
    const a = Math.max(e, t, n),
        o = Math.min(e, t, n),
        i = (a + o) / 2;
    if (a === o) return {
        h: 0,
        s: 0,
        l: i
    };
    const r = a - o,
        s = i > .5 ? r / (2 - a - o) : r / (a + o);
    let l;
    switch (a) {
        case e:
            l = (t - n) / r + (t < n ? 6 : 0);
            break;
        case t:
            l = (n - e) / r + 2;
            break;
        default:
            l = (e - t) / r + 4
    }
    return {
        h: 60 * l,
        s: s,
        l: i
    }
}

function rgbToOklab(e, t, n) {
    const a = e => (e /= 255) <= .04045 ? e / 12.92 : Math.pow((e + .055) / 1.055, 2.4),
        o = a(e),
        i = a(t),
        r = a(n),
        s = .4122214708 * o + .5363325363 * i + .0514459929 * r,
        l = .2119034982 * o + .6806995451 * i + .1073969566 * r,
        c = .0883024619 * o + .2817188376 * i + .6299787005 * r,
        d = Math.cbrt(s),
        h = Math.cbrt(l),
        u = Math.cbrt(c);
    return {
        L: .2104542553 * d + .793617785 * h - .0040720468 * u,
        a: 1.9779984951 * d - 2.428592205 * h + .4505937099 * u,
        b: .0259040371 * d + .7827717662 * h - .808675766 * u
    }
}

function histogramDensity(e) {
    let t = 0;
    for (const n of e) n > 0 && (t -= n * Math.log2(n));
    return t / Math.log2(7)
}

function histogramMagnitude(e) {
    let t = 0;
    for (const n of e) t += n * n;
    return Math.sqrt(t)
}
window.addEventListener("pagehide", writeSeenInterludes);
const _analysisCanvas = "undefined" != typeof document ? document.createElement("canvas") : null,
    _analysisCtx = _analysisCanvas ? _analysisCanvas.getContext("2d", {
        willReadFrequently: !0
    }) : null,
    _colourBuckets = new Float64Array(32768);

const PALETTE_WIDTH = 48;
const _paletteCanvas = document.createElement("canvas");
const _paletteCtx = _paletteCanvas.getContext("2d", { willReadFrequently: !0 });

function analyzeImage(e) {
    try {
        const t = 96;
        _analysisCanvas.width !== t && (_analysisCanvas.width = t, _analysisCanvas.height = t);
        const n = _analysisCtx;
        n.drawImage(e, 0, 0, t, t);
        const a = n.getImageData(0, 0, t, t).data,
            o = new Array(7).fill(0),
            i = _colourBuckets;
        i.fill(0);
        const r = new Float32Array(t * t);
        let s = 0,
            l = 0,
            c = 0;
        const d = 1.6,
            h = t / 2;
        for (let e = 0, n = 0; e < a.length; e += 4, n++) {
            const u = a[e],
                m = a[e + 1],
                g = a[e + 2],
                p = n % t,
                f = n / t | 0,
                y = Math.abs(p - h) / h,
                w = Math.abs(f - h) / h,
                b = 1 + (d - 1) * (1 - Math.max(y, w));
            s += b;
            const S = (.2126 * u + .7152 * m + .0722 * g) / 255;
            r[n] = S, o[Math.min(6, Math.floor(7 * S))] += b, c += S * b;
            i[u >> 3 << 10 | m >> 3 << 5 | g >> 3] += b;
            const E = Math.max(u, m, g),
                v = Math.min(u, m, g);
            l += (E === v ? 0 : (E + v) / 510 > .5 ? (E - v) / (510 - E - v) : (E - v) / (E + v)) * b
        }
        for (let e = 0; e < 7; e++) o[e] /= s;
        const u = l / s,
            m = c / s;
        let g = 0,
            p = 0,
            f = 0,
            y = 0,
            w = 0;
        for (let e = 1; e < t - 1; e++)
            for (let n = 1; n < t - 1; n++) {
                const a = e * t + n,
                    o = r[a - t - 1],
                    i = r[a - t],
                    s = r[a - t + 1],
                    l = r[a - 1],
                    c = r[a + 1],
                    d = r[a + t - 1],
                    h = r[a + t],
                    u = r[a + t + 1],
                    m = s + 2 * c + u - (o + 2 * l + d),
                    b = d + 2 * h + u - (o + 2 * i + s),
                    S = Math.sqrt(m * m + b * b);
                g += S, p += Math.abs(m), f += Math.abs(b), y += S * n, w += S * e
            }
        const b = g / ((t - 2) * (t - 2)),
            S = p + f > 0 ? (p - f) / (p + f) : 0,
            E = g > 0 ? y / g / t : .5,
            v = g > 0 ? w / g / t : .5,
            T = [];
        /* The palette is taken from a 48px copy rather than the 96px analysis
           canvas. Downscaling is a box blur, and blurring first is what makes
           a textured surface resolve into its actual colour: grass photographed
           in sun and shade spreads across dozens of bins at 96px and none of
           them is ever large enough to place, so a smooth sky wins every time.
           A whole green field was reading as blue for this reason.

           The histogram, density, edge and lightness figures still come from
           the 96px pass — only the palette moves. */
        _paletteCanvas.width !== PALETTE_WIDTH && (_paletteCanvas.width = PALETTE_WIDTH, _paletteCanvas.height = PALETTE_WIDTH);
        _paletteCtx.drawImage(e, 0, 0, PALETTE_WIDTH, PALETTE_WIDTH);
        const B = _paletteCtx.getImageData(0, 0, PALETTE_WIDTH, PALETTE_WIDTH).data,
            k2 = new Map();
        let px = 0;
        for (let e = 0; e < B.length; e += 4) {
            const t = B[e] >> 3 << 10 | B[e + 1] >> 3 << 5 | B[e + 2] >> 3;
            k2.set(t, (k2.get(t) || 0) + 1), px++
        }
        for (const [e, t] of k2) T.push([e, t / px * s]);
        T.sort((e, t) => t[1] - e[1]);
        const I = [];
        /* Scan far more bins than there are slots, merging as we go, and only
           then keep the six heaviest.

           Stopping at six meant the six biggest bins won outright, so a single
           textured colour could fill every slot before a smaller one was
           reached: a photograph of red roses in foliage came back with six
           greens and no red at all, and was then described as having low
           colour on both sides. */
        for (const [e, t] of T) {
            if (I.length >= 24) break;
            const n2 = (e >> 10 & 31) << 3,
                a2 = (e >> 5 & 31) << 3,
                o2 = (31 & e) << 3,
                i = rgbToHsl(n2, a2, o2);
            if (i.l < .06 || i.l > .94 || i.s < .08) continue;
            let r = !1;
            for (const e of I) {
                let n = Math.abs(e.hsl.h - i.h);
                /* Lightness tolerance .55, not .12. Sunlit grass and shaded
                   grass are one colour to a viewer and must merge into one
                   swatch; the narrow window kept them apart and split the
                   weight that should have made green dominant. */
                if (n > 180 && (n = 360 - n), n < 22 && Math.abs(e.hsl.l - i.l) < .55) {
                    /* Keep the member with the most chroma, not the most HSL
                       saturation. Saturation peaks at near-black — a red at
                       lightness .06 reads as 100% saturated — so choosing on it
                       dragged merged swatches into the shadows: a terracotta
                       wall came back as an almost-black red and the frame was
                       then said to have no colour. Chroma is perceptual and
                       picks the swatch a viewer would call the colour. */
                    const c2 = rgbToOklab(n2, a2, o2),
                        ch2 = Math.hypot(c2.a, c2.b),
                        chE = Math.hypot(e.oklab.a, e.oklab.b);
                    e.weight += t / s, ch2 > chE && (e.hsl = i, e.oklab = c2), r = !0;
                    break
                }
            }
            r || I.push({
                hsl: i,
                oklab: rgbToOklab(n2, a2, o2),
                weight: t / s
            })
        }
        if (0 === I.length) {
            let e = 0,
                t = 0,
                n = 0,
                o = 0;
            for (let i = 0; i < a.length; i += 4) e += a[i], t += a[i + 1], n += a[i + 2], o++;
            const i = e / o,
                r = t / o,
                s = n / o;
            I.push({
                hsl: rgbToHsl(i, r, s),
                oklab: rgbToOklab(i, r, s),
                weight: 1
            })
        }
        I.sort((e, t) => t.weight - e.weight), I.length = Math.min(I.length, 6);
        const P = I.reduce((e, t) => e + t.weight, 0);
        I.forEach(e => e.weight /= P);
        const A = e.naturalWidth || e.videoWidth || e.width || 0,
            _ = e.naturalHeight || e.videoHeight || e.height || 0,
            L = A > 0 && _ > 0 ? A / _ : 1;
        return {
            histogram: o,
            palette: I,
            avgSat: u,
            meanL: m,
            density: histogramDensity(o),
            histMag: histogramMagnitude(o),
            aspect: L,
            edgeEnergy: b,
            vertical: S,
            cx: E,
            cy: v
        }
    } catch {
        return null
    }
}

function colorSimilarity(e, t) {
    const n = e.oklab.L - t.oklab.L,
        a = e.oklab.a - t.oklab.a,
        o = e.oklab.b - t.oklab.b,
        i = Math.sqrt(n * n + a * a + o * o);
    return Math.max(0, 1 - i)
}

function blankCanvasRepetition(e, t) {
    const n = Math.max(0, 1 - e.avgSat / .3),
        a = Math.max(0, 1 - t.avgSat / .3),
        o = Math.min(n, a);
    if (0 === o) return 0;
    const i = e => {
            let t = 0,
                n = 0;
            for (let a = 0; a < 6; a++) {
                const o = e.histogram[a] + e.histogram[a + 1];
                o > t && (t = o, n = a)
            }
            return {
                val: t,
                idx: n
            }
        },
        r = i(e),
        s = i(t);
    return r.val < .5 || s.val < .5 || Math.abs(r.idx - s.idx) > 1 ? 0 : Math.min(r.val, s.val) * o
}

function dominantRepetition(e, t) {
    const n = "undefined" != typeof window && window.__useRepDedup,
        a = e.palette[n ? representativeSwatchIndex(e) : 0],
        o = t.palette[n ? representativeSwatchIndex(t) : 0];
    let i = 0;
    if (a && o) {
        let e = Math.abs(a.hsl.h - o.hsl.h);
        e > 180 && (e = 360 - e);
        i = (Math.min(a.hsl.s, o.hsl.s) > .15 ? Math.max(0, 1 - e / 30) : Math.max(0, 1 - Math.abs(a.hsl.l - o.hsl.l) / .15)) * Math.min(a.weight, o.weight)
    }
    const r = blankCanvasRepetition(e, t);
    return Math.max(i, r)
}

/* ── CAPTION-AWARE SCORING ────────────────────────────────────────────────
   pairScore works on colour, light and structure. The caption manifest adds
   things the pixels can't express: what the subject IS, how far away it is,
   and which way the composition runs. Four terms use it.

   Both captions must be present or every term returns 0, so a half-filled
   manifest never skews one part of the catalogue against another. Until
   coverage is complete, captioned pairs can score marginally higher than
   uncaptioned ones simply by being eligible for the bonuses — worth finishing
   the run before judging the results.
   ───────────────────────────────────────────────────────────────────────── */

/* "Staircases" and "a spiral staircase" reduce to the same token. Crude on
   purpose: a real stemmer would be far more code for no gain at this size. */
function captionNoun(e) {
    if (!e) return "";
    let t = (e.short || "").trim().toLowerCase();
    if (!t) t = String(e.subject || "").toLowerCase().replace(/^(a|an|the)\s+/, "").split(/\s+/).pop() || "";
    t = t.replace(/[^a-z]/g, "");
    return t.length > 3 && t.charAt(t.length - 1) === "s" && t.charAt(t.length - 2) !== "s" ? t.slice(0, -1) : t
}

function captionSubject(e) {
    return e ? String(e.subject || "").toLowerCase().replace(/^(a|an|the)\s+/, "").replace(/[^a-z ]/g, "").trim() : ""
}

/* How different is everything AROUND the subject? 0 = same picture twice,
   1 = nothing in common. Drives whether a repeated subject reads as a rhyme
   or as a mistake. */
function captionContextDistance(e, t, n, a) {
    const o = paletteContrastOf(e, t),
        i = Math.min(1, Math.abs(e.meanL - t.meanL) / .35),
        r = Math.min(1, Math.abs(e.density - t.density) / .3),
        s = n.light && a.light && n.light !== a.light ? 1 : 0,
        l = n.surface && a.surface && n.surface !== a.surface ? 1 : 0,
        c = n.placement && a.placement && n.placement !== a.placement ? 1 : 0;
    return Math.min(1, .42 * o + .2 * i + .12 * r + .12 * s + .09 * l + .05 * c)
}
const DISTANCE_RANK = {
    close: 0,
    mid: 1,
    far: 2
};
/* Which line directions play off each other. Symmetric; anything not listed
   (including a shared direction, and anything involving "none") scores 0. */
/* Diagonal is gone from here as well as from the prose. Reading a frame's
   inclination proved unreliable, so it no longer earns or loses a pair any
   score; only the play between upright, flat and curved remains. */
const LINE_PLAY = {
    "horizontal|vertical": 1,
    "curved|vertical": .8,
    "curved|horizontal": .6
};

function linePlay(e, t) {
    return !e || !t || "none" === e || "none" === t ? 0 : LINE_PLAY[[e, t].sort().join("|")] || 0
}

const SCALE_PHRASE = {
    handheld: "something you could hold",
    furniture: "something you could lift",
    room: "a space you stand in",
    building: "a whole building",
    landscape: "open ground"
};
const SCALE_RANK = {
    handheld: 0,
    furniture: 1,
    room: 2,
    building: 3,
    landscape: 4
};

/* Words are compared on their letters alone, so "CHAMPAGNE" and "champagne."
   count as the same thing. */
function textKey(e) {
    return String(e || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()
}

/* Words too common to mean anything when two signs happen to share them. */
const TEXT_STOP = new Set("the a an of to and for on in is it with by we this all at from".split(" "));

function textWords(e) {
    return new Set(textKey(e).split(" ").filter(e => e.length > 1 && !TEXT_STOP.has(e)))
}

/* Opposed words. Deliberately short and literal — these are read off signs, so
   the pairs that matter are the ones shop fronts and warnings actually use. */
const TEXT_OPPOSITES = [
    ["closed", "open"],
    ["stop", "go"],
    ["empty", "full"],
    ["in", "out"],
    ["up", "down"],
    ["on", "off"],
    ["yes", "no"],
    ["start", "end"],
    ["push", "pull"],
    ["enter", "exit"],
    ["naked", "dressed"],
    ["day", "night"],
    ["dead", "alive"],
    ["fast", "slow"],
    ["hot", "cold"],
    ["new", "old"],
    ["free", "paid"],
    ["private", "public"],
    ["arrive", "depart"],
    ["hello", "goodbye"],
    ["never", "always"],
    ["lost", "found"],
    ["silence", "noise"],
    ["danger", "safe"],
    ["first", "last"],
    ["more", "less"],
    ["big", "small"],
    ["war", "peace"],
    ["love", "hate"],
    ["life", "death"]
];

/* Does either side carry a word the other opposes? */
function textOpposed(e, t) {
    for (const [n, a] of TEXT_OPPOSITES)
        if (e.has(n) && t.has(a) || e.has(a) && t.has(n)) return !0;
    return !1
}

/* Categories far enough apart to count as different worlds. Adjacent ones —
   a building and a room, a plant and the sky — share too much context for the
   pairing to surprise anyone. */
const NEIGHBOURS = {
    build: ["room", "sign"],
    room: ["build", "object"],
    plant: ["sky", "water"],
    sky: ["plant", "water"],
    water: ["sky", "plant", "liquid"],
    liquid: ["water", "food"],
    machine: ["object", "vehicle"],
    object: ["machine", "room"],
    vehicle: ["machine"],
    sign: ["build", "text"],
    /* Writing as the subject — graffiti, a label, an inscription — rather than
       a sign. It gets no line of its own: "Words in both" already says it. */
    text: ["sign"],
    light: [],
    food: [],
    person: [],
    animal: []
};

function formRhyme(e, t, n, a) {
    const o = n.lines,
        i = a.lines;
    if (!o || o !== i || "none" === o || "unclear" === o) return 0;
    const r = n.category,
        s = a.category;
    if (!r || !s || r === s) return 0;
    if ((NEIGHBOURS[r] || []).includes(s)) return 0;
    /* Curves only, now that diagonal has been withdrawn. Vertical and
       horizontal are the default states of almost everything photographed, so
       sharing one rewards coincidence rather than rhyme; a shared curve is a
       decision someone made with the camera.

       Geometry has to agree too, on both axes: a shared label alone would mean
       every curved thing rhymes with every other. */
    if ("curved" !== o) return 0;
    return Math.abs(e.aspect - t.aspect) < .15 && Math.abs(e.density - t.density) < .1 ? FORM_RHYME_BONUS : 0
}

/* The tag families a caption puts a frame in. Editorial, not measured: every
   word here was written by hand while looking at the photograph, so deriving
   from it is reading the archive's own notes. IMAGE_TAGS overrides the whole
   set for a frame when the caption reads one way and the picture another. */
function deriveTags(e) {
    if (!e) return null;
    const t = new Set,
        n = (e.subject || "") + " " + (e.detail || ""),
        a = e.light || "",
        o = e.category;
    return ("text" === o || "sign" === o) && t.add("type"),
        e.sky && t.add("sky"),
        "food" === o && t.add("food"),
        "vehicle" === o && t.add("vehicle"),
        ("room" === o || /interior|indoor|gallery|shop light|strip|fluoresc|kitchen|bathroom|workshop|studio/i.test(a)) && t.add("interior"),
        ("person" === o || e.people && "none" !== e.people) && t.add("body"),
        e.hands && t.add("hand"),
        /toilet|urinal|bathroom|\bsink\b|\bwc\b|bidet/i.test(n) && t.add("bathroom"),
        ("light" === o || /\blamp\b|lantern|pendant|chandelier|light fitting|street light|neon/i.test(n)) && t.add("light-fixture"),
        /stair|escalator|\bsteps\b|\bladder\b/i.test(n) && t.add("stairs"),
        /church|chapel|virgin|madonna|shrine|angel|\bcross\b|cathedral|altar|icon\b/i.test(n) && t.add("sacred"),
        ("build" === o || /street|pavement|shopfront|facade|hoarding|scaffold/i.test(n)) && t.add("street"),
        "object" === o && t.add("object"),
        t
}

function tagsFor(e, t) {
    const n = IMAGE_TAGS[e];
    return n ? new Set(n) : deriveTags(t)
}

/* The editorial layer over pairScore: hand bans and boosts by id, tag-pair
   bans, family boosts, and the found-type penalty. Returns null for a banned
   pair — the caller turns that into the same -10 a rejected pair gets. */
function editorialTerm(srcA, srcB, capA, capB) {
    let e = 0;
    if (srcA && srcB) {
        const t = [srcToId(srcA), srcToId(srcB)].sort().join("|");
        if (PAIR_BAN.has(t)) return null;
        PAIR_BOOST_SET.has(t) && (e += PAIR_BOOST_BONUS)
    }
    const t = tagsFor(srcA && srcToId(srcA), capA),
        n = tagsFor(srcB && srcToId(srcB), capB);
    if (!t || !n) return e;
    for (const [a, o] of BAN_TAG_PAIRS.map(e2 => e2))
        if (t.has(a) && n.has(o) || t.has(o) && n.has(a)) return null;
    for (const [a, o, i] of BOOST_TAG_PAIRS)(t.has(a) && n.has(o) || t.has(o) && n.has(a)) && (e += i);
    if (t.has("type") && n.has("type") && capA && capB) {
        const a = textWords(capA.text),
            o = textWords(capB.text),
            i = textOpposed(a, o) || textKey(capA.text) && textKey(capA.text) === textKey(capB.text) || [...a].some(e2 => o.has(e2));
        i || (e -= TYPE_TYPE_PENALTY)
    }
    return e
}

function captionScore(e, t, n, a) {
    if (!n || !a) return 0;
    let o = formRhyme(e, t, n, a);
    const tA = textKey(n.text),
        tB = textKey(a.text);
    if (tA && tB) {
        const wA = textWords(n.text),
            wB = textWords(a.text),
            shared = [...wA].some(e => wB.has(e));
        if (textOpposed(wA, wB)) o += TEXT_OPPOSITION_BONUS;
        else if (tA === tB) {
            /* The same words twice. Duplication when the two frames are alike,
               a rhyme when they are not: EUROPA on a drying t-shirt and EUROPA
               worn on a chest is the second case, and the earlier flat penalty
               was suppressing exactly the pair worth finding. */
            const ctx = captionContextDistance(e, t, n, a);
            o += ctx >= RHYME_CONTEXT_MIN ? TEXT_ECHO_BONUS * Math.min(1, (ctx - RHYME_CONTEXT_MIN) / Math.max(.01, RHYME_CONTEXT_FULL - RHYME_CONTEXT_MIN)) : -TEXT_SAME_PENALTY * (1 - ctx / RHYME_CONTEXT_MIN)
        } else o += shared ? TEXT_ECHO_BONUS : TEXT_PAIR_BONUS
    }
    const sA = SCALE_RANK[n.scale],
        sB = SCALE_RANK[a.scale];
    if (void 0 !== sA && void 0 !== sB) {
        const e = Math.abs(sA - sB);
        o += SCALE_JUMP_BONUS * (e >= 3 ? 1 : 2 === e ? .5 : 0)
    }
    /* Judged on the hands flag, not the people field: a painting whose people
       value is "figure" can still be a photograph of hands. */
    if (n.hands && a.hands) o += HANDS_ECHO_BONUS;
    /* Same construction, different thing. Requires different subjects, or two
       photographs of the same tiled wall would score as a rhyme. */
    if (n.structure && n.structure === a.structure && (n.short || "").toLowerCase() !== (a.short || "").toLowerCase()) o += STRUCTURE_ECHO_BONUS;
    if (n.accent && n.accent === a.accent && (n.short || "").toLowerCase() !== (a.short || "").toLowerCase()) o += ACCENT_ECHO_BONUS;
    /* Agreement on the visual block. Each field pays only when both frames
       carry it, so a frame annotated later never loses by comparison with one
       annotated earlier. */
    n.shape && n.shape === a.shape && "rectangle" !== n.shape && (o += SHAPE_MATCH);
    n.depth && a.depth && n.depth === a.depth && (o += DEPTH_MATCH);
    n.dense && a.dense && n.dense === a.dense && (o += DENSE_MATCH);
    n.people && a.people && n.people === a.people && (o += PEOPLE_MATCH);
    n.temp && a.temp && n.temp === a.temp && (o += TEMP_MATCH);
    n.mood && a.mood && n.mood === a.mood && (o += MOOD_MATCH);
    if (n.people && a.people && "unclear" !== n.people && "unclear" !== a.people) {
        const e = n.people,
            t = a.people;
        e === t && "none" !== e ? o += "figure" === e || "crowd" === e ? -PEOPLE_CROWDING_PENALTY : PEOPLE_ECHO_BONUS : "none" !== e && "none" !== t && ("figure" === e || "crowd" === e) && ("figure" === t || "crowd" === t) && (o -= PEOPLE_CROWDING_PENALTY)
    }
    const i = captionNoun(n),
        r = captionNoun(a);
    if (i && i === r) {
        /* Same subject twice. An identical full subject line ("the PALACE
           building sign" both sides) needs more separation before it reads as
           deliberate, so the threshold moves up. */
        const s = captionSubject(n) === captionSubject(a),
            l = captionContextDistance(e, t, n, a),
            c = s ? RHYME_CONTEXT_MIN + .1 : RHYME_CONTEXT_MIN;
        o += l < c ? -COLLISION_PENALTY * (1 - l / c) : RHYME_BONUS * Math.min(1, (l - c) / Math.max(.01, RHYME_CONTEXT_FULL - c))
    }
    const s = DISTANCE_RANK[n.distance],
        l = DISTANCE_RANK[a.distance];
    if (void 0 !== s && void 0 !== l) {
        const e = Math.abs(s - l);
        o += DISTANCE_BONUS * (2 === e ? 1 : 1 === e ? .35 : 0)
    }
    return o + LINE_BONUS * linePlay(n.lines, a.lines)
}

function pairScore(e, t, n_capA, n_capB, srcA, srcB) {
    if (!e || !t) return 0;
    /* The editorial layer first: a banned pair is out whatever its colours. */
    const edTerm = editorialTerm(srcA, srcB, n_capA, n_capB);
    if (null === edTerm) return -10;
    let n = 0;
    for (let a = 0; a < 7; a++) n += e.histogram[a] * t.histogram[a];
    const a = e.histMag && t.histMag ? n / (e.histMag * t.histMag) : 0,
        o = (e, t) => {
            let n = 0;
            for (const a of e) {
                let e = 0;
                for (const n of t) {
                    const t = colorSimilarity(a, n);
                    t > e && (e = t)
                }
                n += e * a.weight
            }
            return n
        },
        i = 1 - (o(e.palette, t.palette) + o(t.palette, e.palette)) / 2;
    /* The palette-contrast floor exists to throw out pairs whose colours sit too
       close to hold any tension. It ran before the caption terms, so a pair the
       captions had a strong reason for — words that answer each other, the same
       object seen elsewhere — was discarded before that reason was ever
       considered. CLOSED against OPEN 7 DAYS sat at #3690 of 27,261 for exactly
       this reason.

       A caption reason above WORD_OVERRIDE now survives the floor. It still
       pays for the weak contrast, so it has to be a genuinely strong reason to
       come out ahead; ordinary pairs are rejected as before. */
    const capScore = captionScore(e, t, n_capA, n_capB);
    if (i < MIN_PALETTE_CONTRAST) return capScore >= WORD_OVERRIDE ? capScore - WEAK_CONTRAST_COST + edTerm : -10;
    const r = Math.pow(i, 2),
        s = Math.abs(e.density - t.density),
        l = Math.abs(e.meanL - t.meanL),
        c = 1 - Math.abs(e.avgSat - t.avgSat),
        d = dominantRepetition(e, t),
        h = Math.max(e.avgSat, t.avgSat),
        u = Math.max(0, 1 - h / .3),
        m = Math.min(e.density, t.density),
        g = Math.max(0, (m - .55) / (1 - .55)),
        p = Math.max(e.density, t.density),
        f = Math.max(0, (.35 - p) / .35),
        y = e.isFallback || t.isFallback ? .4 : 0;
    const total = .05 * a + .38 * r + i * s * .28 + .17 * l + .05 * c + .08 * Math.min(1, Math.abs(e.edgeEnergy - t.edgeEnergy) / .25) + .08 * (Math.abs(e.vertical - t.vertical) / 2) + .05 * Math.max(0, 1 - Math.abs(e.cy - t.cy) / .25) - 1.1 * d - .5 * u - .45 * g - .3 * f - y + capScore + edTerm;
    /* Two clashes override everything else. A flat picture-plane beside a deep
       receding one, or an empty frame beside a crowded one, reads as two
       different kinds of picture however much the subjects agree — so the pair
       is capped rather than merely penalised. */
    const depthClash = n_capA && n_capB && ("flat" === n_capA.depth && "deep" === n_capB.depth || "deep" === n_capA.depth && "flat" === n_capB.depth),
        peopleClash = n_capA && n_capB && ("none" === n_capA.people && "many" === n_capB.people || "many" === n_capA.people && "none" === n_capB.people);
    return depthClash || peopleClash ? Math.min(total, CLASH_CAP * .8) : total
}

/* The exact number of distinct diptychs pickPair can reach: the top 500 of
   the score-sorted list, plus every item's five best partners. Same definition
   build-pool.mjs uses, but measured here from the live data, so it stays true
   for a catalogue the build never saw. Cheap — a walk over at most 500 + 5n
   entries, run once after scoring. */
function countReachablePairs() {
    if (!topPairs.length) return 0;
    const e = new Set;
    /* TOP_PAIRS_POOL, not a hardcoded 500. The opening pool was widened to 800
       and this was left behind, so whenever the runtime had to compute the
       figure itself it counted a pool narrower than the one it actually draws
       from — and reported a number far below the truth. */
    for (let t = 0, n = Math.min(TOP_PAIRS_POOL, topPairs.length); t < n; t++) e.add(topPairs[t].a + "|" + topPairs[t].b);
    for (const [, t] of bestsPerImage)
        for (const n of t) e.add(n.a + "|" + n.b);
    return e.size
}

/* What build-pool.mjs used to write into index.html, computed here from the
   live catalogue with the same scoring the site runs on.

     pairs    the top 500 photo-only pairs, best first ("7,31 108,148 ...")
     bests    each photo's five best photo partners, best first
     aspects  each photo's width / height, to three places
     fav      FAVORITE_IMAGES
     count    the reachable total shown on the splash (countReachablePairs)
     n,items  every photo and clip in the catalogue

   Videos are left out of pairs and bests because the opening pair is always two
   photographs. Checked against the last build: same pairs in the same order,
   same five partners for all 216 photos. */
const POOL_PAIRS = 500;

function buildPoolData() {
    computeTopPairs();
    const e = e2 => srcToId(e2),
        t = e2 => !isVideo(e2),
        n = (a2, b2) => +a2 - +b2,
        a = topPairs.filter(e2 => t(e2.a) && t(e2.b)),
        o = [],
        i = {};
    for (let t2 = 0; t2 < a.length && o.length < POOL_PAIRS; t2++) o.push([e(a[t2].a), e(a[t2].b)].sort(n).join(","));
    for (const t2 of a) {
        if (t2.score <= MIN_SHOWN_SCORE) break;
        for (const [n2, a2] of [[t2.a, t2.b], [t2.b, t2.a]]) {
            const o2 = i[e(n2)] || (i[e(n2)] = []);
            o2.length < 5 && o2.push(e(a2))
        }
    }
    const r = {},
        s = {},
        /* Excluded frames leave the built page entirely: not in the item
           list, not preloaded, not counted on the splash. */
        _live = validImages.filter(e2 => !EXCLUDE_IMAGES.has(srcToId(e2))),
        l = _live.filter(t).map(e).sort(n),
        c = _live.filter(isVideo).map(e).sort((a2, b2) => +a2.slice(1) - +b2.slice(1));
    for (const e2 of l) {
        i[e2] && (r[e2] = i[e2].join(" "));
        const t2 = colorSignatures.get(numToSrc(e2));
        t2 && t2.aspect > 0 && (s[e2] = Math.round(1e3 * t2.aspect) / 1e3)
    }
    return {
        v: 2,
        pairs: o.join(" "),
        bests: r,
        aspects: s,
        fav: [...FAVORITE_IMAGES].filter(e2 => "v" !== e2[0]).map(Number),
        count: countReachablePairs(),
        n: l.length + c.length,
        items: l.concat(c).join(" ")
    }
}

/* Run in the browser console on the live site, once the first pair is up:

     __buildPool()

   Downloads index.html with the pool rebuilt — the live page with only the
   line between the BUILD:pool markers replaced. Upload it in place of the old
   one. Do this after adding photos, clips or captions: until then the site
   sees a catalogue the pool does not describe and scores every pair before the
   first one appears, on every visit. */
/* The page with the pool rebuilt: the live index.html with only the line
   between the BUILD:pool markers replaced, and the splash figures updated
   alongside. Used by __buildPool() and by __addPhoto(). */
async function buildIndexHtml() {
    const t = buildPoolData(),
        n = "/* BUILD:pool:START */window.__pool=" + JSON.stringify(t) + ";/* BUILD:pool:END */";
    let a = null;
    try {
        a = await (await fetch(location.pathname.replace(/[^/]*$/, "") + "index.html", { cache: "no-store" })).text()
    } catch {}
    const o = !!a && /\/\* BUILD:pool:START \*\/[\s\S]*?\/\* BUILD:pool:END \*\//.test(a),
        /* Captioned items missing from the pool: a file that failed to load in
           this session is dropped from it, so a network hiccup would quietly
           shrink the catalogue. Listed so it can be caught before upload. */
        _in = new Set(t.items.split(" ")),
        dropped = [...subjects.keys()].map(e2 => e2.replace(/^ff/, "")).filter(e2 => !_in.has(e2));
    return {
        ok: o,
        pool: t,
        dropped,
        html: o ? a.replace(/\/\* BUILD:pool:START \*\/[\s\S]*?\/\* BUILD:pool:END \*\//, () => n).replace(/(<span class="subtitle" data-count=")\d+/, "$1" + t.count).replace(/(<span class="loading">0 \/ )\d+/, "$1" + t.count) : n
    }
}

function downloadBlob(e, t) {
    const n = document.createElement("a");
    n.href = URL.createObjectURL(t), n.download = e, document.body.appendChild(n), n.click(), n.remove(), setTimeout(() => URL.revokeObjectURL(n.href), 5e3)
}

window.__buildPool = async function() {
    const e = [...colorSignatures].filter(([e2, t2]) => !isVideo(e2) && (!t2 || t2.isFallback)).map(([e2]) => srcToId(e2));
    e.length && console.warn("Diptych: no colour data yet for " + e.join(", ") + " — they will be missing from the pool. Wait for them, or add them to captions.json.");
    const { ok: t, pool: n, html: a, dropped: o } = await buildIndexHtml();
    o.length && console.warn("Diptych: left out of the pool because they didn't load in this session: " + o.join(", ") + ". Reload and run again if they should be there.");
    downloadBlob(t ? "index.html" : "pool.txt", new Blob([a], { type: t ? "text/html" : "text/plain" }));
    return (t ? "index.html downloaded" : "Could not read index.html — pool.txt downloaded; paste it over the BUILD:pool line") + ": " + n.n + " items, " + n.count.toLocaleString("en-GB") + " diptychs."
};

/* Adding a photograph, from the browser console:

     __addPhoto()

   Opens a panel over the site: choose a JPG, write the caption (or have Claude
   write it), and it downloads one zip with every file that changes — the
   image in all its sizes and formats, captions.json with the new entry, and
   index.html with the pool rebuilt to include it. The work is in
   tools/add-photo.js, loaded only when asked for. */
window.__addPhoto = function() {
    return import("./tools/add-photo.js?v=3").then(e => e.default({
        analyzeImage,
        buildIndexHtml,
        downloadBlob,
        knownKeys: () => [...subjects.keys()],
        /* Puts the new photo into this session's catalogue, so the rebuilt
           pool scores it against everything else. Nothing is uploaded. */
        addToCatalogue(e2, t2, n2) {
            const a2 = numToSrc(e2.replace(/^ff/, "")),
                o2 = normalizeSignature(t2),
                i2 = normalizeCaption(n2);
            o2 && (n2.colour && (o2.colour = String(n2.colour).trim().toLowerCase()), !1 === n2.loud && (o2.notLoud = !0), !0 === n2.mono && (o2.mono = !0), colorSignatures.set(a2, o2));
            i2 && subjects.set(e2, i2);
            validImages.includes(a2) || validImages.push(a2)
        }
    })).then(() => "Add-photo panel open.")
};
function computeTopPairs() {
    /* Whoever calls this, a queued run is now redundant: it would score the
       same data again. */
    topPairsPending && (cancelAnimationFrame(topPairsPending), topPairsPending = 0), topPairsLastRun = performance.now();
    if (validImages.length < 2) return topPairs = [], imageBests = [], void(bestsPerImage = new Map);
    const _st = performance.now();
    const e = validImages.filter(e => colorSignatures.has(e) && !EXCLUDE_IMAGES.has(srcToId(e))),
        t = [];
    for (let n = 0; n < e.length; n++)
        for (let a = n + 1; a < e.length; a++) t.push({
            a: e[n],
            b: e[a],
            score: pairScore(colorSignatures.get(e[n]), colorSignatures.get(e[a]), subjectFor(e[n]), subjectFor(e[a]), e[n], e[a])
        });
    t.sort((e, t) => t.score - e.score), topPairs = t;
    bestsPerImage = new Map;
    /* Every photograph is guaranteed partners so that none is unreachable, but
       the guarantee was filling those slots with whatever scored highest for
       that frame — including pairs pairScore had rejected outright at -10.
       Twenty-four such pairs were in the shown set, and they pulled its mean
       score from .31 down to .08. Rejected means rejected: a frame with fewer
       than five viable partners simply gets fewer. */
    for (const e of t) {
        if (e.score <= MIN_SHOWN_SCORE) break;
        for (const t of [e.a, e.b]) {
            const n = colorSignatures.get(t);
            if (n && n.isFallback) continue;
            const a = bestsPerImage.get(t);
            a ? a.length < 5 && a.push(e) : bestsPerImage.set(t, [e])
        }
    }
    const n = new Set,
        a = [];
    for (const o of t)
        if (n.has(o.a) && n.has(o.b) || (a.push(o), n.add(o.a), n.add(o.b)), n.size >= e.length) break;
    /* Pairs that are each other's first choice out of the whole catalogue —
       the one thing about a diptych no eye could arrive at, since it depends
       on every photograph the visitor has not been shown. Keyed both ways
       round so either order finds it. */
    mutualBests = new Set;
    for (const [e2, t2] of bestsPerImage) {
        const n2 = t2[0] && (t2[0].a === e2 ? t2[0].b : t2[0].a);
        if (!n2) continue;
        const a2 = bestsPerImage.get(n2),
            o2 = a2 && a2[0] && (a2[0].a === n2 ? a2[0].b : a2[0].a);
        o2 === e2 && mutualBests.add(e2 + "|" + n2)
    }
    imageBests = a, window.__topPairs = topPairs, window.__score = (e2, t2) => {
        const n2 = numToSrc(String(e2).replace(/^ff/, "")),
            a2 = numToSrc(String(t2).replace(/^ff/, ""));
        return pairScore(colorSignatures.get(n2), colorSignatures.get(a2), subjectFor(n2), subjectFor(a2), n2, a2)
    }, window.__imageBests = imageBests, window.__bestsPerImage = bestsPerImage, window.__colorSignatures = colorSignatures, window.__pairScore = pairScore;
    bootMark("scored"), DEBUG && console.log("Diptych: scored " + t.length + " pairs in " + Math.round(performance.now() - _st) + "ms")
}
const TOP_PAIRS_MIN_INTERVAL_MS = 350;
let topPairsPending = 0,
    topPairsLastRun = 0,
    /* True while the opening pair is loading with scoring deferred. Scoring
       every pair blocks the main thread, and when the opening pair is already
       known nothing needs it until the pair after — so queued runs wait for
       the first swap instead of landing in front of it. */
    bootHold = !1;

function scheduleTopPairs(u) {
    if (topPairsPending) return;
    const e = () => {
        const t = u ? 350 : Math.max(350, colorSignatures.size * colorSignatures.size / 10);
        bootHold || performance.now() - topPairsLastRun < t ? topPairsPending = requestAnimationFrame(e) : (topPairsPending = 0, topPairsLastRun = performance.now(), computeTopPairs())
    };
    topPairsPending = requestAnimationFrame(e)
}

function pairToHash(e) {
    return "#" + e.map(srcToId).join(",")
}

function staleness(e) {
    const t = lastShown.get(e);
    return void 0 === t ? clickCount + 1e3 : clickCount - t
}

function isRecent(e) {
    const t = recent.get(e);
    /* The window was written as a literal here, so RECENT_CLICKS_BLOCK above
       had no effect on it. Both now read the same constant.

       clickCount - t is guarded against going negative: the rotation cache
       restores `recent` and `clickCount` together, but a cache written by an
       older build, or one hand-edited, could leave timestamps ahead of the
       counter — which would mark an image recent forever. */
    if (void 0 === t) return !1;
    const n = clickCount - t;
    return n >= 0 && n < RECENT_CLICKS_BLOCK
}

function markPairRecent(e) {
    for (const t of e) {
        recent.set(t, clickCount);
        const e = SIBLINGS.get(t);
        if (e)
            for (const t of e) recent.set(t, clickCount)
    }
}

function weightedPick(e, t) {
    let n = 0;
    const a = new Array(e.length);
    for (let o = 0; o < e.length; o++) a[o] = Math.max(0, t(e[o])), n += a[o];
    if (0 === n) return e[Math.floor(Math.random() * e.length)];
    let o = Math.random() * n;
    for (let t = 0; t < e.length; t++)
        if (o -= a[t], o <= 0) return e[t];
    return e[e.length - 1]
}
const VIDEO_RATE_EARLY = .6,
    VIDEO_EARLY_CLICKS = 10;

function videoRateNow() {
    return clickCount < VIDEO_EARLY_CLICKS ? VIDEO_RATE_EARLY : VIDEO_RATE
}

function pickPair(e, t) {
    0 === topPairs.length && computeTopPairs();
    const n = !t || !1 !== t.allowVideos;
    if (0 === topPairs.length) {
        const t = (n ? e : e.filter(e => !isVideo(e))).filter(e => !EXCLUDE_IMAGES.has(srcToId(e))),
            a = t.length ? t : e,
            o = Math.floor(Math.random() * a.length);
        let i = Math.floor(Math.random() * a.length);
        for (; i === o && a.length > 1;) i = Math.floor(Math.random() * a.length);
        return [a[o], a[i]]
    }
    if (Math.random() < .5 && bestsPerImage.size > 0) {
        const e = [];
        for (const [t, a] of bestsPerImage) {
            if (isRecent(t)) continue;
            if (!n && isVideo(t)) continue;
            const o = a.find(e => !isRecent(e.a) && !isRecent(e.b) && (n || !isVideo(e.a) && !isVideo(e.b)));
            o && e.push({
                src: t,
                pair: o
            })
        }
        if (e.length > 0) {
            const t = n && e.some(e => isVideo(e.pair.a) || isVideo(e.pair.b)) && clicksSinceVideo >= 1 && Math.random() < videoRateNow() ? e.filter(e => isVideo(e.pair.a) || isVideo(e.pair.b)) : e.filter(e => !isVideo(e.pair.a) && !isVideo(e.pair.b)),
                a = weightedPick(t.length > 0 ? t : e, e => {
                    const t = staleness(e.src),
                        n = srcToId(e.src);
                    return n && FAVORITE_IMAGES.has(n) ? 2.5 * t : t
                }).pair,
                o = isVideo(a.a) || isVideo(a.b);
            return clicksSinceVideo = o ? 0 : clicksSinceVideo + 1, Math.random() < .5 ? [a.a, a.b] : [a.b, a.a]
        }
    }
    let a = topPairs.filter(e => !isRecent(e.a) && !isRecent(e.b));
    n || (a = a.filter(e => !isVideo(e.a) && !isVideo(e.b)));
    const o = n ? topPairs : topPairs.filter(e => !isVideo(e.a) && !isVideo(e.b)),
        i = a.length > 0 ? a : o.length > 0 ? o : topPairs,
        r = n && i.some(e => isVideo(e.a) || isVideo(e.b)) && clicksSinceVideo >= 1 && Math.random() < videoRateNow() ? i.filter(e => isVideo(e.a) || isVideo(e.b)) : i.filter(e => !isVideo(e.a) && !isVideo(e.b)),
        s = r.length > 0 ? r : i,
        l = Math.min(500, s.length),
        c = s[Math.floor(Math.random() ** 1.2 * l)],
        d = isVideo(c.a) || isVideo(c.b);
    return clicksSinceVideo = d ? 0 : clicksSinceVideo + 1, Math.random() < .5 ? [c.a, c.b] : [c.b, c.a]
}

function preparePanel(e, t, n) {
    const a = !n || !1 !== n.autoplay,
        o = e.querySelectorAll(".layer"),
        i = e.querySelector(".layer.loaded"),
        r = i === o[0] ? o[1] : o[0];
    /* Take the back layer to zero opacity INSTANTLY before writing anything
       into it.

       Every previous attempt at the blip was about ordering — wait for the
       fade, wait for the prep — and each one narrowed the window without
       closing it. The window exists because a layer that has just lost .loaded
       is still animating 1 -> 0 for the length of the fade-out, and anything
       painted into it during that animation is visible on the way down. That is
       the pair two clicks away.

       Killing the transition and forcing opacity 0, then flushing layout, means
       the layer is already invisible at the moment its src changes. There is no
       window left for a new image to be seen in. The inline styles are cleared
       again in loadDiptych, just before .loaded goes back on. */
    r.style.transition = "none", r.classList.remove("loaded"), r.style.opacity = "0", r.offsetHeight;
    /* If anything below throws, this layer must not be left hidden. */
    const _restore = () => {
        r.style.transition = "", r.style.opacity = ""
    };
    if (r.dataset.src = t, isVideo(t)) {
        /* Always build a fresh <video>. Reusing the previous element and only
           changing src is the same Safari trap as mutating <picture>: the
           element keeps the old frame (or no frame) and the why panel / hash
           move on without it.

           Do not play() while this layer is still opacity 0. Safari will
           accept the call, paint one frame, then stall — which is why a
           shared #v22,125 pair shows a still photograph of the clip. Playback
           starts in startVisibleVideos() after .loaded is applied. */
        r.innerHTML = a
            ? '<video muted autoplay loop playsinline webkit-playsinline preload="auto"></video>'
            : '<video muted loop playsinline webkit-playsinline preload="auto"></video>';
        const e = r.querySelector("video");
        e.muted = !0;
        e.playsInline = !0;
        e.setAttribute("playsinline", "");
        e.setAttribute("webkit-playsinline", "");
        e.setAttribute("poster", videoPosterUrl(t));
        return new Promise(n => {
            let o = !1;
            const s = () => {
                    if (o) return;
                    o = !0, clearTimeout(l);
                    const c = e.readyState >= 2;
                    c || _restore(), n({
                        back: r,
                        active: i,
                        ok: c
                    })
                },
                l = setTimeout(() => {
                    o || console.warn("Diptych: video load timeout", t), s()
                }, 8e3);
            e.addEventListener("loadeddata", s, { once: !0 });
            e.addEventListener("error", s, { once: !0 });
            e.src = t;
            e.load();
        })
    }
    /* Build a fresh <picture> for every frame instead of reusing the one that
       is already there.

       Safari resolves a <picture> once and does not re-run the selection when
       srcset is changed on the existing <source> and <img>. So the code set the
       new srcset, the img kept the picture it had already chosen, and
       naturalWidth still reported a perfectly good image — the previous one.
       Everything downstream then agreed the swap had happened: the log said
       ready, the address bar advanced, the why panel followed. Only the
       photographs stayed where they were.

       Chromium re-resolves on mutation, which is why Brave was fine and Safari
       stuck. A new element has nothing cached to keep. */
    {
        const e = r.querySelector("video");
        if (e) try {
            e.pause(), e.removeAttribute("src"), e.load()
        } catch {}
    }
    /* A plain <img srcset>, not a <picture>.

       <picture> is what Safari would not re-resolve, and the self-check added in
       v144 was quietly repairing every single swap by hand — which is why it
       became slow and why a frame lingered into the next pair. An <img> chooses
       from its own srcset with no <source> elements involved, and a fresh one
       has nothing to re-resolve. Format is decided here instead of by the
       browser: AVIF when the probe says it is supported and nothing has failed
       to decode yet, JPEG otherwise. */
    r.innerHTML = '<img alt="" sizes="50vw">';
    const l = srcToNum(t),
        d = r.querySelector("img"),
        c = {};
    {
        const _s = colorSignatures.get(t),
            _r = _s && _s.aspect > 0 ? _s.aspect : .8,
            /* 75, not 100: the stylesheet caps an image at --image-height (75dvh),
               so that is the tallest it can render and therefore what should drive
               the srcset choice. Change both together or the browser fetches a
               larger rung than it can use. */
            _z = "min(50vw, " + (IMAGE_VH * _r).toFixed(1) + "vh)";
        d.setAttribute("fetchpriority", a ? "high" : "low"), d.sizes = _z, c.sizes = _z, d.width = 1e3, d.height = Math.round(1e3 / _r), d.onerror = () => {
            const _i = validImages.indexOf(t);
            _i >= 0 && (validImages.splice(_i, 1), scheduleTopPairs(!0))
        }
    }
    const _fmt = AVIF_OK && FORMATS.includes("avif") ? "avif" : "jpg";
    if (IS_SAFARI && SIZES.length) {
        /* The width index.html already preloaded for this frame, if it did —
           used as-is so the preload is the download, whatever the viewport has
           done since. Otherwise the same calculation, fresh. */
        const _sg = colorSignatures.get(t),
            _pr = window.__preloadRung && window.__preloadRung[l];
        _pr && delete window.__preloadRung[l];
        d.removeAttribute("srcset"), d.src = path(l, "jpg", _pr || safariRung(_sg && _sg.aspect)), d.alt = altFor(l)
    } else d.srcset = SIZES.length ? srcset(l, _fmt) : "", d.src = path(l, _fmt), d.alt = altFor(l);
    {
        const e = colorSignatures.get(t),
            n = e && e.aspect > 0 ? e.aspect : .8;
        d.width = 1e3, d.height = Math.round(1e3 / n)
    }
    const _ready = () => d.complete && d.naturalWidth > 0;
    /* Safari often never settles HTMLImageElement.decode() on a newly created
       <img>, even when load has fired and naturalWidth is already set. Racing
       only decode() against 5s made every Safari swap wait the full timeout.
       Wait for load OR decode OR a short cap, then inspect naturalWidth. */
    const waitDecoded = (img, ms) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve(true);
        return new Promise(resolve => {
            let done = false;
            const finish = ok => { if (!done) { done = true; resolve(!!ok); } };
            img.addEventListener("load", () => finish(img.naturalWidth > 0), { once: true });
            img.addEventListener("error", () => finish(false), { once: true });
            if (typeof img.decode === "function") img.decode().then(() => finish(img.naturalWidth > 0)).catch(() => {});
            setTimeout(() => finish(img.complete && img.naturalWidth > 0), ms);
        });
    };
    const decodeMs = IS_SAFARI ? 1200 : IMAGE_DECODE_TIMEOUT_MS;
    return waitDecoded(d, decodeMs).then(ok => {
        if (ok || _ready()) return {
            back: r,
            active: i,
            ok: !0
        };
        /* Drop AVIF for the rest of the session and try this frame again as
           JPEG. Safari can accept an AVIF source, fail to decode it, and never
           fall back on its own — the <picture> element only reties on a load
           error, not on a decode that produces nothing. */
        if (AVIF_OK) {
            AVIF_OK = !1, console.warn("Diptych: AVIF failed to decode; falling back to JPEG for this session.");
        }
        /* Safari is already on its single JPEG: wait on it again rather than
           handing it a srcset, which would start a different download. */
        return IS_SAFARI && SIZES.length || (d.srcset = SIZES.length ? srcset(l, "jpg") : "", d.src = path(l, "jpg")), waitDecoded(d, decodeMs).then(() => {
            const e = _ready();
            return {
                back: r,
                active: i,
                ok: e
            }
        })
    })
}
/* Only one load may be in flight.

   loadDiptych is called from several places — the opening pair, a shared hash,
   an interlude's 800ms preload timer, the click handler — and it awaits a
   decode in the middle. Two calls could therefore overlap: both wrote into the
   same layers, and whichever finished LAST painted while the other had already
   written its own pair into the address bar and into currentPairSrcs. On a fast
   machine the decodes finished in call order and it never showed; in Safari
   they did not, which is why the URL, the why panel and the pictures were three
   different answers.

   Each call takes a ticket. After every await it checks whether a later call
   has started, and if so it abandons quietly — no swap, no address, nothing. */
let loadTicket = 0,
    loadPromise = null;

/* Join the load already in flight rather than starting another.

   The interlude's preload timer calls loadDiptych() with no argument, which
   picks a fresh pair. If the opening load was still decoding, the ticket above
   made it abandon — correctly, it had been superseded — but that meant the pair
   on screen was the preload's while currentPairSrcs had never been set at all,
   so the why panel fell back to reading the address bar and described something
   else. The first pair you see is exactly when this shows. */
function teardownVideo(v) {
    if (!v) return;
    try {
        v.pause();
        v.removeAttribute("autoplay");
        v.removeAttribute("src");
        v.removeAttribute("poster");
        while (v.firstChild) v.removeChild(v.firstChild);
        v.load();
    } catch {}
    try { v.remove(); } catch {}
}

function teardownLayerVideos(layer) {
    if (!layer) return;
    layer.querySelectorAll("video").forEach(teardownVideo);
}

function startVisibleVideos() {
    /* Only the loaded layer may play. Any other video in the panel is a
       leftover Safari compositor overlay — kill it rather than pause it. */
    document.querySelectorAll(".panel").forEach(panel => {
        panel.querySelectorAll(".layer:not(.loaded) video").forEach(teardownVideo);
    });
    const wanted = (currentPairSrcs || []).map(srcToId);
    document.querySelectorAll(".panel .layer.loaded video").forEach(v => {
        const id = srcToId(v.currentSrc || v.src || "");
        if (wanted.length && id && wanted.indexOf(id) < 0) {
            teardownVideo(v);
            return;
        }
        v.muted = !0;
        v.playsInline = !0;
        v.setAttribute("playsinline", "");
        v.setAttribute("webkit-playsinline", "");
        if (!v.hasAttribute("autoplay")) v.setAttribute("autoplay", "");
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
    });
}

/* ?debug only. For each swap: how long from the request to the pair being on
   screen, whether it had been prepared in the background, and every file
   fetched for each frame. Two widths listed for one frame means it was
   downloaded twice. */
function debugLoadReport(e, t, n) {
    const a = {};
    try {
        for (const e of performance.getEntriesByType("resource")) {
            const t = e.name.match(/images\/(jpg|avif|webp)\/ff(\d+)-(\d+)\./);
            t && "256" !== t[3] && (a[t[2]] = a[t[2]] || []).push(t[3] + "." + t[1] + " " + Math.round(e.duration) + "ms")
        }
    } catch {}
    const o = e.filter(e => !isVideo(e)).map(srcToNum);
    1 === loadTicket && (bootMark("on screen"), console.log("Diptych startup, ms after navigation: " + Object.entries(BOOT_T).map(([e, t]) => e + " " + t).join(" → ") + (BOOT_T.scored ? "" : "  (scoring deferred until after the first pair)")));
    console.log("Diptych timing: " + Math.round(performance.now() - t) + "ms " + (n ? "(prepared in background)" : "(loaded on demand)") + (1 === loadTicket ? ", first pair at " + Math.round(performance.now()) + "ms after navigation" : "") + " | " + o.map(e => "ff" + e + ": " + (a[e] ? a[e].join(", ") : "from cache")).join(" | ") + (o.some(e => a[e] && a[e].length > 1) ? "  <- DOWNLOADED TWICE" : ""))
}

function loadDiptychOnce() {
    return loadPromise || loadDiptych()
}
async function loadDiptych(e) {
    if (validImages.length < 2) return;
    const _ticket = ++loadTicket,
        _t0 = performance.now();
    let t, n;
    /* Let any prep in flight finish before touching the layers. Both write to
       the same back layer, and whichever finished last used to win — which is
       how the pair after next ended up on screen for a moment. Waiting costs
       nothing the visitor can perceive: the prep is a decode that is already
       most of the way done. */
    if (prepPromise) try {
        await prepPromise
    } catch {}
    if (_ticket !== loadTicket) return;
    prepInflightId++;
    const a = !e && preparedNext;
    a ? (t = preparedNext.pair, n = preparedNext.sides, preparedNext = null) : (t = e || pickPair(validImages), preparedNext = null), a ? n.forEach(({
        back: e
    }) => {
        const vid = e.querySelector("video");
        if (vid) vid.setAttribute("autoplay", "");
    }) : n = await Promise.all([preparePanel(document.querySelector(".panel.left"), t[0]), preparePanel(document.querySelector(".panel.right"), t[1])]).catch(e2 => {
        /* A panel failed to load. Put every layer back to a state the visitor
           can see and act on — never leave one hidden with the click dead —
           then give up on this pair rather than on the session. */
        document.querySelectorAll(".panel .layer").forEach(e3 => {
            e3.style.transition = "", e3.style.opacity = ""
        });
        const e4 = document.querySelector(".panel.left .layer.loaded"),
            t2 = document.querySelector(".panel.right .layer.loaded");
        return e4 && t2 ? null : (document.querySelectorAll(".panel").forEach(e5 => {
            const t3 = e5.querySelector(".layer");
            t3 && t3.classList.add("loaded")
        }), null)
    }), _ticket === loadTicket && requestAnimationFrame(() => {
        /* The opening pair is being painted in this frame; deferred scoring
           can run from the next one. */
        bootHold = !1;
        /* A later call may have started while this one was decoding. */
        if (_ticket !== loadTicket) return;
        /* n is null when a panel failed to load and the catch above cleaned up.
           Nothing to swap; the visitor keeps the pair they had and the next
           click tries a different one. */
        if (!n) return void scheduleNextPairPrep();
        /* No readiness gate. A frame that has not finished decoding paints a
           moment late; a refused swap does not paint at all, and leaves the
           address bar and the why panel describing a pair that never arrived.
           The first is a blink, the second is a broken site. */
        /* The two panels must change together.

           This loop used to do everything per side: restore the transition,
           force a reflow, then add .loaded — which meant the left panel was
           already marked loaded when the right panel's reflow forced layout.
           Safari takes that as licence to paint, so the left frame appeared
           alone, then the right arrived a beat later. Chromium happened to
           coalesce the two and hid the fault.

           Three passes now: restore every layer's transition, force ONE reflow
           for all of them, then flip them all in the same frame. No layout is
           forced between the two .loaded calls, so there is nothing to paint
           in between. */
        n.forEach(({
            back: e
        }) => {
            e.style.transition = ""
        }), n[0] && n[0].back.offsetHeight, n.forEach(({
            back: e,
            active: t
        }) => {
            if (e.style.opacity = "", e.classList.add("loaded"), t && t !== e) {
                t.classList.remove("loaded");
                /* Safari keeps a playing <video> as its own compositor layer
                   and ignores the parent opacity, so pause() leaves the clip
                   stuck on top of the next pair. Remove the element. */
                teardownLayerVideos(t);
            }
        }),
        /* Verify, then correct.

           Twice now a fix has been shipped on a theory about why Safari shows
           the wrong frame, and twice the theory was wrong. So instead of a third
           theory: after the swap, ask each visible <img> what it is actually
           displaying. If that does not match the pair we just claimed to show,
           rewrite that layer from scratch with a plain <img> and no <picture>
           at all — nothing to resolve, nothing to cache, nothing to get wrong.

           The check costs one property read per panel and is silent when it
           passes. When it fires with ?debug on it says exactly what was on
           screen versus what should have been. */
        (() => {
            const e2 = document.querySelectorAll(".panel");
            for (let a2 = 0; a2 < e2.length && a2 < t.length; a2++) {
                const o2 = e2[a2].querySelector(".layer.loaded");
                if (!o2) continue;
                const want = t[a2];
                if (isVideo(want)) {
                    const vid = o2.querySelector("video");
                    const got = vid && (vid.currentSrc || vid.src || "");
                    if (vid && srcToId(got) === srcToId(want)) continue;
                    DEBUG && console.warn("Diptych: panel", a2, "missing video", want, "— rewriting");
                    o2.innerHTML = '<video muted autoplay loop playsinline webkit-playsinline preload="auto" poster="' + videoPosterUrl(want) + '"></video>';
                    const nv = o2.querySelector("video");
                    nv.muted = !0;
                    nv.playsInline = !0;
                    nv.setAttribute("playsinline", "");
                    nv.setAttribute("webkit-playsinline", "");
                    nv.src = want;
                    nv.load();
                    continue;
                }
                const stray = o2.querySelector("video");
                if (stray) teardownVideo(stray);
                const i2 = o2.querySelector("img");
                const r2 = srcToNum(want),
                    s2 = i2 ? srcToNum(i2.currentSrc || i2.src || "") : null;
                if (i2 && s2 === r2) continue;
                DEBUG && console.warn("Diptych: panel", a2, "showed", s2 || "video", "but should show ff" + r2, "— rewriting");
                const l2 = document.createElement("img");
                l2.alt = altFor(r2), l2.sizes = "50vw", l2.srcset = SIZES.length ? srcset(r2, "jpg") : "", l2.src = path(r2, "jpg"), o2.innerHTML = "", o2.appendChild(l2)
            }
        })(), currentPairSrcs = t, splashFinish(), startVisibleVideos(), DEBUG && console.log("swap", pairToHash(t), "ready:", n.map(e2 => e2 && e2.ok), "avif:", AVIF_OK, "showing:", [...document.querySelectorAll(".panel .layer.loaded img, .panel .layer.loaded video")].map(e2 => srcToId(e2.currentSrc || e2.src || "") || "?")), DEBUG && debugLoadReport(t, _t0, !!a), history.replaceState(null, "", pairToHash(t)), lastSwapAt = performance.now(), markPairRecent(t), lastShown.set(t[0], clickCount), lastShown.set(t[1], clickCount),
        /* Only now: the layers have flipped, so the back layer really is the
           one going off screen. See scheduleNextPairPrep. */
        scheduleNextPairPrep()
    }), window.gaEnabled && "undefined" != typeof gtag && gtag("event", "diptych_view", {
        left: t[0],
        right: t[1]
    }), prewarmLikelyVideos()
}

/* When the pair swaps, the layer that was showing the old pair loses .loaded
   and fades out over --fade-out-duration. prepareNextPair writes the pair after
   next into whichever layer is not currently loaded — which is that same layer,
   still on screen and still fading.

   requestIdleCallback could fire within a frame or two of the swap, so the
   outgoing image was being replaced mid-fade and the visitor saw, for a moment,
   the pair two clicks away. Waiting out the fade before repurposing the layer
   is the whole fix. */
/* Safari/WebKit decodes AVIF through the OS image stack. It is slower than
   Chromium, can accept a source then produce an empty frame, and HTMLImageElement
   decode() on those frames sometimes never settles. Default to JPEG on Apple
   WebKit so the first pair appears immediately; Chromium keeps AVIF. */
const IS_SAFARI = (() => {
    const ua = navigator.userAgent || "";
    const v = navigator.vendor || "";
    if (v === "Apple Computer, Inc.") return true;
    return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/i.test(ua);
})();
let AVIF_OK = !IS_SAFARI;

/* Safari gets one explicit JPEG width, not a srcset.

   index.html preloads the opening pair on Safari as a single file, and Safari
   used to be handed a 600/1000/1500 srcset here and left to choose. The
   preload was always the 1000, but on a Retina screen a frame usually needs a
   little over 1000px, so Safari took the 1500 — and the opening pair was
   downloaded twice, once as the unused preload and once for real.

   Now both sides make the choice with this same function, the way a browser
   reads a srcset: the smallest width that covers the frame's rendered size at
   the screen's pixel density, or the largest there is. The frame renders at
   min(50vw, 75dvh x aspect) — see --image-height — and innerWidth/innerHeight
   are that viewport. Keep in step with rungFor() in index.html. */
function safariRung(e) {
    const t = Math.min(.5 * window.innerWidth, window.innerHeight * IMAGE_VH / 100 * (e > 0 ? e : .8)) * (window.devicePixelRatio || 1);
    for (const n of SIZES)
        if (n >= t) return n;
    return SIZES[SIZES.length - 1]
}
/* random.thisisfed.xyz/?debug — logs each swap: the pair, whether each frame
   decoded, and which formats are in play. */
const DEBUG = /[?&]debug\b/.test(location.search);
const LAYER_FADE_OUT_MS = 200,
    PREP_GUARD_MS = LAYER_FADE_OUT_MS + 250;
let lastSwapAt = 0;

/* Called from inside the swap, after the layers have flipped.

   It used to be called straight after the swap was requested — before the
   frame in which it happens. Chromium defers the work with
   requestIdleCallback, which by luck always landed after that frame. Safari
   has no requestIdleCallback, so the prep ran synchronously, still before the
   swap: the "back" layer it chose was the very layer about to be revealed, and
   it wrote the pair after next into it. The self-check then caught the wrong
   frame on screen and rebuilt it from scratch — on every swap, which is the
   "showed 14 but should show ff125" in the log, a second download of each
   image, and a video restarted from nothing.

   Without requestIdleCallback the fallback is now a timer, never a direct
   call, so it can never run inside the swap either. */
function scheduleNextPairPrep() {
    const e = Math.max(0, PREP_GUARD_MS - (performance.now() - lastSwapAt)),
        t = () => "function" == typeof requestIdleCallback ? requestIdleCallback(() => prepareNextPair(), {
            timeout: 500
        }) : setTimeout(prepareNextPair, 0);
    e > 0 ? setTimeout(t, e) : t()
}
/* The prep and a click both write images into the same back layer, and until
   now nothing stopped them doing it at the same time.

   prepInflightId guarded only the assignment of preparedNext, not the DOM
   writes underneath it. So: prep starts on the pair after next, the visitor
   clicks before it settles, loadDiptych finds preparedNext still null and calls
   preparePanel on that same layer for a fresh pair — and the two racing writes
   finish in whatever order they finish in. When the prep won, the layer was
   showing the pair after next at the moment .loaded went on it. That is the
   picture from a few clicks away.

   prepPromise makes the two take turns: loadDiptych waits for any prep in
   flight before writing to the layer itself. */
let prepPromise = null;

function prepareNextPair() {
    if (validImages.length < 2 || preparedNext || prepPromise) return prepPromise;
    const e = prepInflightId;
    let t;
    try {
        t = pickPair(validImages)
    } catch {
        return null
    }
    if (!t || !t[0] || !t[1]) return null;
    return prepPromise = Promise.all([preparePanel(document.querySelector(".panel.left"), t[0], {
        autoplay: !1
    }), preparePanel(document.querySelector(".panel.right"), t[1], {
        autoplay: !1
    })]).then(n => {
        e === prepInflightId && (preparedNext = {
            pair: t,
            sides: n
        })
    }).catch(() => {}).finally(() => {
        prepPromise = null
    })
}
const prewarmedVideos = new Map;

function warmVideoElement(e) {
    if (prewarmedVideos.has(e)) return prewarmedVideos.get(e);
    const t = document.createElement("video");
    t.muted = !0, t.playsInline = !0, t.preload = "auto", t.setAttribute("aria-hidden", "true"), t.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;", t.src = e, document.body.appendChild(t);
    try {
        t.load()
    } catch {}
    return prewarmedVideos.set(e, t), t
}
const PREWARM_BATCH = 3;

function prewarmLikelyVideos() {
    const e = validImages.filter(e => isVideo(e) && !prewarmedVideos.has(e));
    0 !== e.length && (e.sort((e, t) => (lastShown.has(e) ? lastShown.get(e) : -1 / 0) - (lastShown.has(t) ? lastShown.get(t) : -1 / 0)), e.slice(0, PREWARM_BATCH).forEach(warmVideoElement))
}

function deferVideoWarmup() {
    ("function" == typeof requestIdleCallback ? requestIdleCallback : e => setTimeout(e, 300))(() => primeInitialVideoWarmup(), {
        timeout: 1500
    })
}

function primeInitialVideoWarmup() {
    validImages.filter(isVideo).slice(0, PREWARM_INITIAL).forEach(warmVideoElement)
}
const PREWARM_INITIAL = IS_SAFARI ? 1 : 3;

function loadOne(e) {
    if (isVideo(e)) return loadVideoPosterForAnalysis(e).then(t => !!t || loadVideoForAnalysis(e));
    const t = srcToNum(e),
        n = [];
    n.push(256), SIZES.length && 256 !== SIZES[0] && n.push(SIZES[0]), n.length || n.push(null);
    const a = [];
    /* Safari's createImageBitmap(AVIF) is slow and has leaked/hung in WebKit
       versions. Analyse from JPEG thumbnails there; Chromium can keep AVIF. */
    const fmts = IS_SAFARI ? ["jpg", "avif"] : FORMATS;
    for (const e of n)
        for (const n of fmts) a.push(path(t, n, e));
    const o = t => {
        validImages.includes(e) || validImages.push(e);
        const n = analyzeImage(t);
        n && (colorSignatures.set(e, n), scheduleTopPairs())
    };

    function i() {
        return new Promise(t => {
            let n = 0;
            const i = () => {
                if (n >= a.length) return console.warn("Diptych: failed to load", e), void t(!1);
                const r = new Image;
                r.onload = () => {
                    o(r), t(!0)
                }, r.onerror = () => i(), r.src = a[n++]
            };
            i()
        })
    }
    return !IS_SAFARI && "function" == typeof createImageBitmap ? async function() {
        for (const e of a) try {
            const t = await fetch(e);
            if (!t.ok) continue;
            const n = await createImageBitmap(await t.blob());
            try {
                o(n)
            } finally {
                n.close && n.close()
            }
            return !0
        } catch {}
        return !1
    }().then(e => !!e || i()): i()
}

function fallbackSignature() {
    const e = new Array(7).fill(1 / 7);
    return {
        histogram: e,
        palette: [{
            hsl: {
                h: 0,
                s: 0,
                l: .5
            },
            oklab: {
                L: .6,
                a: 0,
                b: 0
            },
            weight: 1
        }],
        avgSat: .3,
        meanL: .5,
        density: histogramDensity(e),
        histMag: histogramMagnitude(e),
        edgeEnergy: .15,
        vertical: 0,
        cx: .5,
        cy: .5,
        aspect: 1,
        isFallback: !0
    }
}

function loadVideoPosterForAnalysis(e) {
    return new Promise(t => {
        const n = new Image;
        n.onload = () => {
            try {
                validImages.includes(e) || validImages.push(e);
                const a = analyzeImage(n);
                a ? (colorSignatures.set(e, a), scheduleTopPairs(!0), t(!0)) : t(!1)
            } catch {
                t(!1)
            }
        }, n.onerror = () => t(!1), n.src = videoPosterUrl(e)
    })
}

function loadVideoForAnalysis(e) {
    return new Promise(t => {
        const n = document.createElement("video");
        n.muted = !0, n.playsInline = !0, n.preload = "auto", n.setAttribute("aria-hidden", "true"), n.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;", document.body.appendChild(n);
        let a = !1;
        const o = o => {
                if (!a) {
                    a = !0, clearTimeout(r);
                    try {
                        n.pause()
                    } catch {}
                    n.removeAttribute("src"), n.load(), n.remove(), colorSignatures.has(e) || (validImages.includes(e) || validImages.push(e), colorSignatures.set(e, fallbackSignature()), scheduleTopPairs()), t(!0)
                }
            },
            i = () => {
                try {
                    validImages.includes(e) || validImages.push(e);
                    const t = analyzeImage(n);
                    t && (colorSignatures.set(e, t), scheduleTopPairs()), o()
                } catch {
                    o()
                }
            },
            r = setTimeout(() => {
                console.warn("Diptych: video analysis timeout, using fallback signature", e), o()
            }, 1e4);
        n.addEventListener("loadeddata", () => {
            n.duration && isFinite(n.duration) && n.duration > .5 ? (n.addEventListener("seeked", i, {
                once: !0
            }), n.currentTime = Math.min(.25 * n.duration, 1)) : i()
        }, {
            once: !0
        }), n.addEventListener("error", () => {
            console.warn("Diptych: failed to load video, using fallback signature", e), o()
        }, {
            once: !0
        }), n.src = e
    })
}
const INTERLUDES = ["contact", "share", "welcome"],
    /* The opening run, in order, with the number of pairs between each. Fixed
       rather than rolled, so everyone meets the same screens at the same
       moments: welcome at pair 2, instructions at pair 5 at the latest.
       Anything still unseen after that arrives at a random interval, as
       before. A returning visitor who has already had the welcome starts at
       the next queued entry, so the instructions arrive sooner, never later
       than the fifth pair. */
    INTERLUDE_SCHEDULE = [
        ["welcome", 2],
        ["share", 3]
    ];
let interludeQueue = [];
! function() {
    const e = ["thisisfed", "xyz"].join("."),
        t = "ciao" + String.fromCharCode(64) + e,
        n = document.getElementById("contact-email");
    n.setAttribute("href", "mailto:" + t), n.textContent = t
}();
const seenInterludes = new Set;

function pickInterlude() {
    const e = INTERLUDES.filter(e => !seenInterludes.has(e));
    if (0 === e.length) return null;
    if (interludeQueue.length) {
        const t = interludeQueue.shift()[0];
        if (e.includes(t)) return lastInterlude = t, t
    }
    const t = e.filter(e => e !== lastInterlude),
        n = (t.length ? t : e)[Math.floor(Math.random() * (t.length || e.length))];
    return lastInterlude = n, n
}

function showInterlude() {
    const e = pickInterlude();
    if (!e) return;
    seenInterludes.add(e), writeSeenInterludes(), currentInterlude = document.getElementById(e), currentInterlude.classList.add("visible"), currentInterlude.setAttribute("aria-hidden", "false"), document.documentElement.classList.add("has-interlude"), captureFocus(currentInterlude);
    let t = !1,
        n = null;
    interludePreload = new Promise(e => {
        const a = () => {
            t || (t = !0, null !== n && (clearTimeout(n), n = null), loadDiptychOnce().then(() => {
                requestAnimationFrame(() => requestAnimationFrame(e))
            }))
        };
        n = setTimeout(a, 800), interludeLoadTrigger = a
    }), window.gaEnabled && "undefined" != typeof gtag && gtag("event", "interlude_shown", {
        interlude: e
    })
}

function liftGate() {
    document.documentElement.classList.remove("gated")
}
let previouslyFocused = null;

function captureFocus(e) {
    previouslyFocused = document.activeElement;
    const t = e.querySelector(".inner") || e;
    t.hasAttribute("tabindex") || t.setAttribute("tabindex", "-1"), requestAnimationFrame(() => {
        try {
            t.focus({
                preventScroll: !0
            })
        } catch {}
    })
}

function restoreFocus() {
    const e = previouslyFocused;
    if (previouslyFocused = null, e && "function" == typeof e.focus && document.contains(e)) try {
        e.focus({
            preventScroll: !0
        })
    } catch {} else if (document.body) try {
        document.body.focus({
            preventScroll: !0
        })
    } catch {}
}

function hideInterlude() {
    currentInterlude && (currentInterlude.classList.remove("visible"), currentInterlude.setAttribute("aria-hidden", "true"), document.documentElement.classList.remove("has-interlude"), currentInterlude = null, restoreFocus())
}
async function backgroundLoadRest(e) {
    if (!e || 0 === e.length) return;
    let t = 0;
    await Promise.all(Array.from({
        length: 4
    }, () => (async () => {
        for (; t < e.length;) {
            const n = e[t++];
            if (!colorSignatures.has(n)) try {
                await loadOne(n)
            } catch {}
        }
    })()))
}
document.querySelectorAll(".interlude").forEach(e => {
    e.addEventListener("click", async t => {
        "consent" !== e.id && "why" !== e.id && (t.target.closest("a") || (interludeLoadTrigger && interludeLoadTrigger(), interludePreload && await Promise.race([interludePreload, new Promise(e => setTimeout(e, 1500))]), hideInterlude()))
    })
}), async function() {
    const e = document.getElementById("splash"),
        t = e.querySelector(".subtitle"),
        n = e.querySelector(".loading");
    let a = 1e3,
        o = null,
        i = !1,
        r = null;
    const splashShownAt = performance.now();
    /* Hold the title card for SPLASH_MIN_MS even when everything is already
       cached and the real work finishes in 80ms — otherwise a warm visit
       flashes the name and is gone before it can be read.

       `i` is set straight away, not after the wait: it stops the progress
       loop and marks the splash as spoken for, so nothing schedules a second
       hide. Only the visual dismissal is delayed. The diptych loads behind
       the splash in the meantime, which means the images get a two-second
       head start on decoding rather than the delay costing anything. */
    /* The splash counter: 0% to 100%, on every visit.

       Mostly for show. It climbs on a curve — most of the way in the first
       second, then slower and slower — and only runs the last stretch to 100%
       once the first pair is actually on screen behind the splash. So it never
       sits still, never reaches 100% early, and the splash lifts on a pair
       that is ready rather than on an empty page. */
    let pDone = !1,
        pStop = !1,
        pShown = 0,
        pLast = performance.now(),
        pFull;
    const pFullP = new Promise(e2 => pFull = e2),
        pFrame = t2 => {
            if (pStop) return;
            const a2 = (t2 - splashShownAt) / 1e3,
                /* 90% by about 1.2s, then creeping toward 99% but never there. */
                o2 = a2 < 1.2 ? 90 * (1 - Math.pow(1 - a2 / 1.2, 2)) : 90 + 9 * (1 - Math.exp(-(a2 - 1.2) / 3)),
                i2 = Math.min(.1, (t2 - pLast) / 1e3);
            pLast = t2;
            /* Once the pair is ready: along a full curve to 100% by 1.3s on a
               fast visit, so the figure lands as the splash lifts, or at a
               steady run from wherever it has got to on a slow one. */
            pShown = pDone ? a2 < 1.3 ? Math.max(pShown, 100 * (1 - Math.pow(1 - a2 / 1.3, 2))) : Math.min(100, pShown + 150 * i2) : Math.max(pShown, Math.min(o2, 99));
            n && (n.textContent = pCount(pShown));
            pDone && pShown >= 100 ? (pStop = !0, pFull()) : requestAnimationFrame(pFrame)
        };
    /* Shown as pairs, not percent, in place of the number in "1235 Random
       Diptychs": "0 / 1235" up to "1235 / 1235". The total is the subtitle's
       data-count, so a count recomputed during boot is picked up at once. */
    const pCount = e2 => {
        const t2 = parseInt(t && t.dataset.count, 10) || (window.__pool && window.__pool.count) || 0;
        return Math.floor(e2 / 100 * t2) + " / " + t2
    };
    n && (n.textContent = pCount(0)), requestAnimationFrame(pFrame);
    splashFinish = () => {
        pDone = !0, pStop && pFull()
    };
    /* Stops the counter for good — used when loading has failed and the line
       is about to say so. */
    const pHalt = () => {
        pStop = !0
    };
    const s = () => {
        if (i) return;
        i = !0, clearTimeout(r);
        /* If the first pair never arrives, do not hold the splash forever. */
        setTimeout(splashFinish, 6e3);
        Promise.all([pFullP, new Promise(e2 => setTimeout(e2, Math.max(0, SPLASH_MIN_MS - (performance.now() - splashShownAt))))]).then(() => {
            e.classList.add("hidden"), setTimeout(() => {
                e.remove(), splashHiddenResolve()
            }, 350)
        })
    };
    r = setTimeout(s, 3e4);
    let l, c, B = null;
    /* The catalogue comes from the build, not from probing the server.

       build-pool.mjs now writes the full id list into window.__pool.items. When
       it is there, use it: no HEAD requests, no walking past the last file
       until the 404s come back, nothing to wait for. Discovery still runs, but
       behind the first pair rather than in front of it, so a file uploaded
       since the last build is still picked up.

       This was two dozen 404s on every load with a warm signature cache — the
       ones filling the console — and Safari is slow to give up on them. */
    const _pi = window.__pool && "string" == typeof window.__pool.items ? window.__pool.items.split(" ").filter(Boolean) : null;
    if (_pi && _pi.length) {
        l = _pi.filter(e2 => "v" !== e2[0]).map(Number), c = _pi.filter(e2 => "v" === e2[0]).map(e2 => Number(e2.slice(1)));
        writeDiscoCache("ff_disco_images", l), writeDiscoCache("ff_disco_videos", c);
        setTimeout(() => {
            try {
                discoverWithCache("ff_disco_images", discoverImages, numToSrc, mergeNewImages), discoverWithCache("ff_disco_videos", discoverVideos, videoNumToSrc, mergeNewVideos)
            } catch {}
        }, 4e3)
    } else {
    B = document.documentElement.classList.contains("has-sig-cache") ? null : await loadBootstrap();
    if (B && B.images.length) l = B.images, c = Array.isArray(B.videos) ? B.videos : [], writeDiscoCache("ff_disco_images", l), writeDiscoCache("ff_disco_videos", c), discoRefresh("ff_disco_images", discoverImages, numToSrc, l, mergeNewImages), discoRefresh("ff_disco_videos", discoverVideos, videoNumToSrc, c, mergeNewVideos);
    else {
        const _d = await Promise.all([discoverWithCache("ff_disco_images", discoverImages, numToSrc, mergeNewImages), discoverWithCache("ff_disco_videos", discoverVideos, videoNumToSrc, mergeNewVideos)]);
        l = _d[0], c = _d[1]
    }
    }
    window.__discoImages = l, window.__discoVideos = c, bootMark("catalogue");
    /* Kicked off here, awaited just before computeTopPairs below, so the first
       scoring pass already has the captions. Bounded, so a missing or slow
       manifest delays the splash by at most CAPTIONS_MAX_WAIT_MS. */
    /* Hold queued scoring runs from here until the opening pair is on screen
       (see bootHold): captions.json landing asks for a rescore, and on a first
       visit it lands mid-boot, which put a full scoring pass back in front of
       the pair. Released below if this boot has to score to choose a pair, at
       the first swap otherwise, and never held longer than five seconds. */
    bootHold = !0, setTimeout(() => bootHold = !1, 5e3);
    const captionsReady = loadCaptionManifest();
    captionsReady.then(() => bootMark("captions"));
    const d = l.length + c.length;
    if (d < 2) return (pHalt(), t && (t.textContent = "No media could be loaded."), n && (n.textContent = "")), void clearTimeout(r);
    images = l.map(numToSrc).concat(c.map(videoNumToSrc));
    for (const e of c.map(videoNumToSrc)) validImages.includes(e) || validImages.push(e), colorSignatures.has(e) || colorSignatures.set(e, fallbackSignature());
    const h = readSignatureCache();
    if (B && B.sigs)
        for (const e in B.sigs) h[e] || (h[e] = B.sigs[e]);
    for (const e of l.map(numToSrc)) {
        const t = h[e];
        t && (colorSignatures.set(e, t), validImages.includes(e) || validImages.push(e))
    }
    for (const e of c.map(videoNumToSrc)) {
        const t = h[e];
        t && colorSignatures.set(e, t)
    }
    for (const e of c.map(videoNumToSrc)) {
        const t = colorSignatures.get(e);
        t && t.isFallback && loadVideoPosterForAnalysis(e)
    }
    /* build-pool.mjs writes the true reachable count into the subtitle at build
       time. Trust it while the catalogue it was built against still matches
       what we just discovered; otherwise the real figure is computed below,
       once scoring has run — no placeholder, no rule of thumb. */
    const P = window.__pool,
        countIsStale = !P || P.count <= 0 || P.n !== d;
    /* Worth knowing which of the two figures you are looking at, and why. */
    countIsStale && console.warn("Diptych: built count ignored — payload describes " + (P ? P.n : "?") + " items, found " + d + ". Re-run build-pool.mjs, or upload the missing media.");
    /* Honour the hash on a fresh arrival, ignore it on a reload.
       
       This used to ask performance.getEntriesByType("navigation") whether the
       page was reloaded, and Safari answers "reload" for a URL typed or pasted
       into a tab that already holds the same page — so a shared link opened in
       Safari had its pair thrown away and a random one shown instead.
       
       A session flag is the reliable test: if this tab has already shown a
       diptych, we are returning, so give a new pair. If it has not, the hash
       came from outside and names the pair someone meant to share. */
    let _returning = !1;
    try {
        _returning = "1" === sessionStorage.getItem("ff_session_open"), sessionStorage.setItem("ff_session_open", "1")
    } catch {}
    /* Always honour a pair named in the URL. A shared #v22,125 link has to
       open that pair even if this tab already ran a session — otherwise the
       hash, the why panel and the photographs disagree. A reload of a shared
       link should keep the shared pair, not throw it away. */
    const g = location.hash.match(/^#(v\d+|\d+),(v\d+|\d+)$/i);
    if (g && g[1] !== g[2]) {
        const e = [idToSrc(g[1]), idToSrc(g[2])];
        /* Only analyse a named frame whose signature is not already cached.
           This used to download and analyse both thumbnails every time — and
           since the address bar carries the current pair after the first
           click, that was every reload, in front of the first pair. A video
           with no usable poster went further and loaded the clip itself. */
        const _known = e2 => {
            const t2 = colorSignatures.get(e2);
            return !!t2 && !t2.isFallback
        };
        if (!(await Promise.all(e.map(e2 => _known(e2) || loadOne(e2)))).every(Boolean))
            for (const e of images) {
                if (validImages.length >= 2) break;
                validImages.includes(e) || await loadOne(e)
            }
        if (validImages.length < 2) return (pHalt(), t && (t.textContent = "No media could be loaded."), n && (n.textContent = "")), void clearTimeout(r);
        backgroundLoadRest(l.map(numToSrc).filter(e => !validImages.includes(e)));
        e.forEach(src => { if (src && !validImages.includes(src)) validImages.push(src); });
        const a = e[0] && e[1] && e[0] !== e[1] ? e : null;
        return bootMark("load"), s(), showFirstPairHint(a), liftGate(), deferVideoWarmup(), loadPromise = loadDiptych(a), loadPromise.finally(() => loadPromise = null), void(consentEl && consentEl.isConnected && showAnalytics())
    }
    /* A first visit has no signature cache, and used to download and analyse
       the first eight thumbnails before it could go on — while captions.json,
       which carries every signature, was arriving alongside. Wait for that one
       file instead; the thumbnails are only the fallback if it does not come. */
    Object.keys(h).length || await Promise.race([captionsReady, new Promise(e => setTimeout(e, CAPTIONS_MAX_WAIT_MS))]);
    o = l.map(numToSrc);
    const p = o.slice(0, 8),
        f = o.slice(8);
    let y = 0;
    p.forEach(e => {
        colorSignatures.has(e) ? y++ : loadOne(e).finally(() => {
            y++
        })
    });
    let w = 0,
        b = performance.now();
    if (await new Promise(e => {
            const t = () => {
                if (i) return void e();
                const a = performance.now(),
                    o = Math.min(.1, (a - b) / 1e3);
                b = a;
                const r = p.length || 1,
                    s = Math.min(r, y) / r * 100;
                s > w && (w = Math.min(s, w + 2e3 * o));
                w >= 100 ? e() : requestAnimationFrame(t)
            };
            requestAnimationFrame(t)
        }), validImages.length < 2) return (pHalt(), t && (t.textContent = "No media could be loaded."), n && (n.textContent = "")), void clearTimeout(r);
    bootMark("signatures"), s(), writeSignatureCache();
    const S = readRotationCache();
    if (S) {
        clickCount = S.clickCount;
        for (const [e, t] of S.recent) validImages.includes(e) && recent.set(e, t);
        for (const [e, t] of S.lastShown) validImages.includes(e) && lastShown.set(e, t)
    }
    for (const e of readSeenInterludes()) seenInterludes.add(e);
    interludeQueue = INTERLUDE_SCHEDULE.filter(([e]) => !seenInterludes.has(e));
    nextInterludeAt = interludeQueue.length ? interludeQueue[0][1] : rollNextInterlude();
    let E = null;
    {
        const e = readNextPair();
        if (e) {
            const t = numToSrc(e[0]),
                n = numToSrc(e[1]);
            validImages.includes(t) && validImages.includes(n) && colorSignatures.has(t) && colorSignatures.has(n) && (E = [t, n])
        }
    }
    /* Cold-visit opening pair chosen during HTML parse (see the OPENING-PAIR
       POOL block in index.html) and already preloading. Honouring it here is
       what turns that preload into a cache hit; picking anything else now
       would waste both downloads. Validated against the live catalogue first,
       so a stale pool — an image deleted since build-pool.mjs last ran —
       falls through to the normal selection instead of showing a gap. */
    if (!E && Array.isArray(window.__openingPair) && 2 === window.__openingPair.length) {
        const e = numToSrc(window.__openingPair[0]),
            t = numToSrc(window.__openingPair[1]);
        e !== t && validImages.includes(e) && validImages.includes(t) && colorSignatures.has(e) && colorSignatures.has(t) && (E = Math.random() < .5 ? [e, t] : [t, e])
    }
    /* Scoring off the critical path.

       Scoring rates every pair in the catalogue, and it used to run here, on
       every visit, in front of the opening pair — along with a wait of up to
       CAPTIONS_MAX_WAIT_MS for captions.json. But when the pair is already
       known (the one the last session prepared, or the one index.html drew and
       is already preloading) neither is needed to show it: only the pair after
       needs scores. So in that case both are skipped here, and scoring runs
       from the frame after the first swap. It is still done up front when the
       pair has to be chosen now, or when the built count is stale and the
       splash needs the real figure. */
    if (!E || countIsStale) {
        bootHold = !1;
        await Promise.race([captionsReady, new Promise(e => setTimeout(e, CAPTIONS_MAX_WAIT_MS))]);
        computeTopPairs();
        /* Scoring has run, so the true count is now available. This lands while
           the splash is still up, so a stale or missing pool costs nothing
           visible — the number simply arrives a few hundred milliseconds in
           rather than being in the HTML from the start. */
        if (countIsStale) {
            const e = countReachablePairs();
            e > 0 && (a = e, t && (t.dataset.count = e))
        }
    }
    if (!E && Math.random() < .5) {
        const e = [...FAVORITE_IMAGES].map(numToSrc).filter(e => validImages.includes(e) && !isVideo(e) && colorSignatures.has(e));
        if (e.length > 0 && bestsPerImage.size > 0) {
            for (let t = e.length - 1; t > 0; t--) {
                const n = Math.floor(Math.random() * (t + 1));
                [e[t], e[n]] = [e[n], e[t]]
            }
            for (const t of e) {
                const e = bestsPerImage.get(t);
                if (!e) continue;
                const n = e.filter(e => !isVideo(e.a) && !isVideo(e.b));
                if (0 === n.length) continue;
                const a = n[Math.floor(Math.random() * n.length)],
                    o = a.a === t ? a.b : a.a;
                E = Math.random() < .5 ? [t, o] : [o, t];
                break
            }
        }
    }
    E || (E = pickPair(validImages, {
        allowVideos: !1
    })), bootMark("load"), showFirstPairHint(E), liftGate(), deferVideoWarmup(), loadPromise = loadDiptych(E), loadPromise.finally(() => loadPromise = null), consentEl && consentEl.isConnected && showAnalytics(), backgroundLoadRest(f)
}();
let loadingDiptych = !1,
    clicksSinceInterlude = 0,
    nextInterludeAt = INTERLUDE_SCHEDULE[0][1];
/* How long the title card holds before dismissing itself. The why card that
   follows appears instantly rather than fading in, so WHY_HINT_HOLD_MS below
   is its whole visible life, plus a 0.2s fade as it leaves. */
/* When false, the why panel shows both lines: the first names what is in the
   two frames, the second says why they are together. When true, the caption
   path collapses to the reason line alone (see showWhy). The uncaptioned
   fallback always shows both regardless, since its second line is only a
   closer and says nothing on its own. */
const WHY_REASON_ONLY = !0,
    SPLASH_MIN_MS = 1400,
    /* How long the why card sits before lifting to reveal the pair. It can
       carry a full sentence, occasionally two, so it needs real reading time —
       a line runs up to 110 characters. */
    WHY_HINT_HOLD_MS = 2600;
let splashHiddenResolve;
/* Resolves when the splash has finished fading and been removed. The hint
   waits on it, so the two never overlap: on a warm visit the diptych is ready
   long before the splash clears, and without this the hint would spend its
   whole life behind an opaque title card. */
const splashHidden = new Promise(e => splashHiddenResolve = e);
let firstHintShown = !1,
    firstHintDone = !1,
    firstHintTimer = null;

/* The why text for a pair, exactly as the panel would show it on a swipe — same
   composer, same reason-only rule. Returns null if either frame lacks a real
   signature, in which case there is nothing honest to say about the pairing. */
function whyLinesFor(e) {
    if (!e || 2 !== e.length) return null;
    const t = colorSignatures.get(e[0]),
        n = colorSignatures.get(e[1]);
    if (!t || !n || t.isFallback || n.isFallback) return null;
    whyPairSrcs = e;
    const [a, o, i] = composeWhyText(t, n, subjectFor(e[0]), subjectFor(e[1]));
    whyPairSrcs = null;
    return (WHY_REASON_ONLY && i ? [o] : [a, o]).map(stripPunctuation)
}

/* Replace the card's text with one or more lines, reusing the .line block
   layout the interludes use. */
function setHintLines(e, t) {
    e.textContent = "";
    for (const n of t) {
        if (!n) continue;
        const a = document.createElement("span");
        a.className = "line", a.textContent = n, e.appendChild(a)
    }
}
/* Nothing stands between the splash and the pair.

   There used to be a card here — first the why for the coming pair, later just
   the gesture — and either way it was a screen of text the visitor had to get
   past before seeing a photograph. The splash names the site; after that the
   diptych should be the next thing, with the gesture waiting quietly at the
   foot of the screen.

   The name is kept, and firstHintDone set immediately, so that the click
   handler and the analytics card behave exactly as they did once the old card
   had been dismissed. */
async function showFirstPairHint(pair) {
    if (firstHintShown) return;
    firstHintShown = firstHintDone = !0;
    const e = document.getElementById("first-hint");
    e && e.parentNode && e.remove();
    await splashHidden;
    showClickHint()
}

function dismissFirstHint() {
    if (firstHintDone) return;
    firstHintDone = !0, firstHintTimer && (clearTimeout(firstHintTimer), firstHintTimer = null);
    const e = document.getElementById("first-hint");
    e && (e.classList.remove("visible"), e.classList.add("leaving"), setTimeout(() => {
        e.parentNode && e.remove()
    }, 350)), showClickHint()
}

/* A quiet line at the foot of the screen, appearing with the first pair and
   staying until the visitor clicks. It replaces the "Click anywhere" card
   that used to precede the pair: the instruction is still there, but beside
   the photographs rather than in front of them.

   It sits above the analytics banner when that is present, measured rather
   than guessed, since the banner is two lines of a viewport-relative font and
   isn't there at all once a choice has been made. */
let clickHintEl = null;

function positionClickHint() {
    if (!clickHintEl) return;
    const e = document.getElementById("consent"),
        t = e && e.isConnected && "true" !== e.getAttribute("aria-hidden") ? e.getBoundingClientRect().height : 0;
    clickHintEl.style.bottom = t > 0 ? `calc(max(10px, env(safe-area-inset-bottom)) + ${Math.round(t)}px + 1.2em)` : "max(10px, env(safe-area-inset-bottom))"
}

function showClickHint() {
    if (clickHintEl) return;
    clickHintEl = document.getElementById("click-hint");
    if (!clickHintEl) return;
    /* Each gesture with what it does in brackets, so neither has to be
       guessed. One line, three non-breaking spaces between the two halves,
       matching the gap between Accept / Decline / Why on the analytics card;
       regular spaces would collapse and could wrap mid-phrase. */
    clickHintEl.textContent = "Swipe up (why)\u00a0\u00a0\u00a0Click (next)";
    /* Delayed by the card's own fade-out so the line arrives with the pair
       rather than over the top of the card leaving. */
    setTimeout(() => {
        clickHintEl && (positionClickHint(), clickHintEl.classList.add("visible"))
    }, 350), window.addEventListener("resize", positionClickHint)
}

function hideClickHint() {
    if (!clickHintEl) return;
    const e = clickHintEl;
    clickHintEl = null, window.removeEventListener("resize", positionClickHint), e.classList.remove("visible"), setTimeout(() => {
        e.parentNode && e.remove()
    }, 350)
}
async function advance() {
    if (loadingDiptych) return;
    /* While the opening why card is still on screen, the first click
       spends itself dismissing the hint and nothing else — the opening pair
       stays put. Advancing only resumes once the hint has gone, so the pair
       the visitor is being invited to look at isn't taken away by the very
       click that acknowledges the invitation. Applies to the keyboard path
       too (space / enter / arrow all route through advance). */
    if (firstHintShown && !firstHintDone) return void dismissFirstHint();
    /* Its instruction has been followed; it has nothing left to say. */
    hideClickHint(), dismissFirstHint(), clickCount++, clicksSinceInterlude++;
    if (seenInterludes.size < INTERLUDES.length && clicksSinceInterlude >= nextInterludeAt) clicksSinceInterlude = 0, showInterlude(), nextInterludeAt = interludeQueue.length ? interludeQueue[0][1] : rollNextInterlude();
    else {
        loadingDiptych = !0;
        try {
            await loadDiptych()
        } finally {
            loadingDiptych = !1
        }
    }
}
let triedFullscreen = !1;
document.getElementById("diptych").addEventListener("click", () => {
    !triedFullscreen && matchMedia("(hover: none) and (orientation: landscape)").matches && !document.fullscreenElement && document.documentElement.requestFullscreen && (triedFullscreen = !0, document.documentElement.requestFullscreen().catch(() => {})), advance()
}), document.addEventListener("keydown", async e => {
    const t = e.target;
    if (t && ("INPUT" === t.tagName || "TEXTAREA" === t.tagName || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const n = " " === e.key || "Enter" === e.key || "ArrowRight" === e.key,
        a = "Escape" === e.key;
    if (!n && !a) return;
    const o = document.getElementById("splash");
    if (!o || o.classList.contains("hidden")) return whyEl && whyEl.classList.contains("visible") ? (e.preventDefault(), void hideWhy()) : currentInterlude ? (e.preventDefault(), interludeLoadTrigger && interludeLoadTrigger(), interludePreload && await interludePreload, void hideInterlude()) : void(n && (e.preventDefault(), advance()));
    e.preventDefault()
});
const GA_ID = "G-F8Z6W7JPHQ",
    CONSENT_KEY = "ff-analytics-consent",
    consentEl = document.getElementById("consent");

function loadAnalytics() {
    if (window.gaEnabled) return;
    window.gaEnabled = !0;
    const e = document.createElement("script");
    e.async = !0, e.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`, document.head.appendChild(e), window.dataLayer = window.dataLayer || [], window.gtag = function() {
        dataLayer.push(arguments)
    }, gtag("js", new Date), gtag("config", GA_ID, {
        anonymize_ip: !0
    })
}
const CONSENT_REVEAL_DELAY_MS = 900;

function showAnalytics() {
    consentEl && setTimeout(() => {
        consentEl && consentEl.isConnected && (consentEl.classList.add("visible"), consentEl.setAttribute("aria-hidden", "false"))
    }, CONSENT_REVEAL_DELAY_MS)
}

function dismissConsent() {
    consentEl && (consentEl.classList.remove("visible"), consentEl.setAttribute("aria-hidden", "true"), setTimeout(() => consentEl.remove(), 250))
}
const stored = (() => {
    try {
        return localStorage.getItem(CONSENT_KEY)
    } catch {
        return null
    }
})();
"granted" === stored ? (loadAnalytics(), consentEl.remove()) : "denied" === stored ? consentEl.remove() : (document.getElementById("consent-accept").addEventListener("click", e => {
    e.stopPropagation();
    try {
        localStorage.setItem(CONSENT_KEY, "granted")
    } catch {}
    loadAnalytics(), dismissConsent()
}), document.getElementById("consent-decline").addEventListener("click", e => {
    e.stopPropagation();
    try {
        localStorage.setItem(CONSENT_KEY, "denied")
    } catch {}
    dismissConsent()
}), document.getElementById("consent-why").addEventListener("click", e => {
    e.stopPropagation(), window.open("/privacy.html", "privacy-policy", "width=" + screen.width / 3 + ",height=" + screen.availHeight + ",top=0,scrollbars=yes,resizable=yes")
}));
const shareToastEl = document.getElementById("share-toast"),
    shareToastTextEl = document.getElementById("share-toast-text"),
    /* How long "Link copied" stays up. It was 150ms, which is below the point
       at which most people register that text appeared at all — long enough to
       leave someone unsure whether the share worked. */
    SHARE_TOAST_MS = 1400,
    LONG_PRESS_MS = 550,
    LONG_PRESS_MOVE_TOLERANCE = 12,
    SWIPE_UP_MIN = 60;
let shareToastTimer = null,
    longPressFired = !1,
    whyGestureFired = !1,
    touchActive = !1,
    touchStartTime = 0,
    touchStartX = 0,
    touchStartY = 0,
    touchMoved = !1;

function showShareToast(e) {
    shareToastTextEl.textContent = e, shareToastEl.classList.add("visible"), shareToastEl.setAttribute("aria-hidden", "false"), clearTimeout(shareToastTimer), shareToastTimer = setTimeout(() => {
        shareToastEl.classList.remove("visible"), shareToastEl.setAttribute("aria-hidden", "true")
    }, SHARE_TOAST_MS)
}

function shareCurrentPair() {
    const e = location.href;
    if (matchMedia("(hover: none) and (pointer: coarse)").matches && navigator.share) return void navigator.share({
        url: e,
        title: "Federico Ferrari — Random Diptychs"
    }).then(() => {
        window.gaEnabled && "undefined" != typeof gtag && gtag("event", "pair_shared", {
            url: e,
            source: "shortcut-mobile"
        })
    }, () => {});
    const t = () => {
        window.gaEnabled && "undefined" != typeof gtag && gtag("event", "pair_shared", {
            url: e,
            source: "shortcut"
        })
    };
    navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(e).then(() => {
        showShareToast("Link copied"), t()
    }, () => {
        legacyCopy(e) ? (showShareToast("Link copied"), t()) : showShareToast("Couldn’t copy")
    }) : legacyCopy(e) ? (showShareToast("Link copied"), t()) : showShareToast("Couldn’t copy")
}

function legacyCopy(e) {
    const t = document.createElement("textarea");
    t.value = e, t.setAttribute("readonly", ""), t.style.cssText = "position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent;font-size:16px;opacity:0;", document.body.appendChild(t);
    let n = !1;
    try {
        if (/iPad|iPhone|iPod/.test(navigator.userAgent) || "MacIntel" === navigator.platform && navigator.maxTouchPoints > 1) {
            t.contentEditable = "true", t.readOnly = !1;
            const n = document.createRange();
            n.selectNodeContents(t);
            const a = window.getSelection();
            a.removeAllRanges(), a.addRange(n), t.setSelectionRange(0, e.length)
        } else t.focus(), t.select();
        n = document.execCommand("copy")
    } catch {
        n = !1
    }
    return document.body.removeChild(t), n
}
const diptychEl = document.getElementById("diptych");
/* Trackpad swipe, the desktop equivalent of the touch swipe below — and like
   it, this opens the why panel. It does NOT advance: clicking does that.

   Not over the splash, not during an interlude, not when the panel is
   already open. The threshold and the cooldown
   keep a flick of trackpad momentum from firing several times over. */
let _wheelAt = 0;
window.addEventListener("wheel", e => {
    if (Math.abs(e.deltaY) < 28 || e.deltaY < 0) return;
    const t = Date.now();
    if (t - _wheelAt < 700) return;
    const n = document.getElementById("splash");
    if (n && !n.classList.contains("hidden") || currentInterlude || whyEl && whyEl.classList.contains("visible")) return;
    _wheelAt = t, showWhy()
}, { passive: !0 });
diptychEl.addEventListener("touchstart", e => {
        longPressFired = !1, whyGestureFired = !1, e.touches && 1 === e.touches.length ? (touchActive = !0, touchStartTime = performance.now(), touchStartX = e.touches[0].clientX, touchStartY = e.touches[0].clientY, touchMoved = !1) : touchActive = !1
    }, {
        passive: !0
    }), diptychEl.addEventListener("touchmove", e => {
        if (!touchActive) return;
        if (!e.touches || 0 === e.touches.length) return;
        const t = e.touches[0].clientX - touchStartX,
            n = e.touches[0].clientY - touchStartY;
        t * t + n * n > 144 && (touchMoved = !0), n < 0 && Math.abs(n) > Math.abs(t) && Math.abs(n) > 3 && e.preventDefault()
    }, {
        passive: !1
    }), diptychEl.addEventListener("touchend", e => {
        if (!touchActive) return;
        if (touchActive = !1, e.changedTouches && e.changedTouches.length) {
            const t = e.changedTouches[0].clientX - touchStartX,
                n = e.changedTouches[0].clientY - touchStartY;
            if (-n >= 60 && Math.abs(n) > Math.abs(t)) return whyGestureFired = !0, void showWhy()
        }
        if (touchMoved) return;
        performance.now() - touchStartTime >= 550 && (longPressFired = !0, shareCurrentPair())
    }, {
        passive: !0
    }), diptychEl.addEventListener("touchcancel", () => {
        touchActive = !1
    }, {
        passive: !0
    }), diptychEl.addEventListener("click", e => {
        (longPressFired || whyGestureFired) && (longPressFired = !1, whyGestureFired = !1, e.stopImmediatePropagation(), e.preventDefault())
    }, !0), document.addEventListener("keydown", e => {
        if ("s" !== e.key && "S" !== e.key) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t && ("INPUT" === t.tagName || "TEXTAREA" === t.tagName || t.isContentEditable)) return;
        const n = document.getElementById("splash");
        n && !n.classList.contains("hidden") || currentInterlude || whyEl && whyEl.classList.contains("visible") || (e.preventDefault(), shareCurrentPair())
    }),
    function() {
        /* The two hint lines are set independently: either can be absent from
           the markup without silencing the other. They were coupled, so
           removing the share line also left the why hint blank and hidden —
           it stays display:none until `show` is added here. */
        const e = document.getElementById("share-trigger"),
            t = document.getElementById("why-hint");
        if (!e && !t) return;
        const n = matchMedia("(hover: none) and (pointer: coarse)"),
            a = () => {
                const a = n.matches;
                e && (e.textContent = a ? "Long press to share your favourite" : "Press S to share your favourite"), t && (t.textContent = a ? "Swipe up to see why a pair was chosen" : "Swipe up to see why a pair was chosen", t.classList.add("show"))
            };
        a(), n.addEventListener ? n.addEventListener("change", a) : n.addListener && n.addListener(a)
    }();
const whyEl = document.getElementById("why"),
    whyLine1El = null,
    whyLine2El = document.getElementById("why-line-2");

/* The current pair, held in memory rather than in the URL. */
let currentPairSrcs = null;

function currentPairSrcsFromHash() {
    if (currentPairSrcs && currentPairSrcs[0] && currentPairSrcs[1]) return currentPairSrcs;
    const e = location.hash.slice(1);
    if (!e) return null;
    const t = e.split(",");
    if (2 !== t.length) return null;
    const n = idToSrc(t[0]),
        a = idToSrc(t[1]);
    return n && a ? [n, a] : null
}

function paletteContrastOf(e, t) {
    const n = (e, t) => {
        let n = 0;
        for (const a of e) {
            let e = 0;
            for (const n of t) {
                const t = colorSimilarity(a, n);
                t > e && (e = t)
            }
            n += e * a.weight
        }
        return n
    };
    return 1 - (n(e.palette, t.palette) + n(t.palette, e.palette)) / 2
}

/* The gold/green boundary sits at 56, not 67. Grass, leaves and foliage
   photograph between 60 and 75 degrees, so a boundary at 67 put half of them in
   "gold" — a green field read as gold, and the whole catalogue showed only 8
   frames in the entire green band despite being full of plants. */
function hueFamily(e) {
    return (e = (e % 360 + 360) % 360) < 15 || e >= 345 ? "red" : e < 40 ? "orange" : e < 64 ? "gold" : e < 159 ? "green" : e < 200 ? "teal" : e < 252 ? "blue" : e < 292 ? "violet" : "pink"
}

/* A colour name needs the frame to have colour in it, not just the swatch.

   The palette drops anything below .06 or above .94 lightness, so in a very
   dark or very light photograph most of the frame is excluded and whatever
   small saturated thing survives becomes the "dominant" swatch — a black van
   with a yellow numberplate came out as gold at 72% weight while the frame's
   own saturation was .066. Naming that as the picture's colour is wrong, so
   frames this close to monochrome get no hue at all. */
const MIN_FRAME_SAT = .18;

/* The name a person would actually use. hueFamily gives eight bands from the
   hue angle alone, so a dark desaturated yellow and a bright one are both
   "gold" — and one of them is mustard. Lightness and saturation decide which.

   This is for prose only. The family names still drive the warm/cool logic and
   the adjacency test, which need stable buckets rather than good words. */
function colourName(e, t, n) {
    const a = hueFamily(e),
        o = n < .32,
        i = n > .75,
        r = t < .42;
    switch (a) {
        case "red":
            return o ? "dark red" : r ? i ? "blush" : "brick red" : i ? "coral" : "red";
        case "orange":
            /* Wood, brick and tan cloth all land here. At anything short of
               vivid they read as brown, not orange — "orange and blue" for a
               dark wood cabinet was simply the wrong word. */
            return o ? "brown" : i ? r ? "tan" : "apricot" : t < .75 ? "brown" : "orange";
        case "gold":
            return o ? "olive" : r ? i ? "cream" : "mustard" : i ? "butter yellow" : "gold";
        case "green":
            return o ? "deep green" : r ? i ? "sage" : "olive green" : i ? "mint" : "green";
        case "teal":
            return o ? "deep teal" : i ? "aqua" : "teal";
        case "blue":
            return o ? "navy" : r ? i ? "pale blue" : "slate blue" : i ? "sky blue" : "blue";
        case "violet":
            return o ? "indigo" : i ? "lilac" : "violet";
        default:
            return o ? "plum" : i ? "pale pink" : "pink"
    }
}

/* The name a frame goes by in prose.

   Currently the plain family — red, blue, green — not the richer name that
   colourName above can produce. The specific names are correct English for the
   swatch they describe, but the swatch is still sometimes the wrong one: a
   brick building whose white render carries 73% of the palette comes out
   "aqua", and a wrong "aqua" is far more jarring to read than a wrong "blue".

   Switch the call to colourName(t.hsl.h, t.hsl.s, t.hsl.l) once a large pale
   background can no longer outvote a small vivid subject — the fix is to weight
   swatches by chroma as well as area when choosing which family carries the
   frame. */
function dominantColourName(e) {
    if (e && e.colour) return "none" === e.colour ? null : e.colour;
    const t = representativeSwatch(e);
    /* The swatch doing the naming has to be a colour itself. Black denim
       registers as h40 s0.60 at lightness .08 — HSL saturation is noise down
       there — so a near-black frame was being called orange, and the frame's
       own avgSat of .16 squeaked past the floor. Chroma settles it: .030 is
       grey, whatever the hue says. */
    return !t || !t.hsl || !t.oklab || t.hsl.s < .22 || Math.hypot(t.oklab.a, t.oklab.b) < .045 || (e.avgSat || 0) < MIN_FRAME_SAT ? null : colourName(t.hsl.h, t.hsl.s, t.hsl.l)
}

/* A small, strongly coloured thing in an otherwise colourless frame — the brass
   teeth on black denim, at 1% of the palette but the only real colour in it.
   Returned only when the frame has no dominant colour to name, so this never
   competes with one. */
/* The colour of a small vivid detail, for lines like "and just a thread of
   orange on the other".

   It has to be a detail. A white bulk bag whose shadow reads h208 at chroma
   .095 across 77% of the frame was being given "blue" as its detail colour —
   but a swatch that is most of the picture is the ground, not a thread in it. */
function detailColour(e) {
    if (e && e.colour || dominantColourName(e)) return null;
    let t = null;
    for (const n of e.palette || []) {
        if (!n.oklab || !n.hsl) continue;
        const a = Math.hypot(n.oklab.a, n.oklab.b);
        a >= .09 && (n.weight || 0) <= .45 && n.hsl.l >= .25 && n.hsl.l <= .85 && (!t || a > t.c) && (t = {
            c: a,
            name: hueFamily(n.hsl.h)
        })
    }
    return t ? t.name : null
}

/* The family name, used for "same family" and for the shared-colour rule.

   It needs the chroma floor that dominantColourName already has. Without it a
   white van, whose shadows read h225 at .29 saturation, was labelled blue and
   then said to share a colour family with the sky behind the Dreamland tower.
   The van has no colour; nothing should be able to say it does. */
function dominantHueLabel(e) {
    /* A caption colour ending in a family name — "coral pink", "dark red" —
       belongs to that family for warm, cool and neighbouring-hue checks; the
       full name is what gets written. Anything else ("warm grey") is used as
       it stands. */
    if (e && e.colour) {
        if ("none" === e.colour) return null;
        const t = e.colour.split(/\s+/).pop();
        return ["red", "orange", "gold", "green", "teal", "blue", "violet", "pink"].includes(t) ? t : e.colour
    }
    const t = representativeSwatch(e);
    return !t || !t.hsl || !t.oklab || t.hsl.s < .22 || Math.hypot(t.oklab.a, t.oklab.b) < .045 || (e.avgSat || 0) < MIN_FRAME_SAT ? null : hueFamily(t.hsl.h)
}

function capitalizeFirst(e) {
    return e ? e.charAt(0).toUpperCase() + e.slice(1) : e
}

/* Which swatch stands for the frame.

   Taking the single heaviest one was wrong whenever a colour arrives split
   across several swatches: a garden of red roses holds its reds at .29, .12 and
   .10 — 51% between them — while one bright yellow-green highlight sits at .38
   and won outright. The frame was then called mint.

   So group the swatches by hue family first, pick the family carrying the most
   weight, and return the heaviest swatch inside it. A colour broken into pieces
   is still that colour. */
function representativeSwatchIndex(e) {
    const t = e && e.palette;
    if (!t || !t.length || !t[0].hsl) return 0;
    const n = {};
    for (let e = 0; e < t.length; e++) {
        const a = t[e];
        /* Judged on oklab chroma, not HSL saturation. HSL calls a near-white
           render 80% cyan and a near-black navy 100% blue, because its
           saturation term is meaningless at both ends of the lightness range.
           Chroma is the distance from grey in a perceptual space, so it says
           what a viewer would: those two are almost colourless. */
        if (!a.hsl || !a.oklab || Math.hypot(a.oklab.a, a.oklab.b) < .045) continue;
        const o = hueFamily(a.hsl.h);
        /* Area, not area x chroma. Weighting by chroma was tried, to stop a
           large pale ground outvoting a small vivid subject — and it made
           things worse: a garden of red roses came back olive green, because
           the few high-chroma leaves beat the mass of red. The pavement-beats-
           bicycle problem is real but this is not its fix. */
        n[o] = n[o] || {
            w: 0,
            idx: e,
            best: 0
        }, n[o].w += a.weight || 0, (a.weight || 0) > n[o].best && (n[o].best = a.weight || 0, n[o].idx = e)
    }
    const a = Object.values(n).sort((e, t2) => t2.w - e.w)[0];
    /* Nothing carries a nameable hue: fall back to the old behaviour, which
       looks past a flat or very dark leading swatch for something with colour
       in it. */
    if (!a) {
        const n2 = t[0].hsl,
            a2 = n2.s < .16,
            o = n2.s >= .16 && n2.s < .45 && n2.l < .34;
        if (!a2 && !o) return 0;
        const i = t[0].weight || 0;
        for (let e = 1; e < t.length; e++) {
            const a3 = t[e];
            if (!(!a3.hsl || a3.hsl.s < .16 || (a3.weight || 0) < .3 * i) && (!o || a3.hsl.s >= n2.s && a3.hsl.l >= .22)) return e
        }
        return 0
    }
    /* A coloured family only displaces the leading swatch if it is genuinely
       present — otherwise a small vivid detail in a grey frame would speak for
       the whole picture. */
    return a.w >= .25 ? a.idx : 0
}

function representativeSwatch(e) {
    return e && e.palette ? e.palette[representativeSwatchIndex(e)] : null
}

function describeSwatch(e, t) {
    const n = void 0 === t ? representativeSwatchIndex(e) : t,
        a = e && e.palette && e.palette[n];
    if (!a || !a.hsl) return "a quiet tone";
    const o = a.hsl.s,
        i = a.hsl.l;
    if (o < .16) return i < .12 ? "near-black" : i < .28 ? "charcoal" : i < .46 ? "slate grey" : i < .64 ? "mid grey" : i < .82 ? "soft grey" : "near-white";
    const r = hueFamily(a.hsl.h);
    if ("orange" === r && i < .4) return i < .25 ? "dark brown" : "brown";
    let s = "";
    return i < .22 ? s = "deep" : i < .38 ? s = "dark" : i > .8 ? s = "pale" : i > .64 ? s = "soft" : o > .62 ? s = "vivid" : o < .3 && (s = "muted"), s ? s + " " + r : r
}

function whySeed(e, t) {
    const n = e => Math.round(1e3 * (e || 0)),
        a = 31 * n(e.meanL) + 37 * n(t.meanL) + 41 * n(e.avgSat) + 43 * n(t.avgSat) + 47 * n(e.density) + 53 * n(t.density) + 59 * n(e.cx) + 61 * n(t.cx) + 67 * n(e.cy) + 71 * n(t.cy);
    return Math.abs(a)
}

function pick(e, t) {
    return e[(t % e.length + e.length) % e.length]
}

function selectWhyPattern(e, t) {
    const n = paletteContrastOf(e, t),
        a = Math.abs(e.density - t.density),
        o = Math.abs(e.meanL - t.meanL),
        i = Math.abs(e.edgeEnergy - t.edgeEnergy),
        r = (e.meanL + t.meanL) / 2,
        s = Math.abs(e.avgSat - t.avgSat),
        l = representativeSwatch(e),
        c = representativeSwatch(t),
        d = l ? l.oklab.b : 0,
        h = c ? c.oklab.b : 0,
        u = e => {
            const t = representativeSwatch(e);
            return !!(t && t.hsl && t.hsl.s >= .16 && t.hsl.h >= 75 && t.hsl.h <= 165)
        },
        m = u(e),
        g = u(t),
        p = d > .03 && !m && (h > .03 && !g),
        f = d < -.03 && !m && (h < -.03 && !g),
        y = d > .04 && !m && h < -.04 && !g || d < -.04 && !m && h > .04 && !g,
        w = dominantHueLabel(e),
        b = dominantHueLabel(t),
        S = e.vertical > .3 && t.vertical < -.3 || e.vertical < -.3 && t.vertical > .3,
        E = Math.abs(e.cy - t.cy) < .07 && (e.cy < .4 || e.cy > .6),
        v = e.aspect < .9,
        T = e.aspect > 1.15,
        I = t.aspect < .9,
        P = t.aspect > 1.15,
        A = v && P || T && I,
        _ = r > .65 && o < .25,
        /* Both dark — judged on the lighter of the two, not the average of
           them, or one bright frame is called dark because the other is very.
           The lightness test alone is not enough either: a saturated blue
           or a deep red measures low on L while reading as colour, not
           darkness — a bright sky full of contrails was being called "the same
           dark twice". Requiring low saturation as well keeps the word honest,
           and such pairs fall through to the temperature patterns, which is
           what a viewer would say about them anyway. */
        k = e.avgSat < .3 && t.avgSat < .3,
        M = e.avgSat > .45 && t.avgSat > .45,
        C = e => {
            const t = e.palette,
                n = t && t[representativeSwatchIndex(e)];
            return n && n.hsl ? n.hsl.s : 0
        },
        N = C(e),
        O = C(t),
        /* Both dark — and neither with a main colour that is itself bright:
           reeded glass at dusk sits at .35 lightness overall, but its swatch
           is a vivid mid-blue, and "the same dark twice" beside black water
           was not what anyone saw. */
        L = Math.max(e.meanL, t.meanL) < .38 && o < .25 && e.avgSat < .45 && t.avgSat < .45 && N < .5 && O < .5,
        x = Math.min(N, O) < .3,
        R = N >= .45 && O >= .45,
        F = N >= .45 && O < .3 || O >= .45 && N < .3,
        D = e => {
            const t = representativeSwatch(e);
            return t ? Math.hypot(t.oklab.a, t.oklab.b) : 0
        },
        V = e.avgSat < .12 && N < .18 && D(e) < .03 && e.meanL >= .3 && e.meanL <= .62,
        B = t.avgSat < .12 && O < .18 && D(t) < .03 && t.meanL >= .3 && t.meanL <= .62;
    return n > .5 && o > .3 && a > .22 ? {
        id: "P1"
    } : _ && n > .45 ? {
        id: "P2"
    } : _ ? {
        id: "P2b"
    } : L && n > .45 ? {
        id: "P3"
    } : L ? {
        id: "P3b"
    } : y && o > .3 ? {
        id: "P4"
    } : y && a > .22 ? {
        id: "P5"
    } : y ? {
        id: "P6"
    } : V && O >= .45 || B && N >= .45 ? {
        id: "PMONO"
    } : o > .3 && n > .55 ? {
        id: "P7"
    } : o > .3 && a > .22 ? {
        id: "P8"
    } : o > .3 ? {
        id: "P9"
    } : a > .22 && i > .1 && n > .55 ? {
        id: "P10"
    } : a > .22 && i > .1 ? {
        id: "P11"
    } : s > .3 && x || F && !k ? {
        id: "P12"
    } : w && b && w !== b && (n > .4 || R) ? {
        id: "P12b"
    } : w && b && w === b ? {
        id: "P12c"
    } : n > .6 ? {
        id: "P13"
    } : p ? {
        id: "P14"
    } : f ? {
        id: "P15"
    } : k ? {
        id: "P16"
    } : M ? {
        id: "P17"
    } : S ? {
        id: "P17b"
    } : E ? {
        id: "P17c"
    } : A ? {
        id: "P17d"
    } : {
        id: "P18"
    }
}

function renderWhy(e, t, n, a) {
    const o = describeSwatch(t),
        i = describeSwatch(n),
        r = capitalizeFirst(o),
        s = capitalizeFirst(i),
        l = representativeSwatch(t),
        c = representativeSwatch(n),
        d = l ? l.oklab.b : 0,
        h = c ? c.oklab.b : 0,
        /* Left frame first, always — u/m used to be warm-first, naming
           whichever side happened to be warmer. Uncaptioned prose has no
           nouns to anchor it, so a reader maps the first phrase to the left
           panel; getting that order wrong describes the pair backwards. */
        u = o,
        m = i,
        g = r,
        p = dominantHueLabel(t) || dominantHueLabel(n),
        f = r,
        y = !!(t.palette && t.palette[1] && t.palette[1].hsl),
        w = !!(n.palette && n.palette[1] && n.palette[1].hsl),
        b = describeSwatch(t, 1),
        S = describeSwatch(n, 1),
        E = y && w ? b === S ? b : b + " and " + S : y ? b : w ? S : null,
        v = paletteContrastOf(t, n),
        T = Math.abs(t.meanL - n.meanL),
        I = Math.abs(t.density - n.density),
        P = Math.max(v, T, I),
        A = capitalizeFirst(P > .55 ? "a wide gulf" : P > .35 ? "a clear gap" : P > .18 ? "a short step" : "barely a step"),
        _ = a,
        L = Math.imul(2654435769 ^ a, 2654435761) >>> 0,
        k = {
            P1: {
                l1: ["Three axes apart: colour, density, and light.", "Colour, light, and density, all pulling different ways.", "Apart on every axis the algorithm watches.", "Every signal disagrees at once.", "Colour, tone, rhythm; none of them line up.", "A clean break on all three measures."],
                l2: ["The pair scores high on every signal measured.", "Maximum contrast: the rarest thing in the catalogue.", A + " on every front.", "Nothing here agrees, and that’s the point."]
            },
            P2: {
                l1: ["Two high-key frames, drawn from different palettes.", r + " and " + i + ", both lit bright.", "Two bright frames that disagree on colour.", "Light in both, agreement in neither.", r + " beside " + i + ", and the room is bright in both.", "Both overexposed-bright; the palettes part ways."],
                l2: ["Light fills both, but the colours hold separate notes.", "Shared luminance, separate palettes.", "The light agrees; the palette argues.", E ? "Bright up top, " + E + " below." : null]
            },
            P2b: {
                l1: ["Two bright frames, close in palette.", r + " beside " + i + ", both high and pale.", "Two high-key frames in the same narrow band.", "Both bright, both pale, barely a colour between them.", "Light, and not much colour to separate them."],
                l2: ["Light is what both photos share.", "A pair held together by brightness alone.", "Chosen for the light, not the colour.", "The brightness does all the binding."]
            },
            P3: {
                l1: ["Both low-key, with palettes that don’t share a note.", r + " and " + i + ", both kept dark.", "Two frames deep in shadow, apart on colour.", "Dark in both, but the colour pulls two ways.", r + " against " + i + ", and the light is low in both."],
                l2: ["After-hours frames meeting across the colour gap.", "The dark is shared; the palette is not.", "Two dim frames pulling colour from different worlds.", E ? "Shadow up top, " + E + " beneath." : null]
            },
            P3b: {
                l1: ["Two dim frames, within the same tonal range.", r + " beside " + i + ", both low and close.", "Two low-key frames in one narrow band.", "Both dark, both quiet, the same kind of dark."],
                l2: ["A pair built on the shared weight of low light.", "Held together by the weight of the shadows.", "The shared dark is the whole of the pairing.", "One register, dim and steady."]
            },
            P4: {
                l1: ["Warm meets cool, light meets dark.", g + " against " + m + ", and bright against dark.", "Warm against cool, with the light split too.", "Temperature and tone, both breaking the same way.", g + " and bright on one side, " + m + " and dark on the other."],
                l2: ["Two oppositions running in parallel.", "Two contrasts stacked into a single pair.", A + " between them, twice over.", "The eye gets warmth and brightness in one read."]
            },
            P5: {
                l1: ["Warm against cool; busy against still.", g + " against " + m + ", one busy, one calm.", "Warm meets cool, dense meets sparse.", "Temperature and rhythm, both turning over.", g + " and crowded, " + m + " and clear."],
                l2: ["Palette and rhythm both turning over.", "Two axes of contrast at the same time.", "Heat and density, pulling together.", A + " on colour, and the rhythm splits too."]
            },
            P6: {
                l1: ["Warm against cool.", g + " against " + m + ".", g + " on one side, " + m + " on the other.", "Warmth on one side, cool on the other.", g + ", then " + m + ".", "A warm frame and a cool one, nothing else needed.", "The whole pairing is temperature.", g + " meeting " + m + " down the middle."],
                l2: ["The opposition is the whole of the pair.", "Temperature is the entire argument.", A + " in warmth, and little else.", "Nothing else needs to happen.", E ? "Warm against cool up top, " + E + " below." : null]
            },
            PMONO: {
                l1: ["Colour beside monochrome.", "One in colour, one in black and white.", f + " beside black and white.", "Colour on one side, greyscale on the other.", "One side in colour, the other in grey.", f + " against a near-colourless frame."],
                l2: ["The colour lives on one side only.", "One frame keeps its colour, the other lets it go.", "Colour against greyscale, the plainest split there is.", "Almost all the colour on one side."]
            },
            P7: {
                l1: ["Light meets dark; the colours disagree, too.", r + " against " + i + ", bright against dark.", "A bright frame against a dark one, colours apart.", "Tone first, then the colour gap.", "Luminance splits, and so does the palette."],
                l2: ["The eye registers luminance first, then everything else.", "Tone leads, colour follows a beat behind.", "Luminance reads first; the palette gap lands second.", E ? "Light against dark up top, " + E + " underneath." : null]
            },
            P8: {
                l1: ["Bright against dark, dense against sparse.", "Light against dark, busy against still.", "One bright and busy, one dark and quiet.", "Tone and rhythm, breaking together.", "Brightness and density, both split."],
                l2: ["A pair built on two parallel oppositions.", "Tone and rhythm breaking the same way.", "Two contrasts moving in step.", A + " between them, on two counts."]
            },
            P9: {
                l1: ["Light against dark, within a shared family of colours.", r + " against " + i + ", a step apart in light.", "A bright frame and a dark one, colours in agreement.", "The colours hold; the light does the splitting.", "Same palette, opposite ends of the light."],
                l2: ["Tone, not hue, doing the work.", "The colours stay close; the tone carries it.", "The whole contrast lives in the light.", A + " in light, none to speak of in colour."]
            },
            P10: {
                l1: ["A composition full of detail, beside one that breathes.", "Dense beside sparse, and the colours diverge too.", "One frame packed, one frame open; colours apart.", "Detail against rest, palette against palette.", "One crowds the frame, one clears it."],
                l2: ["The palettes don’t share a centre, either.", "One frame crowds; the other clears space.", "Detail against rest, with the palette splitting as well.", A + " in colour, on top of the density."]
            },
            P11: {
                l1: ["Where one is busy, the other rests.", "One frame crowded, the other clear.", "Dense beside sparse.", "One asks for time, the other lands at once.", "Detail on one side, space on the other."],
                l2: ["Two scenes read at different speeds.", "Detail against space: that’s the pairing.", "One takes a moment to read; the other doesn’t.", "Rhythm is the whole of it."]
            },
            P12: {
                l1: ["One carries the colour; the other holds back.", f + " against a more restrained counterpart.", "One frame saturated, the other restrained.", "Colour on one side, restraint on the other.", "One leans into colour, the other hangs back."],
                l2: ["A colour-forward frame paired with a quieter one.", "One side colour-forward, the other holding back.", "The colour gap is the whole of it.", E ? "Colour up front, " + E + " behind it." : null]
            },
            P12b: {
                l1: [r + " meets " + i + ".", r + " on one side, " + i + " on the other.", "A clash of families: " + o + " and " + i + ".", r + " against " + i + ", no overlap.", o + " and " + i + ", two different worlds.", "On one side " + o + ", on the other " + i + "."],
                l2: ["Two colour families, set against each other.", "Named colours, pulling apart.", "The two hues don’t belong to the same world.", A + " between the families.", E ? "The clash up top, " + E + " beneath." : null]
            },
            P12c: {
                l1: ["Both in the " + p + " family.", (o === i ? "Two takes on " + o : r + " beside " + i) + ".", "A " + p + " pair, varied from within.", "One family, " + p + ", read two ways.", "Both " + p + ", a shade apart."],
                l2: ["The whole pair lives inside one colour family.", "One family, read at two different settings.", "Same family, different corners of it.", "A single hue, taken two directions."]
            },
            P13: {
                l1: ["Different palettes, equivalent weight.", r + " against " + i + ", evenly matched otherwise.", "Two palettes apart, everything else level.", "Same brightness, same density; the colour does the work.", "Only the colour separates them."],
                l2: ["Same brightness, same density; the colour does all the work.", "Only the palette separates them.", "Colour is the single variable here.", A + " in colour, and nothing else moves.", E ? "Two palettes up top, " + E + " below." : null]
            },
            P14: {
                l1: ["Both warm in palette, varying by small steps.", r + " and " + i + ", both on the warm side.", "Two warm frames, a small step apart.", "Warm and warmer, the same half of the wheel.", "Both lean warm, by different amounts."],
                l2: ["The pair holds together through shared temperature.", "Warmth is the common thread.", "Shared temperature binds them.", "One warm register, two readings."]
            },
            P15: {
                l1: ["Two cool palettes, paired across small variations.", r + " and " + i + ", both kept cool.", "Two cool frames, close but not identical.", "Cool and cooler, the same end of the wheel.", "Both lean cool, by a little."],
                l2: ["The contrast surfaces on the second reading, not the first.", "A cool pair, separated by degrees.", "The difference is quiet, and deliberate.", "One cool register, two readings."]
            },
            P16: {
                l1: ["Two restrained palettes; the contrast keeps quiet.", r + " and " + i + ", both held back.", "Two low-saturation frames in conversation.", "Muted against muted; the contrast whispers.", "Both subdued, neither loud."],
                l2: ["Neither frame raises its voice.", "A muted pair; the contrast is in the detail.", "Nothing shouts; the difference whispers.", "Both muted in colour."]
            },
            P17: {
                l1: ["Both saturated, with the colour pointing elsewhere in each.", r + " and " + i + ", both vivid, both apart.", "Two saturated frames pulling toward different hues.", "Loud colour on both sides, aimed different ways.", "Vivid and vivid, but not the same vivid."],
                l2: ["Colour-forward frames, drawn to different families.", "Two colour-forward frames headed different ways.", "Colour-rich, and colour-divided.", A + " between two loud palettes.", E ? "Vivid up top, " + E + " behind." : null]
            },
            P17b: {
                l1: ["One frame stands, the other lies flat.", "One built upright, the other laid wide.", "Verticals in one, horizontals in the other.", "A standing frame against a reclining one.", "Up on one side, across on the other."],
                l2: ["Vertical against horizontal, structure carrying the pair.", "The geometry is the contrast here.", "Structure, not colour, doing the work.", "Two directions meeting at the seam."]
            },
            P17c: {
                l1: ["Two centres of interest at the same height.", "Both subjects sitting on a shared line.", "Matched heights across the two frames.", "One eyeline, running through both.", "The same horizon, left and right."],
                l2: ["An eyeline that carries across the seam.", "A horizon that runs straight through the pair.", "The eye crosses the seam without a step.", "One line holding both frames."]
            },
            P17d: {
                l1: ["A tall frame beside a wide one.", "One portrait, one landscape.", "Upright format against wide format.", "Tall meets wide.", "Two shapes, one narrow, one broad."],
                l2: ["Two formats meeting at the centre.", "The shapes themselves are the dialogue.", "Two proportions set side by side.", "Format against format."]
            },
            P18: {
                l1: ["Paired across quiet contrasts on three axes.", "Small differences across colour, light, and density.", "Close on every axis, slightly apart on all of them.", "A pairing of small margins.", "No single axis leads, a little of each."],
                l2: ["The kind of agreement that takes a second to read.", "A quiet pairing that rewards a second look.", "Subtle by design; nothing here announces itself.", A + " on any one axis, and that’s the point."]
            }
        },
        M = k[e] || k.P18;
    return [capitalizeFirst(pick(M.l1, _)), pick([...M.l2, "The match holds.", "Nothing else competes.", "The rest stays quiet.", "It takes a second to settle, then it does.", "A quiet kind of agreement.", "Nothing forced about it.", "The eye accepts it before it can explain it.", "That’s the whole of the pairing.", "Simple, once you see it.", "Everything else falls away."].filter(Boolean), L)]
}
/* ═══════════════════════════════════════════════════════════════
   CAPTIONS — richer "why this pair" prose
   captions-manifest.json (see build-captions.mjs) holds one entry per
   frame. Images are keyed ffN, videos vN (from their posters). Each entry
   is an object { subject, short, detail, placement, height, distance,
   lines, light, surface }; a plain string (v1 manifest) is accepted as a
   subject-only entry.
   When BOTH frames of the current pair have a subject, line 1 names what is
   in the two frames and line 2 states the measured relationship (the same
   pattern selectWhyPattern picks for the colour-only prose) through those
   nouns. Anything missing falls back to the colour-only text.
   ═══════════════════════════════════════════════════════════════ */
const subjects = new Map;

function subjectKey(e) {
    const t = srcToId(e);
    return t ? (isVideo(e) ? t : "ff" + t) : null
}

/* Every field the scoring and the why text read has to be copied through here.

   This is where the whole caption system was silently dead in the browser.
   The list of copied fields stopped at "surface", so text, people, scale,
   category, structure, accent and hands were all stripped before any pair was
   scored or described. Every rule built on them — both carry words, framed as
   though the same size, hands in both, two lattices, the same red twice — could
   fire in the build script, which reads the manifest raw, and never once on
   the live site. The test harness read the manifest raw too, which is why it
   kept agreeing with the build and disagreeing with the phone.

   The rule now: copy everything that is a non-empty string or a boolean. A
   field added to the manifest must never again need adding here. */
function captionKeyToSrc(key) {
    const t = String(key || "");
    if (/^v\d+$/i.test(t)) return videoNumToSrc(t.slice(1));
    if (/^ff\d+$/i.test(t)) return numToSrc(t.slice(2));
    if (/^\d+$/.test(t)) return numToSrc(t);
    return null;
}

function pickNum() {
    for (let i = 0; i < arguments.length; i++) {
        const n = arguments[i];
        if (typeof n === "number" && isFinite(n)) return n;
    }
    return arguments[arguments.length - 1];
}

/* Accept the word-keyed signature written in captions.json, or the short
   keys from the old signatures.json. Runtime still uses avgSat / meanL / cx
   so scoring and the why panel do not need two code paths. */
function normalizeSignature(e) {
    if (!e || "object" != typeof e) return null;
    if (!Array.isArray(e.histogram) || e.histogram.length < 3) return null;
    return {
        histogram: e.histogram,
        palette: Array.isArray(e.palette) ? e.palette : [],
        avgSat: pickNum(e.averageSaturation, e.avgSat, .3),
        meanL: pickNum(e.meanLight, e.meanL, .5),
        density: pickNum(e.density, .5),
        histMag: pickNum(e.histogramMagnitude, e.histMag, .5),
        aspect: pickNum(e.aspect, .75),
        edgeEnergy: pickNum(e.edgeEnergy, .3),
        vertical: pickNum(e.vertical, 0),
        cx: pickNum(e.centerX, e.cx, .5),
        cy: pickNum(e.centerY, e.cy, .5)
    };
}

function normalizeCaption(e) {
    if ("string" == typeof e) {
        const t = e.trim();
        return t ? { subject: t } : null
    }
    if (!e || "object" != typeof e || "string" != typeof e.subject || !e.subject.trim()) return null;
    const t = { subject: e.subject.trim() };
    const skip = { subject: 1, signature: 1, kind: 1, id: 1 };
    for (const n in e) {
        if (skip[n]) continue;
        "string" == typeof e[n] && e[n].trim() ? t[n] = e[n].trim() : "boolean" == typeof e[n] && (t[n] = e[n]);
    }
    return t
}

function subjectFor(e) {
    const t = subjectKey(e);
    return t && subjects.get(t) || null
}
async function loadCaptionManifest() {
    try {
        let t = null;
        for (const url of ["captions.json", "captions-manifest.json"]) {
            try {
                const e = await fetch(url);
                if (e.ok) { t = await e.json(); break; }
            } catch {}
        }
        if (!t || "object" != typeof t) return;
        if (t.frames && "object" == typeof t.frames) t = Object.assign({}, t, t.frames);
        let n = 0, sigs = 0;
        for (const e in t) {
            /* Keys beginning with two underscores are separators / meta. */
            if (e.startsWith("__")) continue;
            const raw = t[e];
            const a = normalizeCaption(raw);
            a && (subjects.set(e, a), n++);
            const src = captionKeyToSrc(e);
            const sig = normalizeSignature(raw && raw.signature ? raw.signature : null);
            /* "colour" in a caption names the frame's colour outright, for the
               frames the measurement gets wrong — pale pink roses sit in the red
               band of the hue wheel. Usually one of the family names — red,
               orange, gold, green, teal, blue, violet, pink — but any colour a
               person would say works ("warm grey"); it is used as written. */
            sig && raw && "string" == typeof raw.colour && raw.colour.trim() && (sig.colour = raw.colour.trim().toLowerCase());
            /* "loud": false — never call this frame loud, whatever the
               measurement says (a deep blue fence measures as vivid). */
            sig && raw && !1 === raw.loud && (sig.notLoud = !0);
            /* "mono": true — treat as black and white (a nearly colourless
               frame the measurement lets through). */
            sig && raw && !0 === raw.mono && (sig.mono = !0);
            if (src && sig) {
                colorSignatures.set(src, sig);
                if (!validImages.includes(src)) validImages.push(src);
                sigs++;
            }
        }
        /* Captions feed pairScore. Rescore once the file lands. */
        (n || sigs) && "undefined" != typeof scheduleTopPairs && scheduleTopPairs(!0)
    } catch (e) {}
}

/* "the pint" — from `short`, else the last word of the subject. */
/* The name a subject goes by inside a sentence.

   Prefers the subject itself — "the pint of beer", "stacked champagne boxes" —
   over the bare head noun, so a single line can carry both what the thing is
   and how it relates to the other frame. Falls back to the head noun when the
   subject runs long, because two four-word names plus a predicate overruns
   LINE_MAX and the composer would end up picking its shortest, dullest
   candidate instead. */
/* Two words, not four. At four, a subject like "graffiti sprayed upside down"
   was used whole and the sentence carried more description than reason: the
   name only has to identify which frame is meant. Anything longer falls back to
   the caption's short noun. */
const NOUN_MAX_WORDS = 2;

/* Only the three directions that genuinely oppose one another. Curved is left
   out: it sits against everything and against nothing. */
/* The word a phrase actually agrees with. Judging on the last word breaks on
   "the corner of two walls" (walls, but the corner is), and judging on the
   caption's short field breaks when nounOf rendered the subject instead — which
   gave "the glittered princess sticker sheet catch the light". Cut at the first
   preposition or participle and take the last word before it. */
const PHRASE_TAIL = /\b(of|over|at|in|on|with|under|behind|across|against|through|between|beside|from|going|seen|holding|reading|painted|cast)\b/;

function headOfPhrase(e) {
    const t = String(e || "").replace(/^the\s+/i, "").split(PHRASE_TAIL)[0].trim().split(/\s+/);
    return t[t.length - 1] || e
}

/* One plain adjective each. "Flat across" and "on the diagonal" are adverbial
   phrases, so joining them gave "Flat across against on the diagonal" — three
   prepositions in six words. Single adjectives read as a pair. */
/* What two frames of the same kind get called. Build, room, object and
   machine are left out — too broad to be a reason. */
const SAME_KIND = {
    food: "Two meals.",
    animal: "Two creatures.",
    person: "Someone in both.",
    plant: "Both still growing.",
    vehicle: "Two vehicles.",
    sign: "Both telling you something.",
    light: "Both are about light.",
    water: "Two kinds of water.",
    sky: "Look up twice.",
    /* A spill, a drink — anything that pours but is not water. Paired with
       water too: see sameKind() below. */
    liquid: "Both wet."
};

/* Water and liquid count as one kind for the pairing line; a pair with
   liquid on either side gets the liquid line. */
function sameKind(e, t) {
    const n = { water: 1, liquid: 1 };
    return e === t ? e : n[e] && n[t] ? "liquid" : null
}

/* The bare head noun, always short: "the sign", "the boxes". */
function headNounOf(e) {
    let t = (e.short || "").trim();
    if (!t) {
        const n = String(e.subject || "").replace(/^(a|an|the)\s+/i, "").split(/\s+/);
        t = n[n.length - 1] || e.subject
    }
    return /^(the|a|an)\s/i.test(t) ? t.replace(/^(a|an)\s/i, "the ") : "the " + t
}

function nounOf(e) {
    const t = String(e.subject || "").trim().replace(/^(a|an)\s+/i, "");
    if (t && t.split(/\s+/).length <= NOUN_MAX_WORDS) return /^the\s/i.test(t) ? t : "the " + t;
    let n = (e.short || "").trim();
    if (!n) {
        const a = String(e.subject || "").replace(/^(a|an|the)\s+/i, "").split(/\s+/);
        n = a[a.length - 1] || e.subject
    }
    return /^(the|a|an)\s/i.test(n) ? n.replace(/^(a|an)\s/i, "the ") : "the " + n
}

/* "low, right of frame" — from the caption, else from the signature's centre
   of mass.

   Returns "" for the plain centre/middle combination rather than the old
   "dead centre". Across this catalogue the captioner answered "centre" for
   61% of images and "middle" for 89%, which is a default rather than an
   observation — 56% of all images came out as "dead centre". Saying nothing
   is honest; the caller drops the templates that need a position and uses one
   that doesn't. Off-centre answers are rarer and therefore likelier to be
   real, so those still speak. */
function placePhrase(e, t) {
    const n = e.placement || (t && t.cx < .4 ? "left" : t && t.cx > .6 ? "right" : "centre"),
        a = e.height || (t && t.cy < .4 ? "high" : t && t.cy > .6 ? "low" : "middle"),
        o = "left" === n ? "left of frame" : "right" === n ? "right of frame" : "",
        i = "high" === a ? "high" : "low" === a ? "low" : "";
    return i && o ? i + ", " + o : i || o
}

const LINE_MAX = 110;

function fitLines(e, t) {
    const n = e.filter(e => "string" == typeof e && e.trim());
    if (!n.length) return null;
    const a = n.filter(e => e.length <= LINE_MAX);
    return a.length ? pick(a, t) : n.slice().sort((e, t) => e.length - t.length)[0]
}

/* Rough plural test on the head noun, so verbs agree ("the daisies carry"). */
function isPluralNoun(e) {
    const t = (e || "").trim().split(/\s+/).pop() || "";
    return /s$/i.test(t) && !/(ss|us|is|ous|ics|news|glass|grass|bus|lens|series|species)$/i.test(t)
}

/* Plural form of a 3rd-person-singular verb: runs→run, carries→carry, is→are. */
function pluralVerb(e) {
    const t = { is: "are", has: "have", does: "do", was: "were" };
    return t[e] || (/ies$/.test(e) ? e.slice(0, -3) + "y" : /(ss|sh|ch|x|z)es$/.test(e) ? e.slice(0, -2) : /s$/.test(e) ? e.slice(0, -1) : e)
}

/* Plural of a noun, for "two skies" rather than "two skys". Only the last word
   changes. */
const IRREGULAR_PLURAL = { man: "men", woman: "women", child: "children", person: "people", knife: "knives", leaf: "leaves", shelf: "shelves" };

function pluralOf(e) {
    const t = String(e || "").trim().split(/\s+/),
        n = t.pop() || "",
        a = n.toLowerCase();
    let o;
    if (IRREGULAR_PLURAL[a]) o = IRREGULAR_PLURAL[a];
    else if (/[^aeiou]y$/i.test(n)) o = n.slice(0, -1) + "ies";
    else if (/(s|sh|ch|x|z)$/i.test(n)) o = n + "es";
    else o = n + "s";
    return t.concat(o).join(" ")
}

/* Fill "{A} {A:runs} {tempA}; {b} {b:runs} {tempB}." — "{name:verb}" conjugates the
   verb to match the plurality of the noun in slot `name`. Returns null if any
   plain field is missing, so the caller can skip the template. */
function fillTemplate(e, t) {
    let n = !1;
    const a = e.replace(/\{(\w+)(?::(\w+))?\}/g, (e, a, o) => {
        if (o) return t.__plural && t.__plural[a] ? pluralVerb(o) : o;
        const i = t[a];
        return "string" == typeof i && i ? i : (n = !0, "")
    });
    return n ? null : a
}

function composeRichLine1(e, t, n, a, o) {
    const i = capitalizeFirst,
        r = e.subject,
        s = t.subject,
        l = placePhrase(e, n),
        c = placePhrase(t, a),
        d = e.detail,
        h = t.detail;
    return fitLines([
        /* Needs a real position on both sides; skipped when either frame only
           offered the default centre. */
        l && c ? i(r) + ", " + l + "; " + s + ", " + c + "." : null,
        l && !c ? i(r) + ", " + l + "; " + s + " on the right." : null,
        !l && c ? i(r) + " on the left; " + s + ", " + c + "." : null,
        "On the left, " + r + "; on the right, " + s + ".",
        i(r) + " " + pick(["beside", "next to", "against", "and"], o) + " " + s + ".",
        d && h ? i(r) + ", " + d + "; " + s + ", " + h + "." : null,
        d ? i(r) + " on the left, " + d + "; " + s + " on the right." : null,
        h ? i(r) + " on the left; " + s + " on the right, " + h + "." : null,
        e.distance && t.distance && e.distance !== t.distance ? i(r) + " up " + e.distance + ", " + s + " " + ("far" === t.distance ? "at a distance" : "mid" === t.distance ? "at mid range" : "up close") + "." : null
    ], o)
}

/* The relationship line, always naming the left frame first and the right
   second — never "the warmer one first", whichever side that happens to be.

   That ordering is why the descriptors are what swap rather than the subjects.
   Where the old version wrote "{warmer} runs warm; {cooler} runs cool" and let
   the subjects fall wherever the measurement put them, this fixes the subjects
   to left and right and assigns each side the word its own measurement earns.
   Same information, read in the order the eye actually travels. */
/* Conjugate a verb phrase for its own subject: "keeps its colour" becomes
   "keep their colour" when the noun in front of it is plural. Only the leading
   verb and a possessive "its" need touching. */
function conjPhrase(e, t) {
    if (!t) return e;
    const n = e.split(" ");
    return n[0] = pluralVerb(n[0]), n.join(" ").replace(/\bits\b/g, "their")
}

/* The reason the pair was chosen, and nothing else.

   No description of what is in the frames: a viewer can already see that. The
   subjects are named only where the reason needs them — quoted words, a shared
   noun, a size gap — or where the pattern hinges on one side and saying which
   makes it concrete ("The pasta crowded, the sky clear").

   Caption-driven reasons come first because they are the ones the colour
   metrics cannot reach, and they are what the scoring weights most heavily.
   The commonest colour reasons carry two or three phrasings, picked off the
   pair's own seed so a given pair always reads the same way. */
const REASON = {
    P1: ["Nothing in common."],
    P2: ["Both bright."],
    P2b: ["Both pale, in the same light."],
    P3: ["Both dark, different colour."],
    P3b: ["The same dark twice."],
    P9: ["One palette, two exposures."],
    P13: ["Colour is the only difference."],

    P17: ["Both loud, aimed apart."],
    P17c: ["The same horizon."]
};

function composeRichLine2(e, t, o, n, a, i, skipCaptionRules) {
    const r0 = capitalizeFirst;
    const r = capitalizeFirst;
    if (n && a && !skipCaptionRules) {
        /* The words are not said.

           A sign in one frame and a sign in the other is something any eye can
           already read off the pictures, so stating it tells the viewer nothing
           they did not have. The why line is for the relationship they cannot
           see — the palette, the form, the kind of thing.

           The text terms in pairScore are untouched: words still bring pairs
           together, they are just no longer given as the reason. */
        /* Same subject twice — naming it is the whole point of the pairing. */
        const h = (n.short || "").toLowerCase(),
            u = (a.short || "").toLowerCase();
        /* "Two roses" for two photographs of roses counts the flowers, not the
           frames — and there are dozens in each. A noun that is already plural
           gets no number in front of it. */
        /* Each other's first choice out of the whole catalogue. Rarest thing
           the site knows and the only one that is about the pairing rather
           than the pictures, so it is said before anything else. */
        if (whyPairSrcs && mutualBests.has(whyPairSrcs[0] + "|" + whyPairSrcs[1])) return "Nothing pairs better.";
        /* Both subjects pressed up against the seam, leaning into the gap
           between the frames. Read from where each frame's weight actually
           falls, not from the caption. Four pairs in the catalogue. */
        if (t.cx >= .56 && o.cx <= .44) return "They lean together.";
        if (h && h === u) return "Same thing somewhere else.";
        /* Same kind of thing, different thing. A pot of soup and a table of
           finished plates share no noun, so the same-subject rule misses them,
           and the form-rhyme rule needs the categories to DIFFER — so two meals
           had no way to be called two meals. Only the categories specific
           enough to mean something: "both buildings" says nothing. */
        /* Two skies at different hours: a crane under a midday sky beside
           street lights at dusk. "sky": true marks a frame with sky in it;
           "time" is day, golden hour, dusk or night. */
        if (n.sky && a.sky && n.time && a.time && n.time !== a.time) return "Skies hours apart.";
        /* What the words DO between them is a reason; the mere fact of
           lettering is not. The scoring already reads these relationships
           (captionScore), so the pairs exist — these lines name what it found:
           opposed words, the same word twice, a word in common. */
        if (n.text && a.text) {
            const wL = textWords(n.text),
                wR = textWords(a.text);
            if (textOpposed(wL, wR)) return "One says the opposite.";
            if (textKey(n.text) === textKey(a.text)) return "The same words twice.";
            if ([...wL].some(e2 => wR.has(e2))) return "A word in common.";
        }
        const kind = sameKind(n.category, a.category);
        /* Plants: growing, or picked — cut flowers in a vase, greens on a
           market crate. "picked": true or false in the caption; a frame
           without it could be either, so the pair gets the line that holds
           for both. */
        if ("plant" === kind && h !== u) {
            const pL = n.picked,
                pR = a.picked;
            return "boolean" != typeof pL || "boolean" != typeof pR ? "Seed first." : pL && pR ? "Both picked." : pL || pR ? pL ? "Picked and still growing." : "Still growing and picked." : "Both still growing."
        }
        if (kind && SAME_KIND[kind] && h !== u) return SAME_KIND[kind];
        const m = SCALE_RANK[n.scale],
            g = SCALE_RANK[a.scale];
        /* The full range only — something you could hold against a whole
           landscape. At three steps this fired on a third of every pair in the
           catalogue, and a framing joke told that often stops being one. */
        if (void 0 !== m && void 0 !== g && Math.abs(m - g) >= 4) return "Size lies.";
        if (n.hands && a.hands) return "Hand and hand.";
        /* Anatomy, the wider rule under hands. A hand, an arm, a face, a
           painted figure, a carved torso — a body in both frames is a real
           relationship even when the hands rule is too narrow to catch it.
           Read from the people field, which was set while looking at each
           frame, rather than inferred from the caption's wording. */
        /* A whole figure and a piece of one are not the same claim. Two hands
           are "a part of someone in each"; two standing people are "someone in
           both frames". Saying the second about a wrist and a forearm was the
           complaint. */
        const bodyL = n.people && "none" !== n.people && "unclear" !== n.people,
            bodyR = a.people && "none" !== a.people && "unclear" !== a.people;
        if (bodyL && bodyR) {
            const wholeL = "figure" === n.people || "many" === n.people,
                wholeR = "figure" === a.people || "many" === a.people;
            return wholeL && wholeR ? "A figure in each." : wholeL || wholeR ? "One whole, one in part." : "Anatomy in both."
        }
        /* The same accent twice. Placed above structure because a colour
           repeating across two unrelated frames is the more startling of the
           two — it is the thing you notice without looking for it. */
        if (n.accent && n.accent === a.accent && (n.short || "").toLowerCase() !== (a.short || "").toLowerCase()) return "The same " + n.accent + " twice.";
        /* Structure reads before subject: two lattices look like each other
           long before you notice one is scaffolding and one is shelving. */
        if (n.structure && n.structure === a.structure && (n.short || "").toLowerCase() !== (a.short || "").toLowerCase()) {
            /* Both lattice and grid are called grids in the prose. The two are
               worth keeping apart in the data — a scaffold is not a tiled wall —
               but "lattice" is a builder's word, and a viewer sees a grid. */
            /* Lines are their own case. Wires, cables, contrails, a shadow
               thrown across a wall — thin dark marks over a plain ground, which
               a viewer reads before anything else in the frame. The other
               phrasings count ("two grids"), and lines are never countable. */
            if ("lines" === n.structure) return "Lines.";
            const st = { lattice: "grid", grid: "grid", stack: "stack" } [n.structure];
            return capitalizeFirst(pluralOf(st)) + " on both sides."
        }
        /* Direction. The captions carry it and nothing was saying it: a
           contrail cutting across the frame against a lamp post standing
           straight up is a plain visual fact, and the sort a viewer notices
           first. Only the three genuine oppositions count — curved against
           anything is too soft to be worth a sentence, and 39% of pairs have
           one of these, so it sits below the caption-specific reasons and
           above the colour patterns. */

        /* Words on one side are not said. A sign in one frame and none in the
           other describes a frame, not a relationship, and a why line should
           only ever give the reason two photographs are together. */
        /* Colour against black and white, and complementary colour. Both are
           pairing principles rather than descriptions, so they sit above the
           looser colour patterns.

           Computed here rather than read from the const block below: that block
           runs after this chain, so referencing it from here throws. */
        const cnL = dominantColourName(t),
            cnR = dominantColourName(o),
            /* Family names for the shared-colour test: "blue" has to match
               "blue" even when one is slate and the other is sky. */
            cnL0 = dominantHueLabel(t),
            cnR0 = dominantHueLabel(o),
            /* Black and white needs two things: a low average AND no swatch
               with real colour in it. A red sweet wrapper on a white table
               averages .022, because the white fills the frame — but the
               wrapper is chroma .144, and no one would call that photograph
               black and white. */
            hasChroma = e2 => (e2.palette || []).some(e3 => e3.oklab && Math.hypot(e3.oklab.a, e3.oklab.b) >= .09 && (e3.weight || 0) >= .1),
            /* .02. At .045 a scaffold in grey daylight qualified — a colour
               photograph of a colourless thing, which is not the same as a
               black-and-white one. Only frames with essentially no colour at
               all get the words. */
            mL = t.mono || (t.avgSat || 0) < .02 && !hasChroma(t),
            mR = o.mono || (o.avgSat || 0) < .02 && !hasChroma(o);
        /* One side must be monochrome AND the other must have a colour worth
           naming. Black denim with a brass zip sits at .16 saturation — over
           the monochrome line, but its dominant swatch has a chroma of .030,
           which is grey. Saying "colour against black and white" about two dark
           frames claims something neither of them has. */
        /* The same colour in both, even when it is the whole of one frame and a
           detail of the other: a blue wall behind model planes and a blue bag
           dropped on grass. The accent rule above only compares accent with
           accent, so this pairing had no way to be seen. */
        const setL = [cnL0, n.accent, detailColour(t)].filter(Boolean),
            setR = [cnR0, a.accent, detailColour(o)].filter(Boolean),
            sharedCol = setL.find(e2 => setR.includes(e2));
        if (sharedCol && (cnL0 !== cnR0 || n.accent || a.accent) && (n.short || "").toLowerCase() !== (a.short || "").toLowerCase()) return capitalizeFirst(pluralOf(sharedCol)) + ".";
        /* Left frame first, like every other ordered line: the skeleton is the
           black-and-white one, so it is the one named first. These were fixed
           strings and always put colour ahead of monochrome regardless of which
           side each was on. */
        if (mL !== mR && (mL ? cnR : cnL)) return "One forgot its colour.";
        if (cnL && cnR && cnL !== cnR) {
            const sL = representativeSwatch(t),
                sR = representativeSwatch(o);
            let gap = sL && sR ? Math.abs(sL.hsl.h - sR.hsl.h) : 0;
            gap > 180 && (gap = 360 - gap);
            /* The frame's own main colour has to be solid — not any swatch in
               the palette. Testing "some swatch" let a small vivid accent
               qualify a frame whose actual colour is dull, so two pictures were
               called complementary on the strength of details. */
            const solid = e2 => {
                const e3 = representativeSwatch(e2);
                return !!e3 && e3.hsl.s >= .5 && e3.hsl.l >= .22 && e3.hsl.l <= .88
            };
            if (gap >= 140 && solid(t) && solid(o)) return "Complementarity."
        }
        /* A shared geometry. Named before the curve rule, which is a coarser
           version of the same idea; and rectangles are excluded here too. */
        /* The shape line never names the subjects. shape records a geometry
           present in the frame, not the form of the thing photographed: the
           circle in a pot of soup is the ladle, and in a plate of oysters it
           is the plate. "Two circles: the soup and the oysters" claims a
           roundness neither subject has. Naming the shape alone is true of
           every frame that carries one. */
        if (n.shape && n.shape === a.shape && "rectangle" !== n.shape && (n.short || "").toLowerCase() !== (a.short || "").toLowerCase()) return "A rhyme in shape.";
        /* A shared material. Two frames of concrete, or brick, or marble, are
           made of the same stuff however different their subjects — and the
           surface field has carried this all along without anything reading it.
           Only materials worth naming: "painted" and "plastic" describe half
           the catalogue. */
        const MATERIALS = ["concrete", "brick", "marble", "timber", "denim", "steel", "glass", "tile", "render", "card", "paper"],
            /* Whole words: "painted fibreglass" was being read as glass. */
            hasMat = (e2, t2) => new RegExp("\\b" + t2 + "\\b", "i").test(e2 || ""),
            matL = MATERIALS.find(e2 => hasMat(n.surface, e2)),
            matR = MATERIALS.find(e2 => hasMat(a.surface, e2));
        if (matL && matL === matR && (n.short || "").toLowerCase() !== (a.short || "").toLowerCase()) return capitalizeFirst(matL) + " in each.";
        /* Numbers, and words. The text field records what a frame says; two
           frames that both carry digits, or both carry lettering, have that
           between them whatever else differs. The words themselves are not
           quoted — naming them was too much detail for a reason. */
        const digL = /\d/.test(n.text || ""),
            digR = /\d/.test(a.text || "");
        /* A logo in each reads before the words do: RENAULT on a lorry and
           ATLAS on a crane are marks, not text, and "Words in both" undersold
           them. Set "logo": true in a caption to join. */
        if (n.logo && a.logo) return "A logo in each.";
        if (digL && digR) return "Numbers in both.";
        /* Lettering in both is NOT a reason on its own. It was the site's most
           common line by far — a fifth of every pair — and "both have writing
           on them" is the weakest thing two photographs can have in common.
           The scoring still brings text frames together (captionScore rewards
           opposed words, echoed words and repeated words), so those pairs
           still happen; they now have to earn a reason from what else they
           share, which is the stronger claim anyway. */
        /* A shared curve. The direction rule below only speaks when the lines
           oppose, so a parabolic arch against an oval bowl — the same shape in
           two unrelated worlds — got nothing but a colour line. Curves are rare
           enough in the catalogue (one frame in six) for two of them to be a
           real rhyme. */
        if ("curved" === n.lines && "curved" === a.lines) return "Curves.";
        /* Two geometries against each other. The shape field records a form
           present in the frame, not the outline of the subject, so the line
           names the forms and nothing else. */
        if (n.shape && a.shape && n.shape !== a.shape) {
            const SH = { circle: "Round", rectangle: "Square", triangle: "Pointed" },
                e2 = SH[n.shape],
                t2 = SH[a.shape];
            if (e2 && t2) return e2 + " and " + t2.toLowerCase() + ".";
        }
        /* One frame looked up at, one looked down at — named in screen order,
           like every other ordered line, so the first word belongs to the
           frame on the left. */
        if ("high" === n.height && "low" === a.height) return "Look up look down.";
        if ("low" === n.height && "high" === a.height) return "Look down look up.";
        /* A shadow in the picture, in both. Hard sun alone was not enough — a
           tower against a clear sky is lit hard and casts nothing the viewer
           can see. The captions have to say a shadow, or deep shade, is there. */
        const SHADOW = e2 => /shadow|\bshade\b/i.test([e2.light, e2.subject, e2.detail].join(" ")) && !/no shadow/i.test(e2.light || "");
        if (SHADOW(n) && SHADOW(a)) return "Two shadows.";
        /* The same light, described in the same words while looking at two
           unrelated things — a coincidence of conditions, not of subject. */
        if (n.light && n.light === a.light && h !== u) return "The same light twice.";
        /* Direction used to be named here — "upright against diagonal" and the
           like. Removed: judging a frame's inclination from a caption proved
           unreliable, and two frames running at visibly the same angle were
           being set against each other as opposites. A claim that cannot be
           trusted is worse than no claim, so nothing in the prose now says
           anything about which way a picture leans. */
    }
    const { id: s } = { id: e },
        /* Which frame leads on the axis the pattern turns on, so a variant can
           name it rather than stating the contrast in the abstract. */
        l = representativeSwatch(t),
        p = representativeSwatch(o),
        f = (l && l.hsl ? l.hsl.s : 0) >= (p && p.hsl ? p.hsl.s : 0),
        y = t.density >= o.density,
        L2 = t.meanL >= o.meanL,
        WM = (l ? l.oklab.b : 0) >= (p ? p.oklab.b : 0),
        /* One frame has to actually be dark before the word is used. */
        /* Night is darkness, not a dark colour: a deep blue fence in flat
           daylight sits at .21 lightness but is fully saturated, and calling
           it night was wrong. The dark side has to be dim AND close to
           colourless. */
        reallyDark = Math.min(t.meanL, o.meanL) < .35 && Math.abs(t.meanL - o.meanL) >= .25 && (t.meanL < o.meanL ? t : o).avgSat < .55,
        /* Day and night are hours, not lightness. A paint tube under studio
           light is not day, and a car interior in hard sun is not night — so
           the words are only used when the captions allow them: the dark frame
           with no sun or daylight in it, the light frame outdoors. */
        SUNLIT = e2 => !!e2 && (!!e2.sky || /\bsun\b|sunlit|daylight|clear sky|overcast|sunset/i.test(e2.light || "")),
        /* And a dark interior is not night either: an escalator under strip
           lights is dim, not late. */
        UNLIT = e2 => !!e2 && !SUNLIT(e2) && !/interior|indoor|gallery|shop light|strip|fluoresc|kitchen|bathroom|workshop|studio|pendant|lamp/i.test(e2.light || ""),
        dayNightOK = reallyDark && (t.meanL < o.meanL ? UNLIT(n) && SUNLIT(a) : UNLIT(a) && SUNLIT(n)),
        /* Does the frame hold a colour a viewer would call strong? avgSat is an
           area-weighted mean, so a few vivid roses in a lot of dark foliage
           average out to a low number and the pair gets called low-colour. The
           palette knows better. Very dark and very pale swatches are excluded:
           a near-black navy reads as fully saturated in HSL and is not what
           anyone means by colour. */
        strong = e2 => (e2.palette || []).some(e3 => e3.hsl.s >= .5 && e3.hsl.l >= .22 && e3.hsl.l <= .88 && e3.weight >= .12),
        strongL = strong(t),
        strongR = strong(o),
        /* "All the colour on one side" needs a real gap, not a small vivid
           patch in an otherwise muted frame beside another muted frame: an
           agave in a planter and scaffolding on brick both sit near .11
           saturation, and the line was being said about them. */
        /* "All the colour on one side" is a claim about the OTHER side having
           none, so it is measured on the strongest colour each frame actually
           shows — any swatch big enough to notice, not the area-weighted mean.
           A white van with a red light, or a footpath with a green verge, has
           colour in it and does not qualify. */
        chromaShown = e2 => Math.max(0, ...(e2.palette || []).filter(e3 => e3.oklab && e3.weight >= .08).map(e3 => Math.hypot(e3.oklab.a, e3.oklab.b))),
        cShownL = chromaShown(t),
        cShownR = chromaShown(o),
        colourGap = Math.max(cShownL, cShownR) >= .13 && Math.min(cShownL, cShownR) < .1 && Math.abs(cShownL - cShownR) >= .1 && !detailColour(cShownL > cShownR ? o : t),
        /* Warm and cool are only worth saying when the two hues genuinely sit
           on opposite sides of it. Oklab's b axis runs blue to yellow, so green
           lands on the positive side and gets called warm — a green field under
           a blue sky was reading as "warm and crowded". Green, teal and violet
           are the ambiguous middle: when either frame is one of them, the pair
           is described by hue instead, which is both true and more specific. */
        /* The caption has the last word on warmth. A flaking apricot board
           against a blue wheel measures warm and was captioned "mixed", which
           is what it is; the measurement should not overrule what was written
           while looking at the picture. */
        tempWritten = e2 => !e2 || !e2.temp || "mixed" !== e2.temp,
        hFamL = dominantHueLabel(t),
        hFamR = dominantHueLabel(o),
        hL = dominantColourName(t),
        hR = dominantColourName(o),
        dL = detailColour(t),
        dR = detailColour(o),
        WARM_HUES = ["red", "orange", "gold", "pink"],
        COOL_HUES = ["blue", "teal"],
        tempOK = hFamL && hFamR && hL && hR && (WARM_HUES.includes(hFamL) && COOL_HUES.includes(hFamR) || COOL_HUES.includes(hFamL) && WARM_HUES.includes(hFamR)) && tempWritten(n) && tempWritten(a),
        /* The side about to be called hot must not be a cool or in-between
           family, and the cold side not a warm or in-between one. */
        tempFree = (WM ? !hFamL || WARM_HUES.includes(hFamL) : !hFamL || COOL_HUES.includes(hFamL)) && (WM ? !hFamR || COOL_HUES.includes(hFamR) : !hFamR || WARM_HUES.includes(hFamR)),
        /* Must require the display names too: dominantColourName applies a
           chroma gate that dominantHueLabel does not, so the family can be
           known while the name is null — which printed "null and red." */
        hueOK = hFamL && hFamR && hL && hR && hL !== hR,
        /* "No colour in common" was firing on a red palette against an orange
           one — two plates of the same warm food, palette contrast .062, about
           as close as two photographs get. A difference in hue LABEL is not a
           difference in colour: red and orange are neighbours on the wheel and
           the boundary between them is arbitrary. The claim now needs the
           families to be genuinely far apart AND the palettes to agree that
           they are. */
        HUE_ADJACENT = {
            red: ["orange", "pink"],
            orange: ["red", "gold"],
            gold: ["orange", "green"],
            green: ["gold", "teal"],
            teal: ["green", "blue"],
            blue: ["teal", "violet"],
            violet: ["blue", "pink"],
            pink: ["violet", "red"]
        },
        hueFar = hueOK && !(HUE_ADJACENT[hFamL] || []).includes(hFamR) && paletteContrastOf(t, o) >= .3,
        /* "Both warm" is a claim about whole frames, so both frames have to
           have enough colour for it to mean anything. A grey wall with a prism
           on it measures warm because the prism's highlight is the strongest
           swatch — the same reason a frame this close to monochrome gets no hue
           name. The same floor applies. */
        tempSayable = (t.avgSat || 0) >= MIN_FRAME_SAT && (o.avgSat || 0) >= MIN_FRAME_SAT && tempWritten(n) && tempWritten(a),

        VT = t.vertical >= o.vertical,
        TL = t.aspect <= o.aspect,
        /* Descriptor pairs, always in screen order: index 0 describes the left
           frame. The bare reasons below read straight off these, so a line like
           "Cool and clear against warm and crowded" follows the pictures rather
           than naming whichever side happens to be warm. */
        d2 = (e, t2, n2) => n2 ? [e, t2] : [t2, e],
        [tw1, tw2] = d2("warm", "cold", WM),

        [li1, li2] = d2("day", "night", L2),
        [br1, br2] = d2("bright", "dark", L2),
        /* These describe density, which is the entropy of a seven-bin colour
           histogram — how widely spread the colours are, not how much is in
           the frame. "Crowded" and "empty" were the wrong English for it: a
           building site behind a flat white hoarding scores lower than an empty
           white corner, because the hoarding concentrates colour and the
           corner's shading spreads it. Colour-variety words are what the
           measurement actually supports. */
        [em1, em2] = d2("several colours", "one", y),
        /* The one/many phrasing sounds absolute while the measurement is only
           comparative, so two photographs of blue sky could come out as "many
           colours" against "one" on a gap that is real but small. It is only
           used when the varied frame is genuinely varied and the plain one
           genuinely plain — above the median and inside the bottom tenth of
           this catalogue respectively. Everything else takes another line. */
        countOK = Math.max(t.density, o.density) >= .8 && Math.min(t.density, o.density) <= .6,
        [co1, co2] = d2("colour", "none", f),
        [vt1, vt2] = d2("upright", "across", VT),
        [vn1, vn2] = d2("verticals", "horizontals", VT),
        [as1, as2] = d2("tall", "wide", TL),
        w = n && a ? (f ? nounOf(n) : nounOf(a)) : "",
        b = n && a ? (f ? nounOf(a) : nounOf(n)) : "",
        S = n && a ? (y ? nounOf(n) : nounOf(a)) : "",
        E = n && a ? (y ? nounOf(a) : nounOf(n)) : "",
        LT = n && a ? (L2 ? nounOf(n) : nounOf(a)) : "",
        DK = n && a ? (L2 ? nounOf(a) : nounOf(n)) : "",
        /* Fixed to position, not to any measurement: L is whatever is on the
           left of the screen. The variants below swap the predicate around
           these, which is what keeps the sentence matching the picture. */
        L = n ? nounOf(n) : "",
        R = a ? nounOf(a) : "",
        /* Verb agreement, judged on the caption's own head noun: "the tram
           wires take", not "takes". */
        pL = n ? isPluralNoun(headOfPhrase(L)) : !1,
        pR = a ? isPluralNoun(headOfPhrase(R)) : !1,
        vL = (e, t) => pL ? t : e,
        vR = (e, t) => pR ? t : e,
        v = {
            /* Every named variant reads left frame first and swaps the
               predicate, never the subjects. Ordering by attribute put the lit
               frame first wherever it sat, so a reader mapping the first name
               to the left-hand picture was told the opposite of what they were
               looking at. */
            P4: [tempOK ? r(tw1) + " and " + tw2 + "." : null,
                hueOK ? r(hL) + " and " + hR + "." : null,
                /* Same gate as P8 and P9 — this one was missed, so "Lit against
                   dark" still fired on a frame at .42 lightness. */
                dayNightOK ? r(li1) + " and " + li2 + "." : null,
                /* A lightness gap short of real darkness: the plain pair of words. */
                reallyDark || Math.min(t.meanL, o.meanL) >= .4 ? null : L2 ? "Light and dark." : "Dark and light."],
            /* P5's two lines both need a nameable colour on each side. Where
               one frame is too muted to name — scaffold poles in grey render
               beside a fully saturated blue fence — the pattern had nothing
               left and the pair fell all the way to "Small differences", which
               is not what a viewer would say about it. The difference in how
               much colour each frame carries IS the pair. */
            P5: [tempOK ? r(tw1) + " and " + tw2 + "." : null,
                hueOK ? r(hL) + " and " + hR + "." : null,
                colourGap ? "All the colour on one side." : null],
            P6: [tempOK ? r(tw1) + " and " + tw2 + "." : null,
                hueOK ? r(hL) + " and " + hR + "." : null,
                /* One frame has a colour, the other only a detail of one. */
                /* "In the dark" was describing frames at .5 lightness. The
                   detail is small and the frame around it is plain; neither of
                   those is darkness. */
                /* Left frame first, like every other ordered line. This one
                   always led with whichever frame had the dominant colour,
                   so a red detail on the left was announced after the blue on
                   the right. */
                /* Was "Blue on the left, just a thread of red on the right" —
                   nine words to say what two do. The side each colour is on is
                   plain to see; only the pairing needs saying. */
                hL && !hR && dR ? capitalizeFirst(hL) + " and " + dR + "." : null,
                hR && !hL && dL ? capitalizeFirst(dL) + " and " + hR + "." : null,
                tempOK && L && R ? r(L) + " " + vL("runs", "run") + " " + tw1 + ", " + R + " " + vR("runs", "run") + " " + tw2 + "." : null,
                hueOK && L && R ? r(L) + " " + vL("is", "are") + " " + hL + ", " + R + " " + vR("is", "are") + " " + hR + "." : null,
                /* Last resort, and stated plainly. P6 is selected on a real
                   temperature gap, so the absolute words are earned even where
                   neither hue can be named — one frame is cool and the other
                   warm, and the comparative form only made that sound less
                   certain than it is. */
                /* Only where neither frame's colour family argues with the word:
                   oklab's warm axis runs through green, so a green field was
                   being called hot. */
                /* And never about a frame with too little colour to be warm or cold at
                   all: a grey render was being called warm. */
                tempOK || hueOK || !tempFree || !tempSayable ? null : r(tw1) + " and " + tw2 + "."],
            P7: [dayNightOK ? r(li1) + " and " + li2 + "." : null],
            /* Same floor as P11: the one/many wording is only honest on a wide
               density gap. */
            P10: [
                hueFar ? "No colour shared." : null],
            P17d: [r(as1) + " against " + as2 + "."],
            /* Both-warm and both-cool need both frames to hold enough colour
               for the claim to mean anything; see tempSayable above. */
            P14: [tempSayable && [hFamL, hFamR].every(e2 => !e2 || WARM_HUES.includes(e2)) ? "Both warm." : null,
                tempSayable && hueOK ? r(hL) + " and " + hR + "." : null],
            P15: [tempSayable && [hFamL, hFamR].every(e2 => !e2 || COOL_HUES.includes(e2)) ? "Both cool." : null,
                tempSayable && hueOK ? r(hL) + " and " + hR + "." : null],
            P11: [
                /* Say what the measurement means in the plainest words there
                   are: it counts colours, so the line should say colours. */


                y ? "A gaze and a glance." : "A glance and a gaze."],
            P8: [dayNightOK ? r(li1) + " and " + li2 + "." : null,
                /* A lightness gap short of real darkness: the plain pair of words. */
                reallyDark || Math.min(t.meanL, o.meanL) >= .4 ? null : L2 ? "Light and dark." : "Dark and light."],
            /* P9 is a lightness split, nothing more: the selector allows palette
               contrast up to .55, so calling it "the same palette" was a claim
               the pattern never made — a pink neon against a grey sky qualifies. */
            /* "In shadow" says why a frame is dark; a wall painted black is
               dark without a shadow anywhere. And the absolute words need a
               genuinely dark frame — .46 lightness against .77 is not "dark
               against bright", it is one frame lighter than the other. */
            P9: [dayNightOK ? r(li1) + " and " + li2 + "." : null,
                L && R && reallyDark ? r(L) + (L2 ? " " + vL("catches", "catch") + " the light, " : " " + vL("holds", "hold") + " the dark, ") + R + (L2 ? " " + vR("holds", "hold") + " the dark." : " " + vR("catches", "catch") + " the light.") : null,
                /* A lightness gap short of real darkness: the plain pair of words. */
                reallyDark || Math.min(t.meanL, o.meanL) >= .4 ? null : L2 ? "Light and dark." : "Dark and light."],
            P3b: ["The same dark twice."],
            P12: [
                /* Exactly one side, not either side: the claim is that the
                   colour is on ONE of them. Two warm brick frames both have
                   colour, and saying it sits on one was simply false. And the
                   plain side must be plain: a framed print of a red apple has
                   its colour in one small place, but it has it. */
                strongL !== strongR && !(strongL ? detailColour(o) : detailColour(t)) ? "All the colour on one side." : null,
                /* Only say a frame carries the colour when it holds one a
                   viewer would call strong. */
                w && (f ? strongL : strongR) && !(f ? detailColour(o) : detailColour(t)) ? "The colour sits with " + w + "." : null],
            P12b: [hueFar ? "No colour in common." : null,
                hueOK ? r(hL) + " and " + hR + "." : null],
            P12c: ["A shade apart."],
            /* Only claim low colour when the palettes agree with the average:
               vivid roses in dark foliage average low but are not quiet. */
            P16: [],
            /* The signature's verticality and the caption's lines field can
               disagree; when they do, say nothing about direction. */
            /* This pattern used to name the direction too — "upright against
               across", and "one leans one way, one the other". All of it is a
               claim about inclination, which is the thing being withdrawn, so
               the pattern falls back to what it can still say honestly. */
            P17b: ["Neither one insists."],
            /* P18 is the terminal else in selectWhyPattern — the bucket a pair
               falls into when no axis crossed its threshold. That is "nothing
               stood out", not "these are nearly identical", and the old wording
               claimed the strongest similarity in the set for pairs that had
               merely failed to be interesting in any particular way. */
            P18: ["Small differences."],
            PMONO: [strongL !== strongR && !(strongL ? detailColour(o) : detailColour(t)) ? "One forgot its colour." : null,
                strongL !== strongR && !(strongL ? detailColour(o) : detailColour(t)) ? "All the colour on one side." : null,
                L && R ? r(L) + (f ? " in colour, " : " in grey, ") + R + (f ? " in grey." : " in colour.") : null]
        },
        T0 = (v[s] || REASON[s] || REASON.P18).filter(Boolean);
    let T = T0;
    /* Before giving up: claims that hold for any pair but were only being
       made inside particular patterns, so a pair routed elsewhere missed
       them. An escalator under strip lights beside a gable in full sun is
       "Indoors and out" whatever its palette said. */
    if (!T.length || 1 === T.length && "Small differences." === T[0]) {
        /* A canteen lit by daylight and pendant globes is indoors: the room
           it is decides that, not the word "daylight" in its light. */
        const INSIDE = e2 => "room" === e2.category || /interior|indoor|gallery|shop light|strip|fluoresc|kitchen|bathroom|workshop|pendant|lamp/i.test(e2.light || ""),
            OUTSIDE = e2 => !INSIDE(e2) && (e2.sky || /\bsun\b|sunset|daylight|overcast|dusk|fog|open sky/i.test(e2.light || "")),
            inL = n && INSIDE(n), inR = a && INSIDE(a),
            outL = n && OUTSIDE(n), outR = a && OUTSIDE(a),
            F = [colourGap ? "All the colour on one side." : null,
                inL && outR && !outL ? "Indoors and out." : inR && outL && !outR ? "Outdoors and in." : null,
                /* The darker side has to be dark, not merely darker: a woman
                   running in a field at .47 lightness is not the dark half of
                   anything. */
                !reallyDark && Math.abs(t.meanL - o.meanL) >= .25 && Math.min(t.meanL, o.meanL) < .4 ? L2 ? "Light and dark." : "Dark and light." : null,
                /* Screen order, like every other ordered line. */
                n && a && "close" === n.distance && "far" === a.distance ? "Near and far." : n && a && "far" === n.distance && "close" === a.distance ? "Far and near." : null
            ].filter(Boolean);
        F.length && (T = [F[0]])
    }
    /* One reason per pair, not a seeded choice between phrasings: where more
       than one line is valid, the shortest is the one said. A rule whose
       every line is gated off falls through to P18 rather than to nothing. */
    return shortestLine(T.length ? T : v.P18)
}

function shortestLine(e) {
    const t = e.filter(e => "string" == typeof e && e.trim());
    return t.length ? t.reduce((e, t) => t.length < e.length ? t : e) : null
}



/* No punctuation in a reason. The line is a caption, not a sentence, and the
   full stops and commas were doing nothing but sitting there. Applied once at
   the point of display so none of the phrasings has to change. A hyphen
   between two words becomes a space; an apostrophe inside a word stays. */
function stripPunctuation(e) {
    return e ? e.replace(/(\p{L})-(?=\p{L})/gu, "$1 ").replace(/(^|[^\p{L}])['’]|['’](?=[^\p{L}]|$)/gu, "$1").replace(/[^\p{L}\p{N}\s'’]/gu, "").replace(/\s+/g, " ").trim() : e
}

/* Every "in both" line has a second form, "left and right", and each pair
   keeps one of the two — decided by the pair's own seed, so a given pair
   always reads the same way. */
function bothOrSides(e, t) {
    return e && / in both\.$/.test(e) && 1 & t >>> 7 ? "Someone in both." === e ? "Someone." : e.replace(/ in both\.$/, " left and right.") : e
}

/* The srcs of the pair being explained, set by the two callers below. The why
   line is otherwise composed from signatures and captions alone, and a couple
   of rules need to know WHICH photographs these are — whether they are each
   other's best match, for one. */
let whyPairSrcs = null;

function composeWhyText(e, t, n, a) {
    const o = whySeed(e, t),
        i = Math.imul(2654435769 ^ o, 2654435761) >>> 0,
        { id: r } = selectWhyPattern(e, t);
    if (n && a) {
        const s = composeRichLine1(n, a, e, t, o),
            l = bothOrSides(composeRichLine2(r, e, t, n, a, i), i);
        /* Third element flags the caption path: there, line 1 is description
           and line 2 is the reason, so line 2 can stand alone. The colour-only
           fallback below splits the other way round and needs both lines. */
        if (s && l) return [s, l, !0]
    }
    return renderWhy(r, e, t, o)
}

function showWhy() {
    /* The gesture has been used, so the line naming it has done its job —
       clicking already removed it, swiping up did not. */
    hideClickHint();
    if (!whyEl) return;
    if (whyEl.classList.contains("visible")) return;
    const e = currentPairSrcsFromHash();
    if (!e) return;
    const [t, n] = e, a = colorSignatures.get(t), o = colorSignatures.get(n);
    if (!a || !o) return;
    if (a.isFallback || o.isFallback) return;
    whyPairSrcs = e;
    const i = subjectFor(t),
        r = subjectFor(n),
        [s, l, richMode] = composeWhyText(a, o, i, r);
    whyPairSrcs = null;
    /* With captions, line 1 names what is in the frames and line 2 says why
       they are together — and line 2 names the subjects itself ("the pint and
       the sign, both pale"), so it reads perfectly well on its own. Showing
       only the reason is the stronger panel.

       The colour-only fallback is built the other way round: its first line
       carries the substance ("Vivid red against a more restrained
       counterpart") and its second is a closer ("Everything else falls
       away") that says nothing by itself. So both lines stay in that case.
       Set WHY_REASON_ONLY to false to always show both. */
    /* why-line-1 was removed from the page; only the reason line remains. */
    whyLine1El && (whyLine1El.textContent = WHY_REASON_ONLY && richMode ? "" : stripPunctuation(s)), whyLine2El.textContent = stripPunctuation(l);
    let c = !!window.__diag;
    if (!c) try {
        c = "1" === localStorage.getItem("diptychDiag")
    } catch (e) {}
    if (!c) try {
        c = /[?&]dbg=1\b/.test(location.search)
    } catch (e) {}
    if (c) {
        const e = e => (String(e).match(/ff(\d+)/) || [])[1] || e,
            i = e => {
                const t = representativeSwatch(e),
                    n = t && t.oklab ? Math.hypot(t.oklab.a, t.oklab.b) : 0,
                    a = t && t.hsl ? Math.round(t.hsl.h) + "/" + t.hsl.s.toFixed(2) + "/" + t.hsl.l.toFixed(2) : "-",
                    o = t && t.hsl ? t.hsl.s : 0;
                return describeSwatch(e) + " [hsl " + a + " chroma " + n.toFixed(3) + " peakSat " + o.toFixed(2) + " | avgSat " + (e.avgSat || 0).toFixed(2) + " meanL " + (e.meanL || 0).toFixed(2) + "]"
            },
            /* Caption keys and subjects alongside the colour data, so a
               mismatch between the manifest and the images on screen is
               visible rather than inferred: if the subject printed for ff102
               isn't what ff102 actually shows, the manifest is stale. */
            c2 = e => {
                const t = subjectKey(e),
                    n = t && subjects.get(t);
                return t + " = " + (n ? n.subject + (n.short ? " (" + n.short + ")" : "") : "NO CAPTION")
            },
            r = "[" + selectWhyPattern(a, o).id + "] ff" + e(t) + " = " + i(a) + "   ||   ff" + e(n) + " = " + i(o) + "\n   captions: " + c2(t) + "   ||   " + c2(n);
        console.log(r);
        let s = document.getElementById("diptych-dbg");
        s || (s = document.createElement("div"), s.id = "diptych-dbg", s.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:99999;font:11px/1.4 ui-monospace,Menlo,monospace;color:rgba(255,255,255,0.78);background:rgba(0,0,0,0.55);padding:5px 8px;border-radius:4px;max-width:96vw;white-space:pre-wrap;pointer-events:none;letter-spacing:0;", document.body.appendChild(s)), s.textContent = r
    }
    whyEl.classList.add("visible"), whyEl.setAttribute("aria-hidden", "false"), captureFocus(whyEl)
}

function hideWhy() {
    whyEl && whyEl.classList.contains("visible") && (whyEl.classList.remove("visible"), whyEl.setAttribute("aria-hidden", "true"), restoreFocus())
}
/* The why panel opens by swiping up only — on a touch screen, or with two
   fingers on a trackpad. There is no key for it. */
whyEl && whyEl.addEventListener("click", () => hideWhy());