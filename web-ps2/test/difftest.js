/*
 * difftest.js - differential test: WebAssembly module vs the ps2vmc-tool CLI.
 *
 * Every operation is run twice, once through the wasm build and once through
 * the native binary, and the resulting card images are compared byte for byte.
 * Both sides execute the same C, so any difference means the bridge in
 * web_api.c or ps2vmc.js is wrong.
 *
 *     node web-ps2/test/difftest.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "ps2vmc-tool");
const PS2VMC = require(path.join(__dirname, "..", "ps2vmc.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps2diff-"));
let pass = 0, fail = 0;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  — " + detail : "")); }
}

function cli(cardPath, args) {
  return execFileSync(CLI, [cardPath].concat(args), { encoding: "utf8" });
}

function tmpCard(src, tag) {
  const p = path.join(tmp, tag + path.extname(src));
  fs.copyFileSync(src, p);
  return p;
}

function cmpBytes(a, b) {
  if (a.length !== b.length) return "length " + a.length + " vs " + b.length;
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) return "first difference at 0x" + i.toString(16);
  return null;
}

/*
 * mcio stamps directory entries with wall-clock time(), so two runs of the
 * same mutation legitimately differ if they straddle a second boundary.
 * Classify each differing byte: a difference is excusable only if it lands in
 * an MCFsEntry created/modified field (offsets 8..15 and 24..31 of the
 * 512-byte entry) or in an ECC spare area, which is recomputed when the page
 * data changes. Anything else is a real mismatch.
 *
 * struct MCFsEntry: mode@0 length@4 created@8 cluster@16 dir_entry@20
 *                   modified@24 attr@32 name@64
 */
function classifyDiff(a, b, usesEcc) {
  if (a.length !== b.length)
    return { equal: false, reason: "length " + a.length + " vs " + b.length };

  const stride = usesEcc ? 528 : 512;
  let timestampBytes = 0, eccBytes = 0;
  const realDiffs = [];

  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const inPage = i % stride;
    if (usesEcc && inPage >= 512) { eccBytes++; continue; }
    const pos = inPage % 512;
    if ((pos >= 8 && pos < 16) || (pos >= 24 && pos < 32)) { timestampBytes++; continue; }
    if (realDiffs.length < 8) realDiffs.push("0x" + i.toString(16) + " (entry+" + pos + ")");
  }

  if (realDiffs.length)
    return { equal: false, reason: realDiffs.length + " non-timestamp bytes differ: " + realDiffs.join(", ") };

  return { equal: true, timestampBytes, eccBytes };
}

/* The CLI prints a fixed-width table; parse it back into entries. */
function parseCliList(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^(.{32})\|\s*<(dir|file)>\s*\|\s*(\d+)\s*\|\s*(\S+)\s*\|\s*(\S+)/);
    if (!m) continue;
    out.push({ name: m[1].trim(), isDir: m[2] === "dir", size: +m[3], attrs: m[4], mtime: m[5] });
  }
  return out;
}

async function main() {
  if (!fs.existsSync(CLI)) {
    console.error("build the CLI first: make");
    process.exit(1);
  }

  const vmc = await PS2VMC.load();
  const samples = ["samples/ps2card.vmc", "samples/card8mb.bin", "samples/card16mb.bin",
                   "samples/card32mb.bin", "samples/oplcard.bin"]
    .map(s => path.join(ROOT, s))
    .filter(fs.existsSync);

  for (const sample of samples) {
    const label = path.basename(sample);
    console.log("\n=== " + label + " (" + fs.statSync(sample).size + " bytes) ===");

    const bytes = new Uint8Array(fs.readFileSync(sample));

    /* ---------- read-only parity ---------- */
    let info;
    try {
      info = vmc.openCard(bytes);
    } catch (e) {
      ok("open card", false, e.message);
      continue;
    }
    ok("open card", true);

    const cliInfo = cli(sample, ["-i"]);
    const cliPage = +(cliInfo.match(/Page size:\s+(\d+)/) || [])[1];
    const cliBlock = +(cliInfo.match(/Block size:\s+(\d+)/) || [])[1];
    const cliMB = +(cliInfo.match(/MC size:\s+(\d+)/) || [])[1];
    ok("page size matches CLI", info.pageSize === cliPage, info.pageSize + " vs " + cliPage);
    ok("block size matches CLI", info.blockSize === cliBlock, info.blockSize + " vs " + cliBlock);
    ok("card size matches CLI", Math.floor(info.cardSize / 1024 / 1024) === cliMB,
       Math.floor(info.cardSize / 1024 / 1024) + " vs " + cliMB);
    ok("ECC flag matches CLI", info.usesEcc === /claims to support ECC/.test(cliInfo));

    const cliFree = +(cli(sample, ["-f"]).match(/Available space:\s+(\d+)\s+KB/) || [])[1];
    ok("free space matches CLI", Math.floor(vmc.freeSpace() / 1024) === cliFree,
       Math.floor(vmc.freeSpace() / 1024) + "KB vs " + cliFree + "KB");

    const wasmRoot = vmc.list("/", true);
    const cliRoot = parseCliList(cli(sample, ["-ls", "/"]));
    ok("root listing count matches CLI", wasmRoot.length === cliRoot.length,
       wasmRoot.length + " vs " + cliRoot.length);

    let listMatch = wasmRoot.length === cliRoot.length;
    for (let i = 0; listMatch && i < wasmRoot.length; i++) {
      const w = wasmRoot[i], cE = cliRoot[i];
      if (w.name !== cE.name || w.isDir !== cE.isDir || w.size !== cE.size || w.attrText !== cE.attrs)
        listMatch = false;
    }
    ok("root listing content matches CLI", listMatch);

    /* ---------- image dumps ---------- */
    const rawOut = path.join(tmp, label + ".raw");
    cli(sample, ["-img", rawOut]);
    ok("--mc-image matches wasm", cmpBytes(vmc.imageRaw(), new Uint8Array(fs.readFileSync(rawOut))) === null,
       cmpBytes(vmc.imageRaw(), new Uint8Array(fs.readFileSync(rawOut))) || "");

    const eccOut = path.join(tmp, label + ".ecc");
    cli(sample, ["-ecc", eccOut]);
    ok("--ecc-image matches wasm", cmpBytes(vmc.imageEcc(), new Uint8Array(fs.readFileSync(eccOut))) === null,
       cmpBytes(vmc.imageEcc(), new Uint8Array(fs.readFileSync(eccOut))) || "");

    /* ---------- per-save PSU export ---------- */
    const dirs = wasmRoot.filter(e => e.isDir && e.name !== "." && e.name !== "..");
    for (const d of dirs.slice(0, 3)) {
      const psuOut = path.join(tmp, label + "." + d.name + ".psu");
      try {
        cli(sample, ["-px", "/" + d.name, psuOut]);
      } catch (e) {
        ok("PSU export " + d.name + " (CLI)", false, "CLI failed");
        continue;
      }
      const wasmPsu = vmc.psuExport("/" + d.name);
      const diff = cmpBytes(wasmPsu, new Uint8Array(fs.readFileSync(psuOut)));
      ok("PSU export " + d.name + " matches CLI", diff === null, diff || "");
    }

    /* ---------- file extraction ---------- */
    const files = vmc.walk("/").filter(e => !e.isDir).slice(0, 5);
    for (const f of files) {
      const outp = path.join(tmp, "x.bin");
      try {
        cli(sample, ["-x", f.path, outp]);
      } catch (e) {
        ok("extract " + f.path + " (CLI)", false, "CLI failed");
        continue;
      }
      const diff = cmpBytes(vmc.readFile(f.path), new Uint8Array(fs.readFileSync(outp)));
      ok("extract " + f.path + " matches CLI", diff === null, diff || "");
    }

    /* ---------- mutations: same edit both sides, compare whole card ---------- */
    const mutations = [
      {
        name: "mkdir",
        wasm: v => v.mkdir("/DIFFTEST"),
        cli: p => cli(p, ["-mkdir", "/DIFFTEST"])
      },
      {
        name: "inject file",
        setup: () => {
          const payload = Buffer.alloc(3000);
          for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) & 0xff;
          const src = path.join(tmp, "payload.bin");
          fs.writeFileSync(src, payload);
          return src;
        },
        wasm: (v, src) => { v.mkdir("/DIFFTEST"); v.writeFile("/DIFFTEST/DATA.BIN", new Uint8Array(fs.readFileSync(src))); },
        cli: (p, src) => { cli(p, ["-mkdir", "/DIFFTEST"]); cli(p, ["-in", src, "/DIFFTEST/DATA.BIN"]); }
      },
      {
        name: "remove file",
        wasm: v => { const f = v.walk("/").filter(e => !e.isDir)[0]; v.remove(f.path); },
        cli: (p, _s, v) => { const f = v.walk("/").filter(e => !e.isDir)[0]; cli(p, ["-rm", f.path]); }
      },
      {
        name: "format",
        wasm: v => v.format(),
        cli: p => cli(p, ["--mc-format"])
      }
    ];

    for (const m of mutations) {
      const src = m.setup ? m.setup() : null;

      /* reference card for path selection */
      vmc.openCard(bytes);
      const ref = vmc;

      const cardPath = tmpCard(sample, "mut-" + m.name.replace(/\s+/g, "-"));
      try {
        m.cli(cardPath, src, ref);
      } catch (e) {
        ok(m.name + " (CLI)", false, String(e.message).split("\n")[0]);
        continue;
      }
      const cliCard = new Uint8Array(fs.readFileSync(cardPath));

      vmc.openCard(bytes);
      try {
        m.wasm(vmc, src);
      } catch (e) {
        ok(m.name + " (wasm)", false, e.message);
        continue;
      }
      const wasmCard = vmc.cardBytes();

      const v = classifyDiff(wasmCard, cliCard, info.usesEcc);
      const note = v.equal && (v.timestampBytes || v.eccBytes)
        ? "identical except " + v.timestampBytes + " clock bytes + " + v.eccBytes + " ECC bytes"
        : v.reason || "";
      ok(m.name + ": card image matches CLI" + (note ? " (" + note + ")" : ""), v.equal, v.reason);
    }

    /* ---------- PSU round trip ---------- */
    if (dirs.length) {
      const d = dirs[0];
      vmc.openCard(bytes);
      const psu = vmc.psuExport("/" + d.name);
      vmc.remove; /* no-op, keep linter quiet */

      /* CLI: export, remove dir contents, re-import */
      const cardPath = tmpCard(sample, "psu-rt");
      const psuPath = path.join(tmp, "rt.psu");
      fs.writeFileSync(psuPath, Buffer.from(psu));

      vmc.openCard(bytes);
      let wasmErr = null;
      try { vmc.psuImport(psu); } catch (e) { wasmErr = e.message; }

      let cliErr = null;
      try { cli(cardPath, ["-pu", psuPath]); } catch (e) { cliErr = String(e.message).split("\n")[0]; }

      if (wasmErr || cliErr) {
        ok("PSU re-import behaves like CLI", wasmErr && cliErr,
           "wasm: " + wasmErr + " / cli: " + cliErr);
      } else {
        const v = classifyDiff(vmc.cardBytes(), new Uint8Array(fs.readFileSync(cardPath)), info.usesEcc);
        const note = v.equal && (v.timestampBytes || v.eccBytes)
          ? "identical except " + v.timestampBytes + " clock bytes + " + v.eccBytes + " ECC bytes"
          : "";
        ok("PSU re-import: card image matches CLI" + (note ? " (" + note + ")" : ""), v.equal, v.reason);
      }
    }
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
