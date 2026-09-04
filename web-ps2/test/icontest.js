/*
 * icontest.js - checks for the PS2 icon parser and animation logic.
 *
 * The texture decoder is verified against the CLI's own --icons-png output,
 * so the two implementations must agree byte for byte. Geometry and animation
 * are checked for internal consistency across every icon on the sample cards.
 *
 *     node web-ps2/test/icontest.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "ps2vmc-tool");
const PS2VMC = require(path.join(__dirname, "..", "ps2vmc.js"));
const PS2Icon = require(path.join(__dirname, "..", "ps2icon.js"));
const PS2Icon3D = require(path.join(__dirname, "..", "icon3d.js"));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  — " + detail : "")); }
}

/* decode a PNG written by svpng (filter 0, RGBA8) */
function pngPixels(file) {
  const d = fs.readFileSync(file);
  let i = 8, idat = Buffer.alloc(0), w = 0, h = 0;
  while (i < d.length) {
    const len = d.readUInt32BE(i);
    const type = d.slice(i + 4, i + 8).toString("ascii");
    const data = d.slice(i + 8, i + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === "IDAT") idat = Buffer.concat([idat, data]);
    i += 12 + len;
  }
  const raw = zlib.inflateSync(idat);
  const out = Buffer.alloc(w * h * 4);
  const stride = w * 4;
  for (let y = 0, pos = 0; y < h; y++) {
    if (raw[pos] !== 0) throw new Error("unexpected PNG filter " + raw[pos]);
    pos++;
    raw.copy(out, y * stride, pos, pos + stride);
    pos += stride;
  }
  return out;
}

async function main() {
  const vmc = await PS2VMC.load();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps2icon-"));

  const samples = ["samples/ps2card.vmc", "samples/card16mb.bin", "samples/card32mb.bin",
                   "samples/oplcard.bin"]
    .map(s => path.join(ROOT, s)).filter(fs.existsSync);

  /* ---------- 1. parse every icon on every sample card ---------- */
  console.log("\n=== parsing every icon on the sample cards ===");
  let icons = 0, animated = 0, textured = 0, badGeometry = 0, parseErrors = [];
  const byType = {};
  const catalogue = [];

  for (const sample of samples) {
    vmc.openCard(new Uint8Array(fs.readFileSync(sample)));
    for (const d of vmc.list("/")) {
      if (!d.isDir) continue;
      let sys;
      try { sys = PS2Icon.parseIconSys(vmc.readFile("/" + d.name + "/icon.sys")); }
      catch (e) { continue; }

      const names = [sys.iconName, sys.copyIconName, sys.deleteIconName]
        .filter((v, i, a) => v && a.indexOf(v) === i);

      for (const nm of names) {
        let ico;
        try { ico = PS2Icon.parseIco(vmc.readFile("/" + d.name + "/" + nm)); }
        catch (e) { parseErrors.push(d.name + "/" + nm + ": " + e.message); continue; }

        icons++;
        byType[ico.textureType] = (byType[ico.textureType] || 0) + 1;
        if (ico.texture) textured++;
        if (ico.shapeCount > 1) animated++;

        /* geometry sanity: triangles, finite coordinates, sane extent */
        let bad = ico.vertexCount % 3 !== 0;
        for (const s of ico.shapes) {
          if (s.length !== ico.vertexCount * 3) { bad = true; break; }
          for (let i = 0; i < s.length; i++)
            if (!Number.isFinite(s[i]) || Math.abs(s[i]) > 100) { bad = true; break; }
          if (bad) break;
        }
        if (bad) badGeometry++;

        catalogue.push({ card: path.basename(sample), dir: d.name, name: nm, ico, sys,
                         raw: vmc.readFile("/" + d.name + "/" + nm) });
      }
    }
  }

  console.log("  parsed " + icons + " icons (" + animated + " animated), texture types: " +
              Object.entries(byType).map(([t, n]) => t + "×" + n).join(", "));
  ok("every icon parsed", parseErrors.length === 0, parseErrors.slice(0, 3).join(" | "));

  /* Not every icon carries a texture: some end right after the animation block
   * and are drawn from vertex colours alone. Those must be reported as
   * textureless rather than decoded from whatever follows in memory, which is
   * what the C tool does (it reads 32KB past its buffer for these files). */
  const untextured = catalogue.filter(c => !c.ico.texture);
  ok("icons with texture data decode to a full 128x128 image",
     catalogue.filter(c => c.ico.texture).every(c => c.ico.texture.length === 128 * 128 * 4));
  ok("textureless icons are detected, not read past the end of the file (" +
     untextured.length + " of " + icons + ")",
     untextured.every(c => c.ico.texture === null && c.ico.vertexCount > 0));
  ok("all geometry is finite triangles", badGeometry === 0, badGeometry + " bad");
  /* No sample icon has a truncated compressed texture, so build one. A short
   * RLE stream must report textureless, the same as the uncompressed branch
   * already does - otherwise the tail of the image stays at the cleared value
   * and a part-black tile passes for real texture data. */
  const rle = catalogue.filter(c => c.ico.textureType > 7 && c.ico.texture)
                       .sort((a, b) => b.raw.length - a.raw.length)[0];
  if (rle) {
    /* Trim only the tail: the texture is the last block, so a small cut
     * shortens the RLE stream while leaving the header and geometry intact.
     * The largest icon is used so the cuts cannot reach back into vertices. */
    const cuts = [];
    for (const n of [2, 16, 64]) {
      try { cuts.push(PS2Icon.parseIco(rle.raw.subarray(0, rle.raw.length - n))); }
      catch (e) { /* cut reached the geometry; not a useful case */ }
    }
    ok("a truncated RLE texture reports textureless, not a part-decoded image (" +
       rle.dir + "/" + rle.name + ", " + cuts.length + " cuts)",
       cuts.length > 0 && cuts.every(c => c.texture === null),
       cuts.map(c => c.texture ? "array " + c.texture.length : "null").join(", "));
    ok("truncating the texture leaves the model intact",
       cuts.length > 0 && cuts.every(c => c.vertexCount === rle.ico.vertexCount &&
                                          c.shapeCount === rle.ico.shapeCount));
  }

  ok("sample set covers both texture encodings",
     Object.keys(byType).some(t => +t <= 7) && Object.keys(byType).some(t => +t > 7));
  ok("sample set contains animated icons", animated > 0, animated + " found");

  /* ---------- 2. texture decode vs the CLI ---------- */
  console.log("\n=== texture decode vs ps2vmc-tool --icons-png ===");
  const checks = [
    ["samples/ps2card.vmc", "BESLES-50325", "PAYNE.ICO", "BESLES-50325_PAYNE.png"],
    ["samples/ps2card.vmc", "BESLES-53900-SYS.00", "icon.00", "BESLES-53900_icon.png"],
    ["samples/card16mb.bin", "BESCES-50000RRV", "icon1.ico", "BESCES-50000_icon1.png"],
    ["samples/card16mb.bin", "BESLES-52065", "FIcon.ico", "BESLES-52065_FIcon.png"]
  ];

  for (const [card, dir, ico, png] of checks) {
    const cardPath = path.join(ROOT, card);
    if (!fs.existsSync(cardPath)) continue;
    try {
      execFileSync(CLI, [cardPath, "--icons-png", "/" + dir], { cwd: tmp, encoding: "utf8" });
    } catch (e) {
      ok("CLI exported icons for " + dir, false, "CLI failed");
      continue;
    }
    const pngPath = path.join(tmp, png);
    if (!fs.existsSync(pngPath)) {
      ok("CLI produced " + png, false, "missing (CLI names it from icon.sys)");
      continue;
    }

    vmc.openCard(new Uint8Array(fs.readFileSync(cardPath)));
    const parsed = PS2Icon.parseIco(vmc.readFile("/" + dir + "/" + ico));
    const mine = Buffer.from(parsed.texture.buffer);
    const theirs = pngPixels(pngPath);
    ok("texture " + dir + "/" + ico + " (type " + parsed.textureType + ") matches CLI",
       mine.equals(theirs),
       mine.length !== theirs.length ? "length" :
         [...mine].filter((b, i) => b !== theirs[i]).length + " bytes differ");
  }

  /* ---------- 3. animation logic ---------- */
  console.log("\n=== animation plan / morph ===");
  const anims = catalogue.filter(c => c.ico.shapeCount > 1);

  let planOk = true, rangeOk = true, coverOk = true, loopOk = true, monotoneOk = true;
  for (const c of anims) {
    const plan = PS2Icon3D.animationPlan(c.ico);

    if (!plan.animated || plan.order.length < 2) planOk = false;
    if (plan.order.some(i => i < 0 || i >= c.ico.shapeCount)) planOk = false;
    if (!(plan.loopSeconds >= 0.3 && plan.loopSeconds <= 10)) loopOk = false;

    /* every shape index the plan names must be visited over one loop */
    const visited = new Set();
    let prevPos = -1;
    for (let step = 0; step < 240; step++) {
      const t = (step / 240) * plan.loopSeconds;
      const m = PS2Icon3D.morphAt(plan, t);
      if (!(m.morph >= 0 && m.morph < 1)) rangeOk = false;
      if (m.a < 0 || m.a >= c.ico.shapeCount || m.b < 0 || m.b >= c.ico.shapeCount) rangeOk = false;
      visited.add(m.a);

      /* position must advance monotonically within a loop */
      const pos = plan.order.indexOf(m.a) + m.morph;
      if (pos < prevPos - 1e-6) monotoneOk = false;
      prevPos = pos;
    }
    if (visited.size !== new Set(plan.order).size) coverOk = false;

    /* wrapping: t and t + loop must land in the same place */
    const x = PS2Icon3D.morphAt(plan, 0.37 * plan.loopSeconds);
    const y = PS2Icon3D.morphAt(plan, 0.37 * plan.loopSeconds + plan.loopSeconds * 3);
    if (x.a !== y.a || x.b !== y.b || Math.abs(x.morph - y.morph) > 1e-6) loopOk = false;
  }

  ok("animation plans reference valid shapes (" + anims.length + " icons)", planOk);
  ok("morph stays in [0,1) and indices stay in range", rangeOk);
  ok("every shape in the sequence is visited over one loop", coverOk);
  ok("playback advances monotonically within a loop", monotoneOk);
  ok("animation loops cleanly and clamps to 0.3-10s", loopOk);

  /* a static icon must never morph */
  const still = catalogue.find(c => c.ico.shapeCount === 1);
  if (still) {
    const plan = PS2Icon3D.animationPlan(still.ico);
    const frames = [0, 0.5, 1, 5, 60].map(t => PS2Icon3D.morphAt(plan, t));
    ok("static icons never morph",
       !plan.animated && frames.every(f => f.a === f.b && f.morph === 0));
  }

  /* a concrete case: 8 shapes, frame_length 119 -> ~2s loop, 8 distinct steps */
  const rrv = catalogue.find(c => c.dir === "BESCES-50000RRV" && c.ico.shapeCount === 8);
  if (rrv) {
    const plan = PS2Icon3D.animationPlan(rrv.ico);
    const steps = new Set();
    for (let i = 0; i < 64; i++) steps.add(PS2Icon3D.morphAt(plan, (i / 64) * plan.loopSeconds).a);
    ok("Ridge Racer V icon: 8 shapes over a " + plan.loopSeconds.toFixed(1) + "s loop",
       steps.size === 8, "visited " + steps.size + " shapes");
  }

  /* ---------- 4. icon.sys ---------- */
  console.log("\n=== icon.sys ===");
  let sysOk = true, litOk = true, titled = 0;
  const seen = new Set();
  for (const c of catalogue) {
    if (seen.has(c.card + c.dir)) continue;
    seen.add(c.card + c.dir);
    if (c.sys.magic !== "PS2D") sysOk = false;
    for (const v of c.sys.lightDirections.concat(c.sys.lightColors, [c.sys.ambient]))
      if (v.some(x => !Number.isFinite(x))) litOk = false;
    if (c.sys.titleLines.length) titled++;
  }
  ok("every icon.sys has the PS2D magic (" + seen.size + " saves)", sysOk);
  ok("light and ambient values are finite floats", litOk);
  ok("titles decoded for every save", titled === seen.size, titled + "/" + seen.size);

  /* ---------- 5. grid thumbnails ---------- */
  console.log("\n=== grid thumbnails ===");

  /* The save grid draws every tile through one shared offscreen context, so a
   * card with a hundred saves does not need a hundred WebGL contexts. The
   * renderer itself needs a DOM, but what the grid relies on can be checked
   * here: the entry point exists, and every save yields drawable geometry. */
  ok("icon3d exposes the shared-context thumbnail renderer",
     typeof PS2Icon3D.createThumbnailer === "function");

  let tiles = 0, texturelessTiles = 0, undrawable = [];
  for (const sample of samples) {
    vmc.openCard(new Uint8Array(fs.readFileSync(sample)));
    for (const d of vmc.list("/")) {
      if (!d.isDir) continue;
      let sys, ico;
      try { sys = PS2Icon.parseIconSys(vmc.readFile("/" + d.name + "/icon.sys")); }
      catch (e) { continue; }
      if (!sys.iconName) continue;
      try { ico = PS2Icon.parseIco(vmc.readFile("/" + d.name + "/" + sys.iconName)); }
      catch (e) { continue; }

      tiles++;
      if (!ico.texture) texturelessTiles++;
      if (!(ico.vertexCount > 0 && ico.shapes.length > 0))
        undrawable.push(d.name);
    }
  }

  ok("every save's primary icon has drawable geometry (" + tiles + " tiles)",
     undrawable.length === 0, undrawable.join(", "));

  /* These are the ones the old flat-texture grid could only show as "?": they
   * have no texture and are drawn from vertex colours alone. */
  ok("textureless icons are drawable rather than placeholders (" +
     texturelessTiles + " of " + tiles + ")", texturelessTiles > 0);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
