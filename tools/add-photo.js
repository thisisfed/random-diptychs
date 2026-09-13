/* random.thisisfed.xyz — adding a photograph.

   Opened from the browser console on the live site with __addPhoto().
   Everything happens in the browser; nothing is uploaded. The result is one
   zip to unpack into the site folder and upload:

     images/jpg/ffN.jpg              full size, capped at FULL_MAX
     images/jpg/ffN-256|600|1000|1500.jpg
     images/avif/ffN.avif            full size, capped at FULL_MAX
     images/avif/ffN-256|600|1000|1500.avif
     captions.json                   the live file plus the new caption
     index.html                      the live page, pool rebuilt to include it

   AVIF is encoded with the libavif encoder compiled to WebAssembly, in
   tools/avif/. Widths are image widths: ffN-600 is 600 pixels wide. */

const WIDTHS = [256, 600, 1000, 1500];
const FULL_MAX = 2400;
const JPG_QUALITY = 0.85;
const AVIF_OPTIONS = { cqLevel: 30, speed: 6 };

/* The caption, in the order every entry in captions.json uses. Lists are the
   values the site's rules understand; free text fields have none. */
const FIELDS = [
  ["subject", "text", "what the photo is of, e.g. a pink rose"],
  ["short", "text", "one noun, e.g. rose"],
  ["detail", "text", "the telling detail"],
  ["placement", "list"],
  ["height", "list"],
  ["distance", "list"],
  ["lines", "list"],
  ["people", "list"],
  ["scale", "list"],
  ["light", "text", "e.g. low sun, hard shadow"],
  ["surface", "text", "the main material, e.g. painted steel"],
  ["category", "list"],
  ["depth", "list"],
  ["dense", "list"],
  ["mood", "list"],
  ["temp", "list"],
  ["structure", "list", "", true],
  ["shape", "list", "", true],
  ["accent", "list", "", true],
  ["text", "text", "words in the photo, as written", true],
  ["colour", "text", "only if the site names the colour wrong", true],
  ["time", "list", "", true],
  ["sky", "check", "sky in the frame"],
  ["hands", "check", "a hand or handprint"],
  ["logo", "check", "a logo or brand mark"],
  ["picked", "tri", "plants: picked, or still growing"],
  ["loud", "notloud", "never call it loud"]
];

const css = `
#addphoto{position:fixed;inset:0;z-index:100000;overflow:auto;background:#fff;color:#000;
 font:13px/1.45 ui-monospace,Menlo,monospace;text-transform:none;word-spacing:normal;padding:24px 28px 60px;box-sizing:border-box}
#addphoto *{font:inherit;text-transform:none;word-spacing:normal;line-height:1.45;box-sizing:border-box}
#addphoto h2{font-weight:bold;margin:22px 0 8px}
#addphoto button{border:1px solid #000;background:#fff;padding:6px 12px;cursor:pointer;margin:0 6px 6px 0}
#addphoto button:hover{background:#000;color:#fff}
#addphoto button:disabled{opacity:.4;cursor:default;background:#fff;color:#000}
#addphoto input[type=text],#addphoto input[type=number],#addphoto select,#addphoto textarea{border:1px solid #999;padding:4px 6px;width:100%;background:#fff;color:#000}
#addphoto textarea{height:120px}
#addphoto .grid{display:grid;grid-template-columns:130px 1fr;gap:6px 12px;align-items:center;max-width:760px}
#addphoto .drop{border:1px dashed #000;padding:28px;text-align:center;max-width:760px}
#addphoto .drop.over{background:#eee}
#addphoto .note{color:#666}
#addphoto .warn{color:#c00}
#addphoto .close{position:fixed;top:14px;right:18px}
#addphoto .log{white-space:pre-wrap;max-width:760px}
#addphoto img.preview{max-height:220px;display:block;margin:10px 0}
`;

let ctx, root, state;

export default function open(context) {
  ctx = context;
  document.getElementById("addphoto")?.remove();
  state = { file: null, img: null, sig: null };
  root = document.createElement("div");
  root.id = "addphoto";
  const style = document.createElement("style");
  style.textContent = css;
  root.appendChild(style);
  /* The site listens for clicks, keys and wheel turns to change pairs and
     open the why panel; none of that should happen while this is open. */
  /* Passive: they only stop the event travelling on, they never cancel
     scrolling, so Chrome has no reason to wait for them. */
  for (const t of ["click", "keydown", "keyup", "wheel", "touchstart", "touchend"]) root.addEventListener(t, e => e.stopPropagation(), { passive: true });
  document.body.appendChild(root);
  build();
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k in e && k !== "list") e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
}

/* The values each list field takes across the catalogue, most used first. */
function valuesFrom(captions) {
  const out = {};
  for (const [k, c] of Object.entries(captions)) {
    if (k === "__meta__" || !c) continue;
    for (const [f, v] of Object.entries(c)) if (typeof v === "string") (out[f] ??= new Map()).set(v, (out[f].get(v) || 0) + 1);
  }
  const lists = {};
  for (const [f, m] of Object.entries(out)) lists[f] = [...m].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  lists.time = ["day", "golden hour", "dusk", "night"];
  return lists;
}

async function build() {
  const captions = await (await fetch("captions.json", { cache: "no-store" })).json();
  state.captions = captions;
  state.lists = valuesFrom(captions);
  const nums = Object.keys(captions).filter(k => /^ff\d+$/.test(k)).map(k => +k.slice(2));
  const next = Math.max(0, ...nums) + 1;

  root.append(
    el("button", { className: "close", on: { click: () => root.remove() } }, "Close"),
    el("div", {}, el("b", {}, "Add a photograph"), " — everything stays in this browser until you upload the zip."),

    el("h2", {}, "1  Photo"),
    (state.drop = el("div", { className: "drop" }, "Drop a JPG here, or ",
      el("button", { on: { click: () => state.input.click() } }, "choose one"))),
    (state.input = el("input", { type: "file", accept: "image/jpeg", style: "display:none", on: { change: e => e.target.files[0] && loadFile(e.target.files[0]) } })),
    (state.info = el("div", { className: "note" })),

    el("h2", {}, "2  Number"),
    el("div", { className: "grid" }, el("label", {}, "ff"),
      (state.num = el("input", { type: "number", value: next, min: 1, on: { input: checkNum } }))),
    (state.numWarn = el("div", { className: "warn" })),

    el("h2", {}, "3  Caption"),
    el("div", { className: "note" }, "Easiest: copy the prompt, paste it into Claude with the photo attached, then paste Claude's reply below and press Fill in. Check the fields after."),
    el("div", {}, el("button", { on: { click: copyPrompt } }, "Copy prompt for Claude"),
      (state.copied = el("span", { className: "note" }))),
    (state.reply = el("textarea", { placeholder: "Paste Claude's reply here" })),
    el("div", {}, el("button", { on: { click: fillFromReply } }, "Fill in"), (state.fillMsg = el("span", { className: "note" }))),
    (state.form = el("div", { className: "grid" })),

    el("h2", {}, "4  Files"),
    el("div", {}, (state.go = el("button", { on: { click: makeFiles }, disabled: true }, "Make the zip"))),
    (state.log = el("div", { className: "log" }))
  );

  for (const [name, type, hint, optional] of FIELDS) {
    let input;
    if (type === "text") input = el("input", { type: "text", placeholder: hint || "" });
    else if (type === "list") {
      input = el("select", {}, el("option", { value: "" }, optional ? "—" : "choose"));
      for (const v of state.lists[name] || []) input.append(el("option", { value: v }, v));
    } else if (type === "check" || type === "notloud") input = el("input", { type: "checkbox", title: hint });
    else if (type === "tri") input = el("select", {}, el("option", { value: "" }, "—"), el("option", { value: "true" }, "picked"), el("option", { value: "false" }, "still growing"));
    input.dataset.field = name;
    input.addEventListener("input", updateGo);
    state.form.append(el("label", { title: hint || "" }, name + (type === "check" || type === "notloud" || type === "tri" ? "  (" + hint + ")" : "")), input);
  }
  checkNum();
  state.drop.addEventListener("dragover", e => { e.preventDefault(); state.drop.classList.add("over"); });
  state.drop.addEventListener("dragleave", () => state.drop.classList.remove("over"));
  state.drop.addEventListener("drop", e => {
    e.preventDefault(); state.drop.classList.remove("over");
    const f = e.dataTransfer.files[0]; f && loadFile(f);
  });
}

function checkNum() {
  const n = +state.num.value;
  const taken = state.captions && state.captions["ff" + n];
  state.numWarn.textContent = taken ? `ff${n} already exists (${taken.subject}). Making the zip would replace it.` : "";
  updateGo();
}

async function loadFile(file) {
  if (!/jpe?g$/i.test(file.name) && file.type !== "image/jpeg") { state.info.textContent = "That isn't a JPG."; return; }
  state.file = file;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  state.img = img;
  /* Colour data from the 256-wide version, the same size the site measures. */
  const small = resize(img, 256);
  const s = ctx.analyzeImage(small);
  state.sig = s && {
    histogram: s.histogram, palette: s.palette, averageSaturation: s.avgSat, meanLight: s.meanL,
    density: s.density, histogramMagnitude: s.histMag, aspect: s.aspect, edgeEnergy: s.edgeEnergy,
    vertical: s.vertical, centerX: s.cx, centerY: s.cy
  };
  state.info.replaceChildren(
    el("img", { className: "preview", src: img.src }),
    `${file.name} — ${img.naturalWidth} × ${img.naturalHeight}` + (state.sig ? "" : "  (colour data failed)"));
  updateGo();
}

function readForm() {
  const c = { kind: "image" };
  for (const input of state.form.querySelectorAll("[data-field]")) {
    const f = input.dataset.field;
    const def = FIELDS.find(x => x[0] === f);
    if (def[1] === "check") { if (input.checked) c[f] = true; }
    else if (def[1] === "notloud") { if (input.checked) c[f] = false; }
    else if (def[1] === "tri") { if (input.value) c[f] = input.value === "true"; }
    else if (input.value.trim()) c[f] = input.value.trim();
  }
  return c;
}

function missing() {
  const c = readForm();
  return FIELDS.filter(([f, type, , optional]) => !optional && (type === "text" || type === "list") && !c[f]).map(x => x[0]);
}

function updateGo() {
  if (!state.go) return;
  const m = missing();
  state.go.disabled = !state.img || !state.sig || m.length > 0;
  state.go.title = !state.img ? "Choose a photo first" : m.length ? "Still to fill: " + m.join(", ") : "";
}

function copyPrompt() {
  const lists = state.lists;
  const L = f => (lists[f] || []).join(" | ");
  const examples = Object.entries(state.captions).filter(([k]) => /^ff\d+$/.test(k)).slice(-3)
    .map(([, c]) => { const { signature, ...rest } = c; return JSON.stringify(rest); }).join("\n");
  const prompt = `Caption the attached photograph for my photography site. Reply with one JSON object and nothing else.

Keys, in this order:
kind: "image"
subject: what the photo is of, lowercase, with an article ("a pink rose")
short: one noun for it ("rose")
detail: the one telling detail, a short phrase
placement: ${L("placement")}
height: ${L("height")}
distance: ${L("distance")}
lines: the main direction of lines — ${L("lines")}
people: ${L("people")}
scale: ${L("scale")}
light: the light, a short phrase ("low sun, hard shadow")
surface: the main material ("painted steel")
category: ${L("category")}
depth: ${L("depth")}
dense: ${L("dense")}
mood: ${L("mood")}
temp: ${L("temp")}

Only when they apply, leave the key out otherwise:
text: any words or numbers in the photo, exactly as written
structure: ${L("structure")}
shape: ${L("shape")}
accent: a single strong accent colour — ${L("accent")}
sky: true if sky is in the frame, and then time: day | golden hour | dusk | night
hands: true if a hand or handprint is in the frame
logo: true if a logo or brand mark is in the frame
picked: for plants — true if cut or harvested, false if still growing

For list keys use one of the values given. Examples from the site:
${examples}`;
  navigator.clipboard.writeText(prompt).then(
    () => { state.copied.textContent = "  copied"; },
    () => { state.reply.value = prompt; state.copied.textContent = "  couldn't copy — the prompt is in the box below; copy it from there"; });
}

function fillFromReply() {
  const t = state.reply.value;
  const m = t.match(/\{[\s\S]*\}/);
  let c;
  try { c = JSON.parse(m ? m[0] : t); } catch { state.fillMsg.textContent = "  That isn't JSON. Paste only Claude's reply."; return; }
  let n = 0;
  for (const input of state.form.querySelectorAll("[data-field]")) {
    const f = input.dataset.field, v = c[f];
    const def = FIELDS.find(x => x[0] === f);
    if (def[1] === "check") input.checked = v === true;
    else if (def[1] === "notloud") input.checked = v === false;
    else if (def[1] === "tri") input.value = typeof v === "boolean" ? String(v) : "";
    else if (typeof v === "string") {
      if (input.tagName === "SELECT" && ![...input.options].some(o => o.value === v)) input.append(el("option", { value: v }, v + " (new)"));
      input.value = v;
    } else input.value = "";
    if (v !== undefined) n++;
  }
  state.fillMsg.textContent = `  filled ${n} fields — check them`;
  updateGo();
}

/* Downscale in halving steps before the last one: a single big drawImage
   step goes soft and grainy in some browsers. */
function resize(img, w) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  w = Math.min(w, W);
  let src = img, sw = W, sh = H;
  while (sw / 2 >= w) {
    const c = document.createElement("canvas");
    c.width = Math.round(sw / 2); c.height = Math.round(sh / 2);
    const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, c.width, c.height);
    src = c; sw = c.width; sh = c.height;
  }
  const c = document.createElement("canvas");
  c.width = w; c.height = Math.round(H * w / W);
  const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const toJpg = c => new Promise(r => c.toBlob(b => r(b), "image/jpeg", JPG_QUALITY));

let avifModule;
async function toAvif(c) {
  if (!avifModule) {
    const factory = (await import("./avif/avif_enc.js")).default;
    avifModule = await factory({ noInitialRun: true });
  }
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height);
  const out = avifModule.encode(d.data, d.width, d.height, {
    cqLevel: AVIF_OPTIONS.cqLevel, cqAlphaLevel: -1, denoiseLevel: 0, tileColsLog2: 0, tileRowsLog2: 0,
    speed: AVIF_OPTIONS.speed, subsample: 1, chromaDeltaQ: false, sharpness: 0, tune: 0
  });
  if (!out) throw new Error("AVIF encoding failed");
  return new Blob([out], { type: "image/avif" });
}

function log(t) { state.log.textContent += t + "\n"; }

async function makeFiles() {
  const n = +state.num.value, key = "ff" + n;
  const caption = readForm();
  caption.signature = state.sig;
  state.go.disabled = true;
  state.log.textContent = "";
  try {
    const files = [];
    files.push([`images/jpg/${key}.jpg`, await toJpg(resize(state.img, FULL_MAX))]);
    log(`${key}.jpg — full size, capped at ${FULL_MAX}px`);
    for (const w of WIDTHS) {
      const c = resize(state.img, w);
      files.push([`images/jpg/${key}-${w}.jpg`, await toJpg(c)]);
      log(`${key}-${w}.jpg`);
    }
    log("AVIF takes a few seconds each…");
    for (const w of [...WIDTHS, "full"]) {
      const c = resize(state.img, w === "full" ? FULL_MAX : w);
      await new Promise(r => setTimeout(r, 30));
      const name = w === "full" ? `images/avif/${key}.avif` : `images/avif/${key}-${w}.avif`;
      files.push([name, await toAvif(c)]);
      log(name.split("/").pop());
    }

    /* captions.json: the live file with the new entry after the last
       photograph and before the videos, as the file is ordered. */
    const out = {};
    let placed = false;
    for (const [k, v] of Object.entries(state.captions)) {
      if (k === key) continue;
      if (!placed && /^v\d+$/.test(k)) { out[key] = caption; placed = true; }
      out[k] = v;
    }
    placed || (out[key] = caption);
    files.push(["captions.json", new Blob([JSON.stringify(out, null, 2)], { type: "application/json" })]);
    log("captions.json");

    /* index.html: score the new photo against the catalogue in this session
       and rebuild the pool with it. */
    const { signature, ...cap } = caption;
    ctx.addToCatalogue(key, signature, cap);
    const { ok, html, pool, dropped } = await ctx.buildIndexHtml();
    if (!ok) throw new Error("couldn't read the live index.html");
    files.push(["index.html", new Blob([html], { type: "text/html" })]);
    log(`index.html — ${pool.n} items, ${pool.count} diptychs`);
    dropped.length && log(`  Left out because they didn't load in this session: ${dropped.join(", ")}. If they should be there, reload the site and add the photo again.`);

    ctx.downloadBlob(`${key}.zip`, await zip(files));
    log(`\n${key}.zip downloaded. Unzip it into the site folder, let it replace captions.json and index.html, and upload.`);
  } catch (e) {
    log("Stopped: " + e.message);
  }
  updateGo();
}

/* A plain zip, no compression: images are already compressed, and it keeps
   this file free of libraries. */
async function zip(files) {
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, blob] of files) {
    const data = new Uint8Array(await blob.arrayBuffer()), nm = enc.encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    parts.push(h, nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true);
    c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
    c.setUint32(38, 0, true); c.setUint32(42, offset, true);
    central.push(c, nm);
    offset += 30 + nm.length + data.length;
  }
  const size = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, e], { type: "application/zip" });
}
