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

/*
 * Average an RGBA image into N x N blocks of coverage-weighted colour, so a
 * render can be compared against a reference without depending on the exact
 * pixels. Weighting by alpha keeps transparent margins from darkening a block.
 */
function fingerprint(px, w, h, N) {
  const out = Buffer.alloc(N * N * 4);
  for (let by = 0; by < N; by++)
    for (let bx = 0; bx < N; bx++) {
      const x0 = Math.floor(bx * w / N), x1 = Math.floor((bx + 1) * w / N);
      const y0 = Math.floor(by * h / N), y1 = Math.floor((by + 1) * h / N);
      let acc = [0, 0, 0], a = 0, cnt = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          for (let k = 0; k < 3; k++) acc[k] += px[i + k] * px[i + 3];
          a += px[i + 3]; cnt++;
        }
      const o = (by * N + bx) * 4;
      for (let k = 0; k < 3; k++) out[o + k] = a ? Math.round(acc[k] / a) : 0;
      out[o + 3] = cnt ? Math.round(a / cnt) : 0;
    }
  return out.toString("hex");
}

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
  const stride = w * 4, BPP = 4;

  /* All five filters: src/ps2png.c picks whichever compresses best per row. */
  for (let y = 0, pos = 0; y < h; y++) {
    const type = raw[pos++];
    const row = out.subarray(y * stride, (y + 1) * stride);
    const up = y ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const v = raw[pos + x];
      const a = x >= BPP ? row[x - BPP] : 0;
      const b = up ? up[x] : 0;
      const c = (up && x >= BPP) ? up[x - BPP] : 0;
      let add;
      switch (type) {
        case 0: add = 0; break;
        case 1: add = a; break;
        case 2: add = b; break;
        case 3: add = (a + b) >> 1; break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          add = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
        default: throw new Error("unexpected PNG filter " + type);
      }
      row[x] = (v + add) & 0xff;
    }
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

  /* ---------- 2b. the software renderer ---------- */
  console.log("\n=== software render vs --3d-icons ===");

  /*
   * The CLI rasterises the same model the WebGL viewer draws (src/ps2render.c
   * mirrors icon3d.js). A browser is needed to compare the two pixel for pixel,
   * so what is checked here is that every save renders something plausible:
   * a transparent background, a solid model covering a sensible share of the
   * frame, and more than one colour in it.
   *
   * Measured against the WebGL renderer at the time this was written, over
   * every save on ps2card.vmc: mean channel difference 0.14-0.37 out of 255,
   * with the pixels that differ by more than 32 all sitting in high-contrast
   * areas of the texture and none in smooth ones.
   */
  {
    /* Every save on the 8 MB card, plus icons from the 16 MB one that carry
     * several animation shapes - those are what make a wrong still frame
     * visible, since every icon on ps2card.vmc has exactly one shape. */
    const targets = [];
    const mainCard = path.join(ROOT, "samples/ps2card.vmc");
    vmc.openCard(new Uint8Array(fs.readFileSync(mainCard)));
    for (const e of vmc.list("/"))
      if (e.isDir && e.name !== "." && e.name !== "..") targets.push([mainCard, e.name]);

    const animCard = path.join(ROOT, "samples/card16mb.bin");
    if (fs.existsSync(animCard))
      for (const d of ["BESCES-50000RRV", "BESLES-50703Maximo", "BESLES-51759Maximo2"])
        targets.push([animCard, d]);

    let rendered = 0, opaqueOk = 0, clearOk = 0;
    const problems = [], fingerprints = {};

    for (const [cardPath, dir] of targets) {
      const before = new Set(fs.readdirSync(tmp));
      try {
        execFileSync(CLI, [cardPath, "--3d-icons", "/" + dir], { cwd: tmp, encoding: "utf8" });
      } catch (e) {
        problems.push(dir + ": CLI failed");
        continue;
      }
      const made = fs.readdirSync(tmp).filter(f => !before.has(f) && f.endsWith("_3d.png"));
      if (!made.length) { problems.push(dir + ": no PNG"); continue; }
      rendered++;

      const px = pngPixels(path.join(tmp, made[0]));
      const n = px.length / 4;
      const side = Math.round(Math.sqrt(n));

      /* corners must be fully transparent: the model is centred and scaled
       * into a unit sphere, so it cannot reach them */
      const corner = [0, side - 1, (side - 1) * side, n - 1];
      if (corner.every(i => px[i * 4 + 3] === 0)) clearOk++;
      else problems.push(dir + ": corners are not transparent");

      let opaque = 0;
      for (let i = 0; i < n; i++)
        if (px[i * 4 + 3] === 255) opaque++;

      /* a real icon covers a meaningful part of the frame without filling it */
      if (opaque > n * 0.02 && opaque < n * 0.95) opaqueOk++;
      else problems.push(dir + ": " + (100 * opaque / n).toFixed(1) + "% opaque");

      fingerprints[dir] = fingerprint(px, side, side, 8);
    }

    ok("every save renders (" + rendered + " of " + targets.length + ")",
       targets.length > 0 && rendered === targets.length, problems.slice(0, 3).join(" | "));
    ok("the background is transparent (" + clearOk + ")",
       clearOk === rendered, problems.slice(0, 3).join(" | "));
    ok("the model covers a plausible part of the frame (" + opaqueOk + ")",
       opaqueOk === rendered, problems.slice(0, 3).join(" | "));

    /*
     * Those three only say something was drawn. What actually pins the picture
     * down is a reference: each render is averaged into 8x8 blocks of
     * coverage-weighted colour and compared against the fingerprint below,
     * taken from a build checked against the WebGL renderer.
     *
     * Blocks, not pixels, so that float differences between compilers and
     * architectures wash out while anything structural - lighting dropped, the
     * depth test broken, the texture ignored, the wrong animation frame - moves
     * the averages well past the tolerance.
     */
    const REFERENCE = {
      "APOLLO-99PS2": "000000000000000000000000000000000000000000000000000000000000000000000000029c640f04a76d1405aa75140ca9731406a66b1405a66d0f0000000000000000019562c51a9e73ff4ba589ff56a58aff1b9e71ff0b9a69c50000000000000000078d62c53b977aff549b83ff4e9b81ff3d9779ff0b8b60c5000000000000000008805ac5458b74ff599380ff5c9683ff3e8b71ff097c54c50000000000000000096846c5136a4cff408069ff44816cff1b7152ff046a46c50000000000000000065c3b0f06613e140c5d3f14095d3e1406623f14065d3b0f000000000000000000000000000000000000000000000000000000000000000000000000",
      "BASLUS-20963FF1200": "0000000000000000000000000000000000000000000000000000000000000000000000000000000f010507140000011408060514403825140202010f0000000000000000000000c509252bff10202bff2d2b38ff8e794eff020302c50000000000000000000000c5112f36ff284a62ff565272ff8e7055ff010101c50000000000000000222320c5383a38ff3a4752ff616a71ff78645aff2a2b28c50000000000000000141414c5252a2cff24323bff43656fff686b68ff191918c500000000000000000000000f0000001400000014070b0d14283638140000000f000000000000000000000000000000000000000000000000000000000000000000000000",
      "BESLES-53900-SYS.00": "000000000000000000000000000000000000000000000000000000000000000000000000000000009c9cba11c4c4ddb6e7e7fa6a0000000000000000000000000000000000000000aca6d342beb4bcffc3bdcbcd0000000000000000000000000000000000000000dec7e901c5afa6b3d7c8aad5000000000000000000000000000000000000000000000000b1b1dc9fe0e0fbfbd6d6e30f0000000000000000000000000000000089899e04b4b4d6e1e4e4fcfce7e7f756000000000000000000000000000000000101012e1c1c20ac080809953030332e00000000000000000000000000000000000000010000001900000017000000000000000000000000",
      "BESLES-52159c714f754": "0000000000000000000000000000000000000000000000000000000000000000000000000038502c0038506a0f394a6a0138506a0038506a00384f2c000000000000000000344b6a00344bff272e32ff242d33ff053449ff00334b6a0000000000000000032f436a272f2cff372a1cff2f281aff1d2b2bff002d436a0000000000000000102b366a1f2221ff332a24ff251e14ff1d231cff0628386a0000000000000000001e306a0c212cff261314ff261412ff0e2223ff07212e6a0000000000000000001a2b2c001a2b6a11242e6a0d222d6a00192b6a001a2b2c000000000000000000000000000000000000000000000000000000000000000000000000",
      "APOLLO-99999": "000000000000000000000000000000000000000000000000000000000000000000000000029c640f04a76d1405aa75140ca9731406a66b1405a66d0f0000000000000000019562c51a9e73ff4ba589ff56a58aff1b9e71ff0b9a69c50000000000000000078d62c53b977aff549b83ff4e9b81ff3d9779ff0b8b60c5000000000000000008805ac5458b74ff599380ff5c9683ff3e8b71ff097c54c50000000000000000096846c5136a4cff408069ff44816cff1b7152ff046a46c50000000000000000065c3b0f06613e140c5d3f14095d3e1406623f14065d3b0f000000000000000000000000000000000000000000000000000000000000000000000000",
      "BESLES-50325": "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000026190d1b000000000000000000000000000000000000000000000000352e2550443d2dc3131412674b413338000000000000000000000000000000003d2e28542b2b1ffd20241b3a00000000000000000000000000000000000000001d1c1d29161814c2292c2055000000000000000000000000000000000000000014161648070909801517192b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "BESCES-50000RRV": "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007f54510d9456533a813b370d0000000000000000000000000000000074322e9e6b2e2ae2814542ffa2524fde5c1d196c9226202e00000000000000004e3d3cca574343fbc0544ee6c46460e54c4242fe6d2a26c300000000000000000807073c0b0a0a59000000540000005415131359030303350000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "BESLES-50703Maximo": "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000003b251e374b311e0800000000000000000000000000000000000000004343431f834e3ac26f4d33609ba1700b00000000000000000000000000000000664a343c63533cf55e5446cf796f592a000000000000000000000000000000005f3a1e335b6a27d24d7d1b555a3825010000000000000000000000000000000000000000475d258344631f6200000000000000000000000000000000000000003c2917064b321643452e18490000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "BESLES-51759Maximo2": "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000311e18053e271b020000000000000000000000000000000000000000c3221b0165433a72855d3b9184875d0f00000000000000000000000000000000895f534f5e5351ce5f513fda8f634d4f0000000000000000000000000000000095816f777063624c494a35cac67f581400000000000000000000000000000000818a8272000000005a3f2aae5f36221b00000000000000000000000000000000b7b6b921000000005d3a2e4d5a37365300000000000000000000000000000000000000000000000000000000000000000000000000000000"
    };

    let matched = 0;
    const drift = [];
    for (const dir of Object.keys(REFERENCE)) {
      const got = fingerprints[dir];
      if (!got) { drift.push(dir + ": not rendered"); continue; }
      const a = Buffer.from(REFERENCE[dir], "hex"), b = Buffer.from(got, "hex");
      if (a.length !== b.length) { drift.push(dir + ": size changed"); continue; }
      let sum = 0, max = 0;
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        sum += d; if (d > max) max = d;
      }
      const mean = sum / a.length;
      if (mean <= 4 && max <= 24) matched++;
      else drift.push(dir + ": mean " + mean.toFixed(1) + ", max " + max);
    }
    ok("renders match the reference picture (" + matched + " of " +
       Object.keys(REFERENCE).length + ")",
       matched === Object.keys(REFERENCE).length, drift.slice(0, 3).join(" | "));

    /* the same input must give the same bytes twice */
    const one = path.join(tmp, "det1"), two = path.join(tmp, "det2");
    fs.mkdirSync(one, { recursive: true }); fs.mkdirSync(two, { recursive: true });
    execFileSync(CLI, [targets[0][0], "--3d-icons", "/" + targets[0][1]], { cwd: one, encoding: "utf8" });
    execFileSync(CLI, [targets[0][0], "--3d-icons", "/" + targets[0][1]], { cwd: two, encoding: "utf8" });
    const f1 = fs.readdirSync(one)[0], f2 = fs.readdirSync(two)[0];
    ok("rendering is deterministic",
       f1 === f2 && fs.readFileSync(path.join(one, f1)).equals(fs.readFileSync(path.join(two, f2))));
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
