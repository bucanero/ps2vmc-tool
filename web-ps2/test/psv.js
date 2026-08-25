/*
 * psv.js - checks for PS3 .PSV export and signing.
 *
 * The signature is the part that has to be exactly right, so where a build of
 * psv-save-converter is available the whole file is compared against it byte
 * for byte. Without it, the structural and self-consistency checks still run.
 *
 * Point PSV_CONVERTER at the reference binary to enable the comparison:
 *     PSV_CONVERTER=~/github/psv-save-converter/psv-save-converter \
 *         node web-ps2/test/psv.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const PS1CLI = path.join(ROOT, "ps1vmc-tool");
const PS2CLI = path.join(ROOT, "ps2vmc-tool");
const PSV = require(path.join(__dirname, "..", "psv.js"));
const PS2VMC = require(path.join(__dirname, "..", "ps2vmc.js"));
const PS2Icon = require(path.join(__dirname, "..", "ps2icon.js"));
const CU = require(path.join(__dirname, "..", "cryptoutil.js"));

/* the reference implementation, if the user has one built */
const CONVERTER = (process.env.PSV_CONVERTER ||
  path.join(os.homedir(), "github", "psv-save-converter", "psv-save-converter"));
const HAVE_CONVERTER = fs.existsSync(CONVERTER);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  — " + detail : "")); }
}

const BEGIN = "/* ===== BEGIN inlined copy of web-ps2/psv.js";
const END = "/* ===== END inlined copy of web-ps2/psv.js";

/* The PS1 engine lives inside the single-file page; pull it out, drop the
 * inlined UMD modules (they would fight over module.exports) and hand it the
 * PSV module the export path needs. */
function loadPs1Core() {
  const html = fs.readFileSync(path.join(ROOT, "web-ps1", "index.html"), "utf8");
  let script = /<script>\n([\s\S]*?)\n<\/script>/.exec(html)[1];

  for (const [b, e] of [[BEGIN, END],
                        ["/* ===== BEGIN inlined copy of web-ps2/cryptoutil.js",
                         "/* ===== END inlined copy of web-ps2/cryptoutil.js"],
                        ["/* ===== BEGIN inlined copy of web-ps2/hexedit.js",
                         "/* ===== END inlined copy of web-ps2/hexedit.js"]]) {
    const i = script.indexOf(b), j = script.indexOf(e);
    if (i >= 0 && j > i) script = script.slice(0, i) + script.slice(script.indexOf("*/", j) + 2);
  }

  const core = script.slice(0, script.indexOf("* UI") - 75);
  const tmp = path.join(os.tmpdir(), "ps1core-psv-" + process.pid + ".js");
  fs.writeFileSync(tmp,
    'const CryptoUtil = require(' + JSON.stringify(path.join(__dirname, "..", "cryptoutil.js")) + ');\n' +
    'const PSV = require(' + JSON.stringify(path.join(__dirname, "..", "psv.js")) + ');\n' +
    core + "\nmodule.exports = { PS1 };\n");
  const mod = require(tmp);
  fs.unlinkSync(tmp);
  return mod.PS1;
}

/** Run the reference converter on a file in its own directory; return the PSV. */
function reference(tmpDir, file, bytes) {
  const dir = fs.mkdtempSync(path.join(tmpDir, "ref-"));
  const input = path.join(dir, file);
  fs.writeFileSync(input, Buffer.from(bytes));
  try {
    execFileSync(CONVERTER, [input], { cwd: dir, encoding: "utf8", input: "n\n" });
  } catch (e) {
    return null;
  }
  const psv = fs.readdirSync(dir).find(f => /\.psv$/i.test(f));
  return psv ? new Uint8Array(fs.readFileSync(path.join(dir, psv))) : null;
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "psvtest-"));

  /* ---------- 1. the inlined copy must match the shared module ---------- */
  console.log("\n=== inlined copy vs web-ps2/psv.js ===");
  const shared = fs.readFileSync(path.join(ROOT, "web-ps2", "psv.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "web-ps1", "index.html"), "utf8");
  const b = html.indexOf(BEGIN), e = html.indexOf(END);
  ok("PS1 page contains the inlined module", b >= 0 && e > b);
  if (b >= 0 && e > b) {
    const inlined = html.slice(html.indexOf("*/", b) + 3, e).replace(/\s+$/, "");
    ok("inlined copy is identical to the shared module",
       inlined === shared.replace(/\s+$/, ""),
       "re-copy web-ps2/psv.js into web-ps1/index.html");
  }
  ok("PS2 page loads the module as a script",
     fs.readFileSync(path.join(ROOT, "web-ps2", "index.html"), "utf8").includes('src="psv.js"'));

  const CU_BEGIN = "/* ===== BEGIN inlined copy of web-ps2/cryptoutil.js";
  const CU_END = "/* ===== END inlined copy of web-ps2/cryptoutil.js";
  const cuShared = fs.readFileSync(path.join(ROOT, "web-ps2", "cryptoutil.js"), "utf8");
  const cb = html.indexOf(CU_BEGIN), ce = html.indexOf(CU_END);
  ok("PS1 page contains the inlined crypto module", cb >= 0 && ce > cb);
  if (cb >= 0 && ce > cb) {
    const inlined = html.slice(html.indexOf("*/", cb) + 3, ce).replace(/\s+$/, "");
    ok("inlined crypto copy is identical to the shared module",
       inlined === cuShared.replace(/\s+$/, ""),
       "re-copy web-ps2/cryptoutil.js into web-ps1/index.html");
  }
  ok("PS2 page loads the crypto module too",
     fs.readFileSync(path.join(ROOT, "web-ps2", "index.html"), "utf8").includes('src="cryptoutil.js"'));
  ok("the crypto module is loaded before psv.js on the PS2 page",
     fs.readFileSync(path.join(ROOT, "web-ps2", "index.html"), "utf8").indexOf('src="cryptoutil.js"') <
     fs.readFileSync(path.join(ROOT, "web-ps2", "index.html"), "utf8").indexOf('src="psv.js"'));

  /* ---------- 1c. every documented CLI option must be parsed ---------- */
  console.log("\n=== CLI usage text vs the parser ===");
  for (const [tool, src] of [[PS1CLI, "src/ps1main.c"], [PS2CLI, "src/main.c"]]) {
    if (!fs.existsSync(tool)) continue;
    const name = path.basename(tool);

    /* what the tool advertises */
    let usage = "";
    try { usage = execFileSync(tool, [], { encoding: "utf8" }); }
    catch (err) { usage = String(err.stdout || ""); }
    const advertised = [...usage.matchAll(/\t (--[\w-]+)(?:, (-\w+))?/g)]
      .flatMap(m => [m[1], m[2]].filter(Boolean));

    /* what it actually compares argv[2] against */
    const code = fs.readFileSync(path.join(ROOT, src), "utf8");
    const parsed = new Set([...code.matchAll(/strcmp\(argv\[2\], "([^"]+)"\)/g)].map(m => m[1]));

    const missing = advertised.filter(o => !parsed.has(o));
    ok(name + ": every documented option is accepted (" + advertised.length + " checked)",
       missing.length === 0, "not parsed: " + missing.join(", "));

    /* and nothing is parsed that the usage text never mentions */
    const undocumented = [...parsed].filter(o => !advertised.includes(o));
    ok(name + ": no undocumented options in the parser",
       undocumented.length === 0, "not documented: " + undocumented.join(", "));
  }

  /* ---------- 2. SHA-1 ---------- */
  console.log("\n=== SHA-1 ===");
  const vectors = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000)];
  let allMatch = vectors.every(v => {
    const mine = Buffer.from(PSV.sha1([Buffer.from(v, "latin1")])).toString("hex");
    return mine === crypto.createHash("sha1").update(Buffer.from(v, "latin1")).digest("hex");
  });
  ok("known lengths match node's crypto", allMatch);

  let randomMatch = true;
  for (let i = 0; i < 100 && randomMatch; i++) {
    const buf = crypto.randomBytes(Math.floor(Math.random() * 400));
    randomMatch = Buffer.from(PSV.sha1([buf])).toString("hex") ===
                  crypto.createHash("sha1").update(buf).digest("hex");
  }
  ok("100 random buffers match node's crypto", randomMatch);

  const a = Buffer.from("hello "), z = Buffer.from("world");
  ok("chunked input equals the concatenation",
     Buffer.from(PSV.sha1([a, z])).toString("hex") ===
     crypto.createHash("sha1").update(Buffer.concat([a, z])).digest("hex"));

  console.log("\n=== cryptoutil primitives vs node ===");
  let sha256ok = true;
  for (const v of ["", "abc", "a".repeat(55), "a".repeat(64), "a".repeat(1000)]) {
    const buf = Buffer.from(v, "latin1");
    if (Buffer.from(CU.sha256([buf])).toString("hex") !==
        crypto.createHash("sha256").update(buf).digest("hex")) sha256ok = false;
  }
  for (let i = 0; i < 100 && sha256ok; i++) {
    const buf = crypto.randomBytes(Math.floor(Math.random() * 500));
    if (Buffer.from(CU.sha256([buf])).toString("hex") !==
        crypto.createHash("sha256").update(buf).digest("hex")) sha256ok = false;
  }
  ok("SHA-256 matches node (fixed vectors + 100 random)", sha256ok);

  const key = crypto.randomBytes(16), iv = crypto.randomBytes(16), pt = crypto.randomBytes(64);
  const noPad = (c) => { c.setAutoPadding(false); return c; };
  ok("AES-128-ECB encrypt matches node",
     Buffer.from(CU.aes.ecbEncrypt(pt.subarray(0, 16), key)).equals(
       Buffer.concat([noPad(crypto.createCipheriv("aes-128-ecb", key, null)).update(pt.subarray(0, 16))])));
  ok("AES-128-ECB decrypt matches node",
     Buffer.from(CU.aes.ecbDecrypt(pt.subarray(0, 16), key)).equals(
       Buffer.concat([noPad(crypto.createDecipheriv("aes-128-ecb", key, null)).update(pt.subarray(0, 16))])));
  ok("AES-128-CBC encrypt matches node",
     Buffer.from(CU.aes.cbcEncrypt(Uint8Array.from(pt), key, iv)).equals(
       Buffer.concat([noPad(crypto.createCipheriv("aes-128-cbc", key, iv)).update(pt)])));
  ok("AES-128-CBC decrypt matches node",
     Buffer.from(CU.aes.cbcDecrypt(Uint8Array.from(pt), key, iv)).equals(
       Buffer.concat([noPad(crypto.createDecipheriv("aes-128-cbc", key, iv)).update(pt)])));

  /* HMAC-SHA1, across every key length that takes a different RFC 2104 path */
  let hmacOk = true;
  for (const klen of [0, 1, 16, 20, 63, 64, 65, 100, 200]) {
    for (let i = 0; i < 10 && hmacOk; i++) {
      const k = crypto.randomBytes(klen);
      const m = crypto.randomBytes(Math.floor(Math.random() * 2000));
      hmacOk = Buffer.from(CU.hmacSha1(k, [m]))
        .equals(crypto.createHmac("sha1", k).update(m).digest());
    }
  }
  ok("HMAC-SHA1 matches node across 9 key lengths", hmacOk);

  const hk = crypto.randomBytes(64), h1 = Buffer.from("hello "), h2 = Buffer.from("world");
  ok("HMAC-SHA1 chunked message equals the concatenation",
     Buffer.from(CU.hmacSha1(hk, [h1, h2]))
       .equals(crypto.createHmac("sha1", hk).update(Buffer.concat([h1, h2])).digest()));

  /* the PSV scheme is plain HMAC-SHA1: the salt is exactly one SHA-1 block,
   * and the hand-written pads were 0x36 then ^0x6A, i.e. 0x36 and 0x5C */
  ok("0x36 ^ 0x6A is the HMAC opad 0x5C", (0x36 ^ 0x6a) === 0x5c);

  /* ---------- 3. PS1 ---------- */
  console.log("\n=== PS1 .PSV ===");
  const PS1 = loadPs1Core();
  const ps1Card = path.join(ROOT, "samples", "ps1test.vgs");

  if (fs.existsSync(ps1Card)) {
    PS1.open(new Uint8Array(fs.readFileSync(ps1Card)));
    const slots = PS1.slots.map((s, i) => i).filter(i => PS1.slots[i].type === 1);

    for (const slot of slots) {
      const s = PS1.slots[slot];
      const psv = PS1.exportSave(slot, PS1.SAVE.PSV);
      const raw = PS1.exportSave(slot, PS1.SAVE.RAW);
      const dv = new DataView(psv.buffer, psv.byteOffset, psv.byteLength);

      const label = "slot " + slot + " (" + s.name + ")";
      ok(label + ": magic and type", psv[0] === 0 && psv[1] === 0x56 && psv[2] === 0x53 &&
         psv[3] === 0x50 && dv.getUint32(0x3c, true) === 1);
      ok(label + ": headerSize 0x14", dv.getUint32(0x38, true) === 0x14);
      ok(label + ": length is 0x84 + data", psv.length === 0x84 + raw.length);
      /* The save size is stored twice: 0x40 is what the XMB shows, 0x5C is the
       * length the PS3 copies onto the memory card. Both must be the real
       * size or multi-block saves are truncated on console.
       * https://github.com/ShendoXT/memcardrex/pull/54 */
      ok(label + ": XMB size field holds the whole save",
         dv.getUint32(0x40, true) === raw.length,
         "0x40=" + dv.getUint32(0x40, true) + " payload=" + raw.length);
      ok(label + ": copy-length field holds the whole save too",
         dv.getUint32(0x5c, true) === raw.length,
         "0x5C=" + dv.getUint32(0x5c, true) + " payload=" + raw.length);
      ok(label + ": payload is the raw save",
         Buffer.from(psv.subarray(0x84)).equals(Buffer.from(raw)));

      const sig = psv.subarray(0x1c, 0x30);
      ok(label + ": signature is not blank", sig.some(v => v !== 0));

      /* re-signing an unmodified file must reproduce the same signature */
      const again = PSV.sign(psv.slice());
      ok(label + ": signing is deterministic",
         Buffer.from(again.subarray(0x1c, 0x30)).equals(Buffer.from(sig)));

      /* changing a byte anywhere must change the signature */
      const tampered = psv.slice();
      tampered[0x90] ^= 0xff;
      PSV.sign(tampered);
      ok(label + ": signature covers the payload",
         !Buffer.from(tampered.subarray(0x1c, 0x30)).equals(Buffer.from(sig)));

      if (HAVE_CONVERTER) {
        const mcs = PS1.exportSave(slot, PS1.SAVE.MCS);
        const ref = reference(tmp, "save.mcs", mcs);
        if (ref) {
          ok(label + ": byte-identical to psv-save-converter",
             Buffer.from(psv).equals(Buffer.from(ref)),
             "mine " + psv.length + " vs ref " + ref.length);
        } else {
          ok(label + ": reference conversion", false, "converter produced nothing");
        }
      }
    }
  } else {
    ok("PS1 sample card present", false, ps1Card);
  }

  /* ---------- 3b. the CLI's own PSV header ---------- */
  console.log("\n=== ps1vmc-tool --psv-export header ===");
  if (fs.existsSync(PS1CLI) && fs.existsSync(ps1Card)) {
    const work = fs.mkdtempSync(path.join(tmp, "cli-"));
    fs.copyFileSync(ps1Card, path.join(work, "card.vgs"));

    PS1.open(new Uint8Array(fs.readFileSync(ps1Card)));
    const slots = PS1.slots.map((s, i) => i).filter(i => PS1.slots[i].type === 1);

    for (const slot of slots) {
      const raw = PS1.exportSave(slot, PS1.SAVE.RAW);
      const blocks = raw.length / 8192;
      try {
        execFileSync(PS1CLI, [path.join(work, "card.vgs"), "-psv", String(slot)],
                     { cwd: work, encoding: "utf8" });
      } catch (err) {
        ok("slot " + slot + ": CLI export", false, "CLI failed");
        continue;
      }
      const file = fs.readdirSync(work).filter(f => /\.psv$/i.test(f)).sort().pop();
      const psv = new Uint8Array(fs.readFileSync(path.join(work, file)));
      const dv = new DataView(psv.buffer, psv.byteOffset, psv.byteLength);

      const label = "slot " + slot + " (" + blocks + " block" + (blocks > 1 ? "s" : "") + ")";
      /* src/ps1card.c used to hardcode 0x5C to 8192, which truncated any save
       * longer than one block when a PS3 copied it to a memory card. */
      ok(label + ": CLI writes the save size at 0x40",
         dv.getUint32(0x40, true) === raw.length,
         "0x40=" + dv.getUint32(0x40, true) + " payload=" + raw.length);
      ok(label + ": CLI writes the save size at 0x5C as well",
         dv.getUint32(0x5c, true) === raw.length,
         "0x5C=" + dv.getUint32(0x5c, true) + " payload=" + raw.length);

      /* both sign now, so the files must agree on every byte */
      const mine = PS1.exportSave(slot, PS1.SAVE.PSV);
      ok(label + ": CLI output is byte-identical to ours",
         mine.length === psv.length && Buffer.from(mine).equals(Buffer.from(psv)),
         "mine " + mine.length + " vs cli " + psv.length);
      ok(label + ": CLI signs the PSV too",
         psv.subarray(0x1c, 0x30).some(v => v !== 0));

      fs.readdirSync(work).filter(f => /\.psv$/i.test(f))
        .forEach(f => fs.unlinkSync(path.join(work, f)));
    }
  } else {
    console.log("  (ps1vmc-tool not built — skipping)");
  }

  /* ---------- 3c. VMP and MCX memory card images ---------- */
  console.log("\n=== VMP / MCX card images ===");
  if (fs.existsSync(ps1Card)) {
    PS1.open(new Uint8Array(fs.readFileSync(ps1Card)));
    const rawCard = PS1.exportCard(PS1.CARD.RAW);

    /* ---- VMP ---- */
    const vmp = PS1.exportCard(PS1.CARD.VMP);
    ok("VMP is 0x20080 bytes", vmp.length === 0x20080, String(vmp.length));
    ok("VMP magic is \\0PMV",
       vmp[0] === 0 && vmp[1] === 0x50 && vmp[2] === 0x4d && vmp[3] === 0x56);
    ok("VMP header length byte is 0x80", vmp[4] === 0x80);
    ok("VMP carries the raw card after the 0x80 header",
       Buffer.from(vmp.subarray(0x80)).equals(Buffer.from(rawCard)));

    const vsig = vmp.subarray(PSV.VMP_HASH_OFFSET, PSV.VMP_HASH_OFFSET + 0x14);
    ok("VMP signature is not blank", vsig.some(v => v !== 0));

    /* The salt is exactly one SHA-1 block, so the construction is plain
     * HMAC-SHA1 and node can verify it independently. The salt derivation
     * itself is shared with PSV, which is checked against the reference
     * converter above. */
    const seed = vmp.subarray(PSV.VMP_SEED_OFFSET, PSV.VMP_SEED_OFFSET + 0x14);
    const salt = new Uint8Array(0x40);
    const KEY_PS1 = Buffer.from("ab5abc9fc1f49de6a051dbaefa518859", "hex");
    const IV = Buffer.from("b30ffeedb7dc5eb7133da60d1b6b2cdc", "hex");
    salt.set(CU.aes.ecbDecrypt(seed.subarray(0, 0x10), KEY_PS1), 0);
    salt.set(CU.aes.ecbEncrypt(seed.subarray(0, 0x10), KEY_PS1), 0x10);
    for (let i = 0; i < 0x10; i++) salt[i] ^= IV[i];
    const tail = new Uint8Array(0x14).fill(0xff);
    tail.set(seed.subarray(0x10, 0x14), 0);
    for (let i = 0; i < 0x10; i++) salt[0x10 + i] ^= tail[i];
    salt.fill(0, 0x14);

    const zeroed = Buffer.from(vmp);
    zeroed.fill(0, PSV.VMP_HASH_OFFSET, PSV.VMP_HASH_OFFSET + 0x14);
    const nodeHmac = crypto.createHmac("sha1", Buffer.from(salt)).update(zeroed).digest();
    ok("VMP signature equals node's HMAC-SHA1 over the same input",
       nodeHmac.equals(Buffer.from(vsig)),
       "ours " + Buffer.from(vsig).toString("hex") + " vs node " + nodeHmac.toString("hex"));

    const resigned = PSV.signVmp(vmp.slice());
    ok("VMP signing is deterministic",
       Buffer.from(resigned.subarray(PSV.VMP_HASH_OFFSET, PSV.VMP_HASH_OFFSET + 0x14))
         .equals(Buffer.from(vsig)));

    const tamperedVmp = vmp.slice();
    tamperedVmp[0x1000] ^= 0xff;
    PSV.signVmp(tamperedVmp);
    ok("VMP signature covers the card data",
       !Buffer.from(tamperedVmp.subarray(PSV.VMP_HASH_OFFSET, PSV.VMP_HASH_OFFSET + 0x14))
          .equals(Buffer.from(vsig)));

    /* ---- MCX ---- */
    const mcx = PS1.exportCard(PS1.CARD.MCX);
    ok("MCX is 0x200A0 bytes", mcx.length === 0x200a0, String(mcx.length));

    const MCX_KEY = Buffer.from("81d9cce971a9499b04addc48307f0792", "hex");
    const MCX_IV = Buffer.from("13c2e7694bec696d52cf00092ac1f272", "hex");
    const plain = CU.aes.cbcDecrypt(mcx.slice(), MCX_KEY, MCX_IV);

    ok("MCX decrypts to the raw card at 0x80",
       Buffer.from(plain.subarray(0x80, 0x80 + rawCard.length)).equals(Buffer.from(rawCard)));

    const digest = plain.subarray(0x20080, 0x200a0);
    ok("MCX SHA-256 slot is filled in", digest.some(v => v !== 0) && !digest.every(v => v === 0xff));
    const expect = crypto.createHash("sha256").update(Buffer.from(plain.subarray(0, 0x20080))).digest();
    ok("MCX digest equals node's SHA-256 over the first 0x20080 bytes",
       expect.equals(Buffer.from(digest)),
       "ours " + Buffer.from(digest).toString("hex").slice(0, 16) +
       "… vs node " + expect.toString("hex").slice(0, 16) + "…");

    /* both images must still be readable by our own opener */
    ok("our signed VMP reopens", PS1.open(vmp).ok === true);
    ok("our signed MCX reopens", PS1.open(mcx).ok === true);
    PS1.open(new Uint8Array(fs.readFileSync(ps1Card)));

    /* ...and by the CLI, which ignores the signature but must still parse them */
    if (fs.existsSync(PS1CLI)) {
      for (const [name, bytes] of [["vmp", vmp], ["mcx", mcx]]) {
        const f = path.join(tmp, "signed." + name);
        fs.writeFileSync(f, Buffer.from(bytes));
        let listed = "";
        try { listed = execFileSync(PS1CLI, [f, "-ls"], { encoding: "utf8" }); }
        catch (err) { listed = ""; }
        ok("ps1vmc-tool reads our signed ." + name,
           /BASLUS-01360FF4/.test(listed), listed.split("\n")[1] || "no output");
      }
    }
  }

  /* ---------- 3d. the CLI's VMP and MCX writers ---------- */
  console.log("\n=== ps1vmc-tool VMP / MCX images ===");
  if (fs.existsSync(PS1CLI) && fs.existsSync(ps1Card)) {
    const work = fs.mkdtempSync(path.join(tmp, "cliimg-"));
    const cardCopy = path.join(work, "card.vgs");
    fs.copyFileSync(ps1Card, cardCopy);

    /* VMP: the CLI writes it with --vmp-image */
    const vmpOut = path.join(work, "out.vmp");
    let vmpOk = true;
    try { execFileSync(PS1CLI, [cardCopy, "-vmp", vmpOut], { encoding: "utf8" }); }
    catch (err) { vmpOk = false; }
    ok("CLI wrote a .vmp", vmpOk && fs.existsSync(vmpOut));

    if (vmpOk && fs.existsSync(vmpOut)) {
      const cliVmp = new Uint8Array(fs.readFileSync(vmpOut));
      PS1.open(new Uint8Array(fs.readFileSync(ps1Card)));
      const ourVmp = PS1.exportCard(PS1.CARD.VMP);
      ok("CLI .vmp signature is filled in",
         cliVmp.subarray(0x20, 0x34).some(v => v !== 0));
      ok("CLI .vmp is byte-identical to ours",
         Buffer.from(cliVmp).equals(Buffer.from(ourVmp)),
         "cli " + cliVmp.length + " vs ours " + ourVmp.length);
    }

    /* MCX via the --mcx-image flag */
    const mcxOut = path.join(work, "out.mcx");
    let mcxImgOk = true;
    try { execFileSync(PS1CLI, [cardCopy, "-mcx", mcxOut], { encoding: "utf8" }); }
    catch (err) { mcxImgOk = false; }
    ok("CLI --mcx-image wrote a .mcx", mcxImgOk && fs.existsSync(mcxOut));

    if (mcxImgOk && fs.existsSync(mcxOut)) {
      const cliMcxImg = new Uint8Array(fs.readFileSync(mcxOut));
      PS1.open(new Uint8Array(fs.readFileSync(ps1Card)));
      const ourMcxImg = PS1.exportCard(PS1.CARD.MCX);
      ok("CLI --mcx-image output is byte-identical to ours",
         Buffer.from(cliMcxImg).equals(Buffer.from(ourMcxImg)),
         "cli " + cliMcxImg.length + " vs ours " + ourMcxImg.length);

      /* exporting must not disturb the card it read from */
      ok("CLI --mcx-image leaves the source card alone",
         Buffer.from(fs.readFileSync(cardCopy)).equals(Buffer.from(fs.readFileSync(ps1Card))));

      /* and the CLI must be able to read the image it just wrote */
      let listed = "";
      try { listed = execFileSync(PS1CLI, [mcxOut, "-ls"], { encoding: "utf8" }); }
      catch (err) { listed = ""; }
      ok("CLI reads back its own --mcx-image output", /BASLUS-01360FF4/.test(listed));
    }

    /* MCX also gets written when an .mcx card is edited and saved back */
    const mcxSample = path.join(ROOT, "samples", "ps1mcx.bin");
    if (fs.existsSync(mcxSample)) {
      const mcxCopy = path.join(work, "card.mcx");
      fs.copyFileSync(mcxSample, mcxCopy);
      let mcxOk = true;
      try { execFileSync(PS1CLI, [mcxCopy, "-rm", "0"], { encoding: "utf8" }); }
      catch (err) { mcxOk = false; }
      ok("CLI rewrote the .mcx card after an edit", mcxOk);

      if (mcxOk) {
        const cliMcx = new Uint8Array(fs.readFileSync(mcxCopy));
        PS1.open(new Uint8Array(fs.readFileSync(mcxSample)));
        PS1.formatSave(0);
        const ourMcx = PS1.exportCard(PS1.CARD.MCX);
        ok("CLI .mcx is byte-identical to ours",
           Buffer.from(cliMcx).equals(Buffer.from(ourMcx)),
           "cli " + cliMcx.length + " vs ours " + ourMcx.length);

        const MCX_KEY = Buffer.from("81d9cce971a9499b04addc48307f0792", "hex");
        const MCX_IV = Buffer.from("13c2e7694bec696d52cf00092ac1f272", "hex");
        const plain = CU.aes.cbcDecrypt(cliMcx.slice(), MCX_KEY, MCX_IV);
        const stored = Buffer.from(plain.subarray(0x20080, 0x200a0));
        const want = crypto.createHash("sha256")
          .update(Buffer.from(plain.subarray(0, 0x20080))).digest();
        ok("CLI .mcx digest is a real SHA-256, not the old 0xFF filler",
           stored.equals(want) && !stored.every(v => v === 0xff));
      }
      PS1.open(new Uint8Array(fs.readFileSync(ps1Card)));
    }
  } else {
    console.log("  (ps1vmc-tool not built — skipping)");
  }

  /* ---------- 4. PS2 ---------- */
  console.log("\n=== PS2 .PSV ===");
  return PS2VMC.load().then(vmc => {
    const cards = ["samples/ps2card.vmc", "samples/card16mb.bin"]
      .map(c => path.join(ROOT, c)).filter(fs.existsSync);

    let checked = 0, identical = 0, structural = 0;
    const mismatches = [];

    for (const card of cards) {
      vmc.openCard(new Uint8Array(fs.readFileSync(card)));
      const dirs = vmc.list("/").filter(d => d.isDir).slice(0, 6);

      for (const d of dirs) {
        const p = "/" + d.name;
        const dirStat = vmc.stat(p);
        let icons = {};
        try {
          const sys = PS2Icon.parseIconSys(vmc.readFile(p + "/icon.sys"));
          icons = { iconName: sys.iconName, copyIconName: sys.copyIconName,
                    deleteIconName: sys.deleteIconName };
        } catch (err) { /* no icon.sys */ }

        const files = vmc.list(p).filter(f => !f.isDir).map(entry => {
          const st = vmc.stat(p + "/" + entry.name);
          return { name: entry.name, mode: st.mode, ctime: st.ctime, mtime: st.mtime,
                   data: vmc.readFile(p + "/" + entry.name) };
        });

        const psv = PSV.buildPs2({
          dir: { name: dirStat.name, mode: dirStat.mode, ctime: dirStat.ctime,
                 mtime: dirStat.mtime, entryCount: dirStat.size },
          files, icons
        });
        checked++;

        const dv = new DataView(psv.buffer, psv.byteOffset, psv.byteLength);
        const dataStart = 0x40 + 0x28 + 0x38 + 0x3c * files.length;
        const total = files.reduce((n, f) => n + f.data.length, 0);

        let good = dv.getUint32(0x3c, true) === 2 &&
                   dv.getUint32(0x38, true) === 0x2c &&
                   dv.getUint32(0x40, true) === total &&
                   dv.getUint32(0x64, true) === files.length &&
                   psv.length === dataStart + total;

        /* every file must be reachable at the offset the header claims */
        files.forEach((f, i) => {
          const at = 0x68 + 0x38 + 0x3c * i;
          const pos = dv.getUint32(at + 56, true);
          const size = dv.getUint32(at + 16, true);
          if (size !== f.data.length ||
              !Buffer.from(psv.subarray(pos, pos + size)).equals(Buffer.from(f.data)))
            good = false;
        });
        if (good) structural++;
        else mismatches.push(d.name + " (structure)");

        if (HAVE_CONVERTER) {
          const psu = vmc.psuExport(p);
          const ref = reference(tmp, "save.psu", psu);
          if (ref && Buffer.from(psv).equals(Buffer.from(ref))) identical++;
          else if (ref) mismatches.push(d.name + " (differs from reference)");
        }
      }
    }

    ok("PS2 PSVs are structurally sound (" + structural + "/" + checked + ")",
       structural === checked, mismatches.slice(0, 4).join(", "));

    if (HAVE_CONVERTER) {
      /* one sample save has a 976-byte icon.sys; the reference converter reads
       * only sizeof(ps2_IconSys_t)=964 there, desynchronising its own PSU
       * stream and writing a wrong displaySize. Allow that one to differ. */
      ok("PS2 PSVs match psv-save-converter (" + identical + "/" + checked + ")",
         identical >= checked - 1,
         mismatches.slice(0, 4).join(", "));
    } else {
      console.log("  (reference converter not found — skipping byte comparison)");
    }

    /* signature must cover the file data, not just the header */
    if (checked) {
      vmc.openCard(new Uint8Array(fs.readFileSync(cards[0])));
      const d = vmc.list("/").filter(x => x.isDir)[0];
      const p = "/" + d.name;
      const st = vmc.stat(p);
      const files = vmc.list(p).filter(f => !f.isDir).map(entry => {
        const fst = vmc.stat(p + "/" + entry.name);
        return { name: entry.name, mode: fst.mode, ctime: fst.ctime, mtime: fst.mtime,
                 data: vmc.readFile(p + "/" + entry.name) };
      });
      const built = PSV.buildPs2({
        dir: { name: st.name, mode: st.mode, ctime: st.ctime, mtime: st.mtime, entryCount: st.size },
        files, icons: {}
      });
      const sig = Buffer.from(built.subarray(0x1c, 0x30));
      ok("PS2 signature is not blank", sig.some(v => v !== 0));
      ok("PS2 signing is deterministic",
         Buffer.from(PSV.sign(built.slice()).subarray(0x1c, 0x30)).equals(sig));
      const t = built.slice();
      t[t.length - 1] ^= 0xff;
      PSV.sign(t);
      ok("PS2 signature covers the file data",
         !Buffer.from(t.subarray(0x1c, 0x30)).equals(sig));
    }

    /* ---- the CLI's own --psv-export ---- */
    if (fs.existsSync(PS2CLI)) {
      const cardFile = cards[0];
      const work = fs.mkdtempSync(path.join(tmp, "ps2psv-"));
      const cardCopy = path.join(work, "card.vmc");
      fs.copyFileSync(cardFile, cardCopy);
      vmc.openCard(new Uint8Array(fs.readFileSync(cardFile)));

      let checkedCli = 0, matching = 0, untouched = true;
      for (const d of vmc.list("/").filter(x => x.isDir).slice(0, 4)) {
        const p2 = "/" + d.name;
        const out = path.join(work, "out.psv");
        try { execFileSync(PS2CLI, [cardCopy, "-pv", p2, out], { encoding: "utf8" }); }
        catch (err) { continue; }
        if (!fs.existsSync(out)) continue;

        const st = vmc.stat(p2);
        let icons = {};
        try {
          const sys = PS2Icon.parseIconSys(vmc.readFile(p2 + "/icon.sys"));
          icons = { iconName: sys.iconName, copyIconName: sys.copyIconName,
                    deleteIconName: sys.deleteIconName };
        } catch (err) { /* no icon.sys */ }
        const fl = vmc.list(p2).filter(f => !f.isDir).map(entry => {
          const fst = vmc.stat(p2 + "/" + entry.name);
          return { name: entry.name, mode: fst.mode, ctime: fst.ctime, mtime: fst.mtime,
                   data: vmc.readFile(p2 + "/" + entry.name) };
        });
        const ours = PSV.buildPs2({
          dir: { name: st.name, mode: st.mode, ctime: st.ctime, mtime: st.mtime, entryCount: st.size },
          files: fl, icons
        });

        checkedCli++;
        if (Buffer.from(fs.readFileSync(out)).equals(Buffer.from(ours))) matching++;
        fs.unlinkSync(out);
      }

      /* exporting reads the card; it must never write it back */
      if (!Buffer.from(fs.readFileSync(cardCopy)).equals(Buffer.from(fs.readFileSync(cardFile))))
        untouched = false;

      ok("CLI --psv-export matches ours (" + matching + "/" + checkedCli + ")",
         checkedCli > 0 && matching === checkedCli);
      ok("CLI --psv-export leaves the source card untouched", untouched);

      /* a missing output path must be refused, not crash on a NULL argument */
      let refused = false, printedUsage = false;
      try {
        execFileSync(PS2CLI, [cardCopy, "-pv", "/" + vmc.list("/").filter(x => x.isDir)[0].name],
                     { encoding: "utf8", stdio: "pipe" });
      } catch (err) {
        refused = err.status === 1;
        printedUsage = /Available commands/.test(String(err.stdout || ""));
      }
      ok("CLI --psv-export refuses a missing output path", refused && printedUsage);

      /* --psu-export takes two arguments as well */
      let psuRefused = false, psuUsage = false;
      try {
        execFileSync(PS2CLI, [cardCopy, "-px", "/" + vmc.list("/").filter(x => x.isDir)[0].name],
                     { encoding: "utf8", stdio: "pipe" });
      } catch (err) {
        psuRefused = err.status === 1;
        psuUsage = /Available commands/.test(String(err.stdout || "")) &&
                   !/\(null\)/.test(String(err.stdout || ""));
      }
      ok("CLI --psu-export refuses a missing output path", psuRefused && psuUsage);

      /* and still works when given one */
      const psuOut = path.join(work, "ok.psu");
      let psuOk = true;
      try { execFileSync(PS2CLI, [cardCopy, "-px",
                                  "/" + vmc.list("/").filter(x => x.isDir)[0].name, psuOut],
                         { encoding: "utf8" }); }
      catch (err) { psuOk = false; }
      ok("CLI --psu-export still works with both arguments",
         psuOk && fs.existsSync(psuOut) && fs.statSync(psuOut).size > 0);
    }

    /* a PSV we produce must import back through the CLI */
    if (fs.existsSync(PS2CLI)) {
      vmc.openCard(new Uint8Array(fs.readFileSync(cards[0])));
      const d = vmc.list("/").filter(x => x.isDir)[0];
      const p = "/" + d.name;
      const st = vmc.stat(p);
      const files = vmc.list(p).filter(f => !f.isDir).map(entry => {
        const fst = vmc.stat(p + "/" + entry.name);
        return { name: entry.name, mode: fst.mode, ctime: fst.ctime, mtime: fst.mtime,
                 data: vmc.readFile(p + "/" + entry.name) };
      });
      const psv = PSV.buildPs2({
        dir: { name: st.name, mode: st.mode, ctime: st.ctime, mtime: st.mtime, entryCount: st.size },
        files, icons: {}
      });

      /* import it into a formatted copy of the card */
      const target = path.join(tmp, "target.vmc");
      fs.copyFileSync(cards[0], target);
      execFileSync(PS2CLI, [target, "--mc-format"], { encoding: "utf8" });
      const psvPath = path.join(tmp, "out.psv");
      fs.writeFileSync(psvPath, Buffer.from(psv));
      let imported = true;
      try { execFileSync(PS2CLI, [target, "-pi", psvPath], { encoding: "utf8" }); }
      catch (err) { imported = false; }
      ok("our PS2 PSV imports back with ps2vmc-tool --psv-import", imported);

      if (imported) {
        vmc.openCard(new Uint8Array(fs.readFileSync(target)));
        const back = vmc.list("/").filter(x => x.isDir).map(x => x.name);
        ok("the imported save is on the card", back.includes(d.name), back.join(", "));
        const same = files.every(f => {
          try { return Buffer.from(vmc.readFile(p + "/" + f.name)).equals(Buffer.from(f.data)); }
          catch (err) { return false; }
        });
        ok("every file round-tripped intact", same);
      }
    }

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("\n" + pass + " passed, " + fail + " failed" +
                (HAVE_CONVERTER ? "" : "  (reference comparison skipped)"));
    process.exit(fail ? 1 : 0);
  });
}

main();
