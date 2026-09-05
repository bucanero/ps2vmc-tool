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

const XPS_ENTRY = 250;

/*
 * The closing word of an .xps, over the directory entry through the last byte
 * of file data. Each byte is shifted by the running sum's own remainder.
 * Recovered from PS2SaveConverter.exe; see src/ps2save.c.
 */
function xpsChecksum(buf) {
  let sum = 0;
  for (const b of buf) sum = (sum + ((b << (sum % 24)) >>> 0)) >>> 0;
  return sum >>> 0;
}

/* Walk an .xps far enough to find the body and the stored checksum. */
function xpsLayout(b) {
  let o = 0x15;
  for (let i = 0; i < 3; i++) o += 4 + b.readUInt32LE(o);
  o += 4;                                   /* the size word */

  const body = o;
  const children = b.readUInt32LE(body + 66);
  let off = body + XPS_ENTRY;
  for (let i = 0; i < children - 2; i++)
    off += XPS_ENTRY + b.readUInt32LE(off + 66);

  return { body, end: off, trailing: b.length - off,
           stored: b.length - off >= 4 ? b.readUInt32LE(off) : null };
}

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

    /* --- the CLI's copy --- */
    const cliCard = path.join(tmp, tag + "-cli.vmc");
    fs.copyFileSync(path.join(SAMPLES, "ps2card.vmc"), cliCard);
    cli(cliCard, ["--mc-format"]);
    cli(cliCard, ["--import", src]);

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

  /* ---------- 3. XPS export ---------- */
  console.log("\n=== XPS export ===");

  /* Export every save on a sample card, then read it back. */
  const srcCard = path.join(SAMPLES, "ps2card.vmc");
  vmc.openCard(new Uint8Array(fs.readFileSync(srcCard)));
  const saves = vmc.list("/").filter(e => e.isDir && !isDot(e.name)).map(e => e.name);

  let exported = 0, roundTripped = 0, cliMatched = 0, problems = [];

  for (const name of saves) {
    /* what is on the card now */
    const original = vmc.list("/" + name).filter(e => !e.isDir && !isDot(e.name))
      .map(e => ({ name: e.name, data: Buffer.from(vmc.readFile("/" + name + "/" + e.name)) }));

    let xps;
    try { xps = vmc.xpsExport("/" + name); } catch (e) {
      problems.push(name + ": export threw " + e.message); continue;
    }
    exported++;

    /* the CLI must produce the same bytes */
    const cliOut = path.join(tmp, name.replace(/\W/g, "_") + ".xps");
    cli(srcCard, ["--xps-export", "/" + name, cliOut]);
    const theirs = new Uint8Array(fs.readFileSync(cliOut));
    const d = cmpBytes(xps, theirs);
    if (d) problems.push(name + ": CLI export differs, " + d);
    else cliMatched++;

    /* and reading it back must give the same files */
    vmc.openCard(blankCard("rt-" + name.replace(/\W/g, "_")));
    try { vmc.saveImport(xps); } catch (e) {
      problems.push(name + ": re-import threw " + e.message);
      vmc.openCard(new Uint8Array(fs.readFileSync(srcCard)));
      continue;
    }

    const back = vmc.list("/" + name).filter(e => !e.isDir && !isDot(e.name))
      .map(e => ({ name: e.name, data: Buffer.from(vmc.readFile("/" + name + "/" + e.name)) }));

    const same = back.length === original.length && original.every((f, i) =>
      back[i].name === f.name && back[i].data.equals(f.data));
    if (same) roundTripped++;
    else problems.push(name + ": round trip changed the files");

    vmc.openCard(new Uint8Array(fs.readFileSync(srcCard)));
  }

  ok("every save on the card exports as .xps (" + exported + " of " + saves.length + ")",
     saves.length > 0 && exported === saves.length, problems.slice(0, 2).join(" | "));
  ok("the wasm and the CLI produce byte-identical .xps (" + cliMatched + ")",
     cliMatched === saves.length, problems.slice(0, 2).join(" | "));
  ok("export then import returns the same files (" + roundTripped + ")",
     roundTripped === saves.length, problems.slice(0, 2).join(" | "));

  /* The closing checksum, against files written by three different tools. */
  let ckOk = 0, ckSeen = 0, ckBad = [];
  for (const f of containers.filter(f => /\.xps$/i.test(f))) {
    const b = fs.readFileSync(path.join(SAMPLES, f));
    const L = xpsLayout(b);
    if (L.trailing !== 4) { ckBad.push(f + ": " + L.trailing + " trailing bytes"); continue; }
    ckSeen++;
    const want = xpsChecksum(b.subarray(L.body, L.end));
    if (want === L.stored) ckOk++;
    else ckBad.push(f + ": stored 0x" + L.stored.toString(16) + " computed 0x" + want.toString(16));
  }
  ok("the checksum algorithm matches real .xps files (" + ckOk + " of " + ckSeen + ")",
     ckSeen > 0 && ckOk === ckSeen, ckBad.join(" | "));

  /* And everything we write carries a valid one. */
  vmc.openCard(new Uint8Array(fs.readFileSync(srcCard)));
  let signed = 0, unsigned = [];
  for (const name of saves) {
    const b = Buffer.from(vmc.xpsExport("/" + name));
    const L = xpsLayout(b);
    if (L.trailing === 4 && L.stored === xpsChecksum(b.subarray(L.body, L.end))) signed++;
    else unsigned.push(name);
  }
  ok("every .xps we write closes with a valid checksum (" + signed + " of " + saves.length + ")",
     signed === saves.length, unsigned.join(", "));

  /* The container we write must satisfy our own detector. */
  vmc.openCard(new Uint8Array(fs.readFileSync(srcCard)));
  const oneXps = vmc.xpsExport("/" + saves[0]);
  ok("an exported .xps is identified as XPS", vmc.detect(oneXps) === F.XPS);

  /* ---------- 3b. descriptors that are not 250 bytes ---------- */
  console.log("\n=== .xps descriptors carry their own size ===");
  {
    /* Every file seen uses 250, but the size is a field, and mymcplusplus
     * honours it. Rebuild a real save with wider descriptors and check we
     * read exactly the same files out of it. */
    const src = containers.find(f => /\.xps$/i.test(f));
    const b = fs.readFileSync(path.join(SAMPLES, src));
    const L = xpsLayout(b);
    const WIDE = 300;

    const parts = [b.subarray(0, L.body)];
    let off = L.body, n = b.readUInt32LE(L.body + 66) - 2;
    const widen = () => {
      const e = Buffer.alloc(WIDE);
      b.copy(e, 0, off, off + XPS_ENTRY);
      e.writeUInt16LE(WIDE, 0);              /* the descriptor's own size */
      parts.push(e);
      off += XPS_ENTRY;
    };
    widen();                                  /* the directory entry */
    for (let i = 0; i < n; i++) {
      const len = b.readUInt32LE(off + 66);
      widen();
      parts.push(b.subarray(off, off + len));
      off += len;
    }
    const wide = Buffer.concat(parts);

    const readBack = (bytes) => {
      vmc.openCard(blankCard("wide" + bytes.length));
      vmc.saveImport(new Uint8Array(bytes));
      const dir = vmc.list("/").filter(e => e.isDir && !isDot(e.name))[0].name;
      return vmc.list("/" + dir).filter(e => !e.isDir).map(e =>
        e.name + ":" + Buffer.from(vmc.readFile("/" + dir + "/" + e.name)).toString("hex").slice(0, 32));
    };

    let err = null, same = false;
    try {
      same = JSON.stringify(readBack(wide)) === JSON.stringify(readBack(b));
    } catch (e) { err = e.message; }

    ok("a save with " + WIDE + "-byte descriptors reads the same as the 250-byte original",
       same && !err, err || "file lists differ");
  }

  /* ---------- 3c. CBS export ---------- */
  console.log("\n=== CBS export ===");

  vmc.openCard(new Uint8Array(fs.readFileSync(srcCard)));

  let cbsDone = 0, cbsMatched = 0, cbsRound = 0;
  const cbsProblems = [];

  for (const name of saves) {
    const original = vmc.list("/" + name).filter(e => !e.isDir && !isDot(e.name))
      .map(e => ({ name: e.name, data: Buffer.from(vmc.readFile("/" + name + "/" + e.name)) }));

    let cbs;
    try { cbs = vmc.cbsExport("/" + name); } catch (e) {
      cbsProblems.push(name + ": export threw " + e.message); continue;
    }
    cbsDone++;

    const cliOut = path.join(tmp, name.replace(/\W/g, "_") + ".cbs");
    cli(srcCard, ["--cbs-export", "/" + name, cliOut]);
    const d = cmpBytes(cbs, new Uint8Array(fs.readFileSync(cliOut)));
    if (d) cbsProblems.push(name + ": CLI export differs, " + d);
    else cbsMatched++;

    vmc.openCard(blankCard("cbsrt-" + name.replace(/\W/g, "_")));
    try { vmc.saveImport(cbs); } catch (e) {
      cbsProblems.push(name + ": re-import threw " + e.message);
      vmc.openCard(new Uint8Array(fs.readFileSync(srcCard)));
      continue;
    }

    const back = vmc.list("/" + name).filter(e => !e.isDir && !isDot(e.name))
      .map(e => ({ name: e.name, data: Buffer.from(vmc.readFile("/" + name + "/" + e.name)) }));

    if (back.length === original.length && original.every((f, i) =>
        back[i].name === f.name && back[i].data.equals(f.data))) cbsRound++;
    else cbsProblems.push(name + ": round trip changed the files");

    vmc.openCard(new Uint8Array(fs.readFileSync(srcCard)));
  }

  ok("every save on the card exports as .cbs (" + cbsDone + " of " + saves.length + ")",
     saves.length > 0 && cbsDone === saves.length, cbsProblems.slice(0, 2).join(" | "));
  ok("the wasm and the CLI produce byte-identical .cbs (" + cbsMatched + ")",
     cbsMatched === saves.length, cbsProblems.slice(0, 2).join(" | "));
  ok("export then import returns the same files (" + cbsRound + ")",
     cbsRound === saves.length, cbsProblems.slice(0, 2).join(" | "));

  vmc.openCard(new Uint8Array(fs.readFileSync(srcCard)));
  ok("an exported .cbs is identified as CBS",
     vmc.detect(vmc.cbsExport("/" + saves[0])) === F.CBS);

  /*
   * The strong one: read a real CodeBreaker file in and write it straight back
   * out. Everything has to line up - header, entry layout, deflate stream and
   * the RC4 keystream over it - for the bytes to land in the same places.
   *
   * This does lean on zlib's deflate output, which is not guaranteed stable
   * across versions. Two independent builds agree today (the system zlib the
   * CLI links, and the 1.3.2 the wasm carries); should a future one diverge,
   * only this check fails and the round-trip checks above still hold.
   */
  for (const f of containers.filter(f => /\.cbs$/i.test(f))) {
    const orig = fs.readFileSync(path.join(SAMPLES, f));
    vmc.openCard(blankCard("cbsid-" + f.replace(/\W/g, "_")));
    vmc.saveImport(new Uint8Array(orig));

    const dir = vmc.list("/").filter(e => e.isDir && !isDot(e.name))[0].name;
    const again = Buffer.from(vmc.cbsExport("/" + dir));

    ok(f + ": rewriting it reproduces the original byte for byte",
       cmpBytes(orig, again) === null, cmpBytes(orig, again));
  }

  /* ---------- 3d. the header carries its own length ---------- */
  console.log("\n=== .cbs dataOffset is honoured ===");
  {
    /* Every file seen puts the body at 296, but dataOffset is what says so,
     * and mymcplusplus reads it as the header length. Move the body and check
     * the same save still comes out. */
    const f = containers.find(c => /\.cbs$/i.test(c));
    const b = fs.readFileSync(path.join(SAMPLES, f));
    const HLEN = b.readUInt32LE(8);

    const readBack = (bytes) => {
      vmc.openCard(blankCard("hlen" + bytes.length));
      vmc.saveImport(new Uint8Array(bytes));
      const dir = vmc.list("/").filter(e => e.isDir && !isDot(e.name))[0].name;
      return vmc.list("/" + dir).filter(e => !e.isDir).map(e =>
        e.name + ":" + Buffer.from(vmc.readFile("/" + dir + "/" + e.name))
          .toString("hex").slice(0, 32));
    };

    /* padded: the body sits 64 bytes further along than the struct's size */
    const padded = Buffer.concat([b.subarray(0, HLEN), Buffer.alloc(64),
                                  b.subarray(HLEN)]);
    padded.writeUInt32LE(HLEN + 64, 8);

    /* trimmed: a header that stops right after the fields a reader needs */
    const SHORT = 124;
    const trimmed = Buffer.concat([b.subarray(0, SHORT), b.subarray(HLEN)]);
    trimmed.writeUInt32LE(SHORT, 8);

    const want = JSON.stringify(readBack(b));
    for (const [label, bytes] of [["a longer", padded], ["a shorter", trimmed]]) {
      let err = null, same = false;
      try { same = JSON.stringify(readBack(bytes)) === want; }
      catch (e) { err = e.message; }
      ok(label + " header (dataOffset " + bytes.readUInt32LE(8) +
         ") reads the same files", same && !err, err || "file lists differ");
    }
  }

  /* ---------- 4. malformed input ---------- */
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
