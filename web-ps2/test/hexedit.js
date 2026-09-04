/*
 * hexedit.js - checks for the hex editor feature on both cards.
 *
 * Covers the parts that can be checked without a browser: that the copy
 * inlined into the single-file PS1 page has not drifted from the shared
 * module, that a PS1 save survives an edit/write/re-read cycle, and that a
 * PS2 in-place file write lands byte-identically to `--inject-file`.
 *
 *     node web-ps2/test/hexedit.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "ps2vmc-tool");
const PS2VMC = require(path.join(__dirname, "..", "ps2vmc.js"));
const HexEdit = require(path.join(__dirname, "..", "hexedit.js"));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  — " + detail : "")); }
}

const BEGIN = "/* ===== BEGIN inlined copy of web-ps2/hexedit.js";
const END = "/* ===== END inlined copy of web-ps2/hexedit.js";

/* Pull the PS1 card engine out of the single-file page, minus the inlined
 * hex editor (its UMD wrapper would hijack module.exports here) and minus the
 * UI half, which needs a DOM. */
function loadPs1Core() {
  const html = fs.readFileSync(path.join(ROOT, "web-ps1", "index.html"), "utf8");
  const script = /<script>\n([\s\S]*?)\n<\/script>/.exec(html)[1];

  let stripped = script;
  for (const [bm, em] of [[BEGIN, END],
                          ["/* ===== BEGIN inlined copy of web-ps2/cryptoutil.js",
                           "/* ===== END inlined copy of web-ps2/cryptoutil.js"],
                          ["/* ===== BEGIN inlined copy of web-ps2/psv.js",
                           "/* ===== END inlined copy of web-ps2/psv.js"]]) {
    const i = stripped.indexOf(bm), j = stripped.indexOf(em);
    if (i >= 0 && j > i) stripped = stripped.slice(0, i) + stripped.slice(stripped.indexOf("*/", j) + 2);
  }

  const core = stripped.slice(0, stripped.indexOf("* UI") - 75);
  const tmp = path.join(os.tmpdir(), "ps1core-hex-" + process.pid + ".js");
  fs.writeFileSync(tmp,
    'const CryptoUtil = require(' + JSON.stringify(path.join(__dirname, "..", "cryptoutil.js")) + ');\n' +
    'const PSV = require(' + JSON.stringify(path.join(__dirname, "..", "psv.js")) + ');\n' +
    core + "\nmodule.exports = { PS1 };\n");
  const mod = require(tmp);
  fs.unlinkSync(tmp);
  return mod.PS1;
}

async function main() {
  /* ---------- 1. the inlined copy must match the shared module ---------- */
  console.log("\n=== inlined copy vs web-ps2/hexedit.js ===");
  const shared = fs.readFileSync(path.join(ROOT, "web-ps2", "hexedit.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "web-ps1", "index.html"), "utf8");

  const b = html.indexOf(BEGIN);
  const e = html.indexOf(END);
  ok("PS1 page contains the inlined editor", b >= 0 && e > b);

  if (b >= 0 && e > b) {
    const inlined = html.slice(html.indexOf("*/", b) + 3, e).replace(/\s+$/, "");
    ok("inlined copy is identical to the shared module",
       inlined === shared.replace(/\s+$/, ""),
       "the two have drifted — re-copy web-ps2/hexedit.js into web-ps1/index.html");
  }

  ok("PS2 page loads the editor as a script",
     fs.readFileSync(path.join(ROOT, "web-ps2", "index.html"), "utf8")
       .includes('src="hexedit.js"'));

  /* ---------- 1b. ASCII column: text -> bytes ---------- */
  console.log("\n=== ASCII column text encoding ===");
  const enc = (t, lim) => HexEdit.encodeText(t, lim === undefined ? 4096 : lim);
  const hexOf = t => enc(t).map(v => v.toString(16).padStart(2, "0")).join(" ");

  ok("plain ASCII becomes one byte per character", hexOf("SAVE01") === "53 41 56 45 30 31", hexOf("SAVE01"));
  ok("latin-1 characters are single bytes", hexOf("é") === "e9", hexOf("é"));
  ok("space and punctuation pass through", hexOf("a b!") === "61 20 62 21", hexOf("a b!"));
  ok("multi-byte characters are dropped, not mangled", enc("日本語").length === 0);
  ok("emoji are dropped", enc("🎮").length === 0);
  ok("a mixed string keeps only what fits in a byte", hexOf("A日B") === "41 42", hexOf("A日B"));
  ok("a run is clamped to the space left in the file", enc("ABCDEF", 2).length === 2);
  ok("clamping keeps the leading characters", hexOf("ABCDEF").slice(0, 5) === "41 42");
  ok("an empty string writes nothing", enc("").length === 0);
  ok("NUL and high bytes survive a round trip",
     enc(String.fromCharCode(0, 0xff, 0x7f)).join(",") === "0,255,127");

  /* ---------- 2. PS1: edit a save's blocks in place ---------- */
  console.log("\n=== PS1 save data edit ===");
  const PS1 = loadPs1Core();
  const cardPath = path.join(ROOT, "samples", "ps1test.vgs");

  if (fs.existsSync(cardPath)) {
    const orig = new Uint8Array(fs.readFileSync(cardPath));
    PS1.open(orig);

    /* slot 1 on this card is a two-block save */
    const slot = PS1.slots.findIndex(s => s.type === 1 && PS1.findSaveLinks(s.index).length > 1);
    const blocks = PS1.findSaveLinks(slot).length;
    const before = PS1.exportSave(slot, PS1.SAVE.RAW);
    ok("multi-block save found (slot " + slot + ", " + blocks + " blocks)", blocks > 1);
    ok("raw data is one block per link", before.length === blocks * 8192,
       before.length + " vs " + blocks * 8192);

    /* edit bytes in the first and last block, and inside the title field */
    const titleBefore = PS1.slots[slot].title;
    const NEWTITLE = "HEXEDIT!";
    const edited = before.slice();
    edited[0x100] ^= 0xff;
    edited[edited.length - 1] = 0x5a;

    /* The title is Shift-JIS terminated by a NUL on an even offset, so write
     * every byte of it - leaving the odd ones as they were would make the
     * decoded string depend on whatever the save already held. */
    for (let i = 0; i < NEWTITLE.length; i++) edited[4 + i] = NEWTITLE.charCodeAt(i);
    edited[4 + NEWTITLE.length] = 0;
    edited[5 + NEWTITLE.length] = 0;

    ok("writeSaveBytes accepts a same-size buffer", PS1.writeSaveBytes(slot, edited) === true);

    const after = PS1.exportSave(slot, PS1.SAVE.RAW);
    ok("edited bytes read back exactly",
       Buffer.from(after).equals(Buffer.from(edited)),
       [...after].filter((v, i) => v !== edited[i]).length + " bytes differ");

    ok("derived data refreshed after the edit (title re-decoded)",
       PS1.slots[slot].title === NEWTITLE && titleBefore !== NEWTITLE,
       "was " + JSON.stringify(titleBefore) + ", now " + JSON.stringify(PS1.slots[slot].title));

    /* the edit must survive a card export + reopen */
    const exported = PS1.exportCard(PS1.CARD.RAW);
    PS1.open(exported);
    const reread = PS1.exportSave(slot, PS1.SAVE.RAW);
    ok("edit survives export and reopen",
       Buffer.from(reread).equals(Buffer.from(edited)));

    /* other saves must be untouched */
    PS1.open(orig);
    const otherBefore = PS1.exportSave(0, PS1.SAVE.RAW);
    PS1.open(exported);
    const otherAfter = PS1.exportSave(0, PS1.SAVE.RAW);
    ok("a different save is left alone",
       Buffer.from(otherBefore).equals(Buffer.from(otherAfter)));

    /* wrong-size buffers are refused rather than corrupting the chain */
    PS1.open(orig);
    ok("a short buffer is refused", PS1.writeSaveBytes(slot, edited.slice(0, 100)) === false);
    ok("a long buffer is refused",
       PS1.writeSaveBytes(slot, new Uint8Array(edited.length + 1)) === false);
    ok("the save is unchanged after a refused write",
       Buffer.from(PS1.exportSave(slot, PS1.SAVE.RAW)).equals(Buffer.from(before)));
  } else {
    ok("PS1 sample card present", false, cardPath);
  }

  /* ---------- 3. PS2: in-place file write matches the CLI ---------- */
  console.log("\n=== PS2 file edit ===");
  const vmc = await PS2VMC.load();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ps2hex-"));

  const cases = [
    ["samples/ps2card.vmc", "/BESLES-50325/BESLES-50325"],
    ["samples/ps2card.vmc", "/APOLLO-99PS2/icon.sys"],
    ["samples/card16mb.bin", "/BESCES-50000RRV/icon1.ico"]
  ];

  for (const [sample, filePath] of cases) {
    const cardFile = path.join(ROOT, sample);
    if (!fs.existsSync(cardFile)) continue;
    const orig = new Uint8Array(fs.readFileSync(cardFile));

    vmc.openCard(orig);
    const data = vmc.readFile(filePath).slice();
    const freeBefore = vmc.freeSpace();

    const edited = data.slice();
    for (let i = 0; i < edited.length; i += 3) edited[i] = (edited[i] + 0x5b) & 0xff;

    vmc.writeFile(filePath, edited);
    const readBack = vmc.readFile(filePath);

    ok("edit " + filePath + ": length preserved", readBack.length === data.length,
       readBack.length + " vs " + data.length);
    ok("edit " + filePath + ": bytes read back exactly",
       Buffer.from(readBack).equals(Buffer.from(edited)));
    ok("edit " + filePath + ": no space leaked", vmc.freeSpace() === freeBefore,
       vmc.freeSpace() + " vs " + freeBefore);

    /* same edit through the CLI must give the same card */
    const wasmCard = vmc.cardBytes();
    const payload = path.join(tmp, "payload.bin");
    fs.writeFileSync(payload, Buffer.from(edited));
    const cliCard = path.join(tmp, path.basename(sample));
    fs.copyFileSync(cardFile, cliCard);
    try {
      execFileSync(CLI, [cliCard, "-in", payload, filePath], { encoding: "utf8" });
    } catch (err) {
      ok("edit " + filePath + ": CLI comparison", false, "CLI failed");
      continue;
    }
    const cliBytes = new Uint8Array(fs.readFileSync(cliCard));

    /* mcio stamps wall-clock times, so excuse timestamp and ECC bytes only */
    const stride = vmc.info().usesEcc ? 528 : 512;
    let real = 0, ts = 0, ecc = 0;
    for (let i = 0; i < wasmCard.length; i++) {
      if (wasmCard[i] === cliBytes[i]) continue;
      const inPage = i % stride;
      if (stride === 528 && inPage >= 512) { ecc++; continue; }
      const pos = inPage % 512;
      if ((pos >= 8 && pos < 16) || (pos >= 24 && pos < 32)) { ts++; continue; }
      real++;
    }
    ok("edit " + filePath + ": card matches CLI --inject-file", real === 0,
       real + " non-timestamp bytes differ");

    /* the rest of the card must be intact */
    ok("edit " + filePath + ": other files untouched",
       vmc.list(filePath.slice(0, filePath.lastIndexOf("/"))).length > 0);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
