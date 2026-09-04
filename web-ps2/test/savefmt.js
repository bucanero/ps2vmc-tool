/*
 * savefmt.js - checks for the third-party save container readers.
 *
 * CodeBreaker (.cbs), Action Replay MAX (.max) and Xploder/SharkPort (.xps)
 * are read by src/ps2save.c, which both the CLI and the wasm build share. Each
 * container found in samples/ is imported twice - once through the wasm, once
 * through ./ps2vmc-tool - and the resulting saves are compared file by file.
 *
 * Every .cbs/.max/.xps in samples/ is picked up automatically, so dropping a
 * real save in there extends the coverage without touching this file.
 *
 *     node web-ps2/test/savefmt.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "ps2vmc-tool");
const SAMPLES = path.join(ROOT, "samples");
const PS2VMC = require(path.join(__dirname, "..", "ps2vmc.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps2fmt-"));
let pass = 0, fail = 0;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  — " + detail : "")); }
}

function cli(cardPath, args) {
  return execFileSync(CLI, [cardPath].concat(args), { encoding: "utf8" });
}

/* A blank formatted card to import into, so nothing collides. */
function blankCard(tag) {
  const p = path.join(tmp, tag + ".vmc");
  fs.copyFileSync(path.join(SAMPLES, "ps2card.vmc"), p);
  cli(p, ["--mc-format"]);
  return fs.readFileSync(p);
}

function cmpBytes(a, b) {
  if (a.length !== b.length) return "length " + a.length + " vs " + b.length;
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) return "first difference at 0x" + i.toString(16);
  return null;
}

/* Directory entries the CLI lists but a save does not own. */
const isDot = n => n === "." || n === "..";

async function main() {
  const vmc = await PS2VMC.load();
  const F = PS2VMC.FORMAT;

  const containers = fs.readdirSync(SAMPLES)
    .filter(f => /\.(cbs|max|xps)$/i.test(f))
    .sort();

  /* ---------- 1. format detection ---------- */
  console.log("\n=== format detection ===");

  const expectFor = f => ({ cbs: F.CBS, max: F.MAX, xps: F.XPS })[
    path.extname(f).slice(1).toLowerCase()];

  let detected = 0, misdetected = [];
  for (const f of containers) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(SAMPLES, f)));
    const got = vmc.detect(bytes);
    if (got === expectFor(f)) detected++;
    else misdetected.push(f + ": got " + PS2VMC.FORMAT_NAME[got]);
  }
  ok("every container in samples/ is identified from its contents (" +
     detected + " of " + containers.length + ")",
     containers.length > 0 && misdetected.length === 0, misdetected.join(", "));

  /* The existing formats must keep detecting correctly now that one function
   * decides for all of them. */
  const psu = path.join(tmp, "probe.psu");
  cli(path.join(SAMPLES, "ps2card.vmc"), ["--psu-export", "/APOLLO-99PS2", psu]);
  ok("a .psu is still identified as PSU",
     vmc.detect(new Uint8Array(fs.readFileSync(psu))) === F.PSU);

  const psv = path.join(tmp, "probe.psv");
  cli(path.join(SAMPLES, "ps2card.vmc"), ["--psv-export", "/APOLLO-99PS2", psv]);
  ok("a .psv is still identified as PSV",
     vmc.detect(new Uint8Array(fs.readFileSync(psv))) === F.PSV);

  ok("random bytes are not identified as a save",
     vmc.detect(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])) === F.UNKNOWN);
  ok("an empty buffer is not identified as a save",
     vmc.detect(new Uint8Array(0)) === F.UNKNOWN);

  /* ---------- 2. wasm import vs CLI import ---------- */
  console.log("\n=== container import: wasm vs ps2vmc-tool ===");

  for (const f of containers) {
    const src = path.join(SAMPLES, f);
    const bytes = new Uint8Array(fs.readFileSync(src));
    const tag = path.basename(f).replace(/\W/g, "_");
    const kind = path.extname(f).slice(1).toLowerCase();

    /* --- the CLI's copy --- */
    const cliCard = path.join(tmp, tag + "-cli.vmc");
    fs.copyFileSync(path.join(SAMPLES, "ps2card.vmc"), cliCard);
    cli(cliCard, ["--mc-format"]);
    cli(cliCard, ["--" + kind + "-import", src]);

    /* --- the wasm's copy --- */
    vmc.openCard(blankCard(tag));
    let importErr = null;
    try { vmc.saveImport(bytes); } catch (e) { importErr = e.message; }
    ok(f + ": wasm import succeeds", importErr === null, importErr);
    if (importErr) continue;

    const dirs = vmc.list("/").filter(e => e.isDir && !isDot(e.name));
    ok(f + ": exactly one save directory created", dirs.length === 1,
       dirs.map(d => d.name).join(", "));
    if (dirs.length !== 1) continue;

    const dir = dirs[0].name;

    /* The CLI wrote the same save; compare the two file by file. */
    const cliDump = path.join(tmp, tag + "-cli");
    fs.mkdirSync(cliDump, { recursive: true });

    const ours = vmc.list("/" + dir).filter(e => !e.isDir && !isDot(e.name));
    let same = 0, problems = [];

    for (const entry of ours) {
      const mine = vmc.readFile("/" + dir + "/" + entry.name);
      const out = path.join(cliDump, entry.name.replace(/\W/g, "_"));
      try {
        cli(cliCard, ["--extract-file", "/" + dir + "/" + entry.name, out]);
      } catch (e) {
        problems.push(entry.name + ": CLI could not extract it");
        continue;
      }
      const theirs = new Uint8Array(fs.readFileSync(out));
      const d = cmpBytes(mine, theirs);
      if (d) problems.push(entry.name + ": " + d);
      else same++;
    }

    ok(f + ": " + ours.length + " files match the CLI byte for byte",
       ours.length > 0 && problems.length === 0,
       problems.slice(0, 3).join(" | "));

    /* The CLI's own listing must agree on the file set. */
    /* Only the table rows carry a "|"; the banner and header do not. */
    const cliNames = cli(cliCard, ["--list", "/" + dir])
      .split("\n")
      .filter(l => l.includes("|"))
      .map(l => l.split("|")[0].trim())
      .filter(n => n && !isDot(n) && !n.startsWith("-"));
    const mineNames = ours.map(e => e.name).sort();
    ok(f + ": the CLI lists the same files",
       JSON.stringify(cliNames.filter(n => mineNames.includes(n)).sort()) ===
       JSON.stringify(mineNames),
       "cli=" + cliNames.join(",") + " wasm=" + mineNames.join(","));
  }

  /* ---------- 3. malformed input ---------- */
  console.log("\n=== malformed containers are rejected ===");

  for (const f of containers) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(SAMPLES, f)));
    const tag = path.basename(f).replace(/\W/g, "_");

    /* Truncation must be an error, not a crash and not a partial save. */
    let threw = 0, cases = 0;
    for (const frac of [0.25, 0.5, 0.75]) {
      const cut = bytes.subarray(0, Math.floor(bytes.length * frac));
      vmc.openCard(blankCard(tag + "-cut" + frac));
      cases++;
      try { vmc.saveImport(cut); } catch (e) { threw++; }
    }
    ok(f + ": truncated copies are rejected (" + threw + " of " + cases + ")",
       threw === cases);
  }

  /* A header with a plausible magic but nothing behind it. */
  const stubs = {
    CBS: Uint8Array.from([0x43, 0x46, 0x55, 0x00]),
    MAX: new Uint8Array(Buffer.from("Ps2PowerSave\0\0\0\0", "binary")),
    XPS: (() => { const b = new Uint8Array(0x15); b.set(Buffer.from("SharkPortSave\0\0\0", "binary"), 4); return b; })()
  };
  let stubOk = 0;
  for (const [name, b] of Object.entries(stubs)) {
    vmc.openCard(blankCard("stub" + name));
    try { vmc.saveImport(b); } catch (e) { stubOk++; }
  }
  ok("a bare " + Object.keys(stubs).join("/") + " header with no body is rejected",
     stubOk === Object.keys(stubs).length, stubOk + " of " + Object.keys(stubs).length);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
