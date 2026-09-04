/*
 * psv.js - PSV and VMP signing, and PSV header construction.
 *
 * Both formats carry a 20-byte signature produced the same way: a salt is
 * derived from a seed stored in the file, then used as the HMAC-SHA1 key over
 * the whole file with the signature field zeroed. Only the offsets differ:
 *
 *     .psv   seed 0x08, signature 0x1C, PS1 or PS2 derivation per byte 0x3C
 *     .vmp   seed 0x0C, signature 0x20, always the PS1 derivation
 *
 * Ported from psv-save-converter and apollo-ps4 by Bucanero, both based on
 * ps3-psvresigner / MCR2VMP by @dots_tb:
 *   https://github.com/bucanero/psv-save-converter
 *   https://github.com/bucanero/apollo-ps4/blob/main/source/psv_resign.c
 *
 * AES and SHA-1 come from cryptoutil.js.
 *
 * GPLv3, same as the rest of the repository.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PSV = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* cryptoutil.js: a browser global, or a sibling module under Node */
  const CU = (typeof CryptoUtil !== "undefined") ? CryptoUtil
           : (typeof require !== "undefined" ? require("./cryptoutil.js") : null);
  if (!CU) throw new Error("cryptoutil.js must be loaded before psv.js");

  const AES = CU.aes;
  const sha1 = CU.sha1;   /* re-exported for callers */

  /* ------------------------------------------------------------------ */
  /* signing                                                            */
  /* ------------------------------------------------------------------ */

  const SEED_OFFSET = 0x08;
  const HASH_OFFSET = 0x1c;
  const TYPE_OFFSET = 0x3c;

  const KEY_PS2 = new Uint8Array([0xEA,0x02,0xCE,0xEF,0x5B,0xB4,0xD2,0x99,0x8F,0x61,0x19,0x10,0xD7,0x7F,0x51,0xC6]);
  const KEY_PS1 = new Uint8Array([0xAB,0x5A,0xBC,0x9F,0xC1,0xF4,0x9D,0xE6,0xA0,0x51,0xDB,0xAE,0xFA,0x51,0x88,0x59]);
  const IV      = new Uint8Array([0xB3,0x0F,0xFE,0xED,0xB7,0xDC,0x5E,0xB7,0x13,0x3D,0xA6,0x0D,0x1B,0x6B,0x2C,0xDC]);

  /** Default seed, matching psv-save-converter's output. */
  const SALT_SEED = "www.bucanero.com.ar";

  /* VMP: the same signature, at its own offsets, over a 0x20080-byte image */
  const VMP_SEED_OFFSET = 0x0c;
  const VMP_HASH_OFFSET = 0x20;
  const VMP_SIZE = 0x20080;

  /** Derive the 0x40-byte HMAC key from a 0x14-byte seed. */
  function deriveSalt(seed, type) {
    const salt = new Uint8Array(0x40);

    if (type === 1) {
      /* PS1: one ECB decrypt and one ECB encrypt of the seed's first block */
      salt.set(AES.ecbDecrypt(seed.subarray(0, 0x10), KEY_PS1), 0);
      salt.set(AES.ecbEncrypt(seed.subarray(0, 0x10), KEY_PS1), 0x10);

      for (let i = 0; i < 0x10; i++) salt[i] ^= IV[i];

      /* the seed's remaining 4 bytes, padded with 0xFF, xored into block 2 */
      const tail = new Uint8Array(0x14).fill(0xff);
      tail.set(seed.subarray(0x10, 0x14), 0);
      for (let i = 0; i < 0x10; i++) salt[0x10 + i] ^= tail[i];
    } else if (type === 2) {
      /* PS2: CBC-decrypt the seed (zero padded) as one 0x40 buffer */
      salt.set(seed, 0);
      AES.cbcDecrypt(salt, KEY_PS2, IV);
    } else {
      throw new Error("unsupported PSV type " + type);
    }

    salt.fill(0, 0x14);
    return salt;
  }

  /**
   * Sign a file in place: HMAC-SHA1 over the whole buffer, keyed by the salt
   * derived from `seedOffset`, written back at `hashOffset`.
   *
   * The salt is 0x40 bytes, exactly one SHA-1 block, so this is plain
   * HMAC-SHA1 with no key normalisation — the original code spelled the pads
   * out by hand (0x36, then ^0x6A to reach 0x5C) rather than naming it.
   */
  function signBuffer(buf, seedOffset, hashOffset, type) {
    const salt = deriveSalt(buf.subarray(seedOffset, seedOffset + 0x14), type);

    buf.fill(0, hashOffset, hashOffset + 0x14);
    buf.set(CU.hmacSha1(salt, [buf]), hashOffset);

    return buf;
  }

  /**
   * Compute and write a PSV's signature at 0x1C, in place.
   * @param {Uint8Array} psv a complete PSV file
   * @returns {Uint8Array} the same buffer
   */
  function sign(psv) {
    if (psv.length < 0x40) throw new Error("too small to be a PSV");
    if (!(psv[0] === 0x00 && psv[1] === 0x56 && psv[2] === 0x53 && psv[3] === 0x50))
      throw new Error("not a PSV file");

    return signBuffer(psv, SEED_OFFSET, HASH_OFFSET, psv[TYPE_OFFSET]);
  }

  /**
   * Compute and write a VMP memory card image's signature at 0x20, in place.
   * A VMP is a 0x80-byte header followed by the raw 128 KB card.
   * @param {Uint8Array} vmp a complete VMP image
   * @returns {Uint8Array} the same buffer
   */
  function signVmp(vmp) {
    if (vmp.length !== VMP_SIZE)
      throw new Error("a VMP image is " + VMP_SIZE + " bytes, got " + vmp.length);
    if (!(vmp[0] === 0x00 && vmp[1] === 0x50 && vmp[2] === 0x4d && vmp[3] === 0x56))
      throw new Error("not a VMP file");

    /* always the PS1 derivation, whatever the card holds */
    return signBuffer(vmp, VMP_SEED_OFFSET, VMP_HASH_OFFSET, 1);
  }

  /* ------------------------------------------------------------------ */
  /* builders                                                           */
  /* ------------------------------------------------------------------ */

  function ascii(str, into, at, max) {
    for (let i = 0; i < Math.min(str.length, max); i++)
      into[at + i] = str.charCodeAt(i) & 0xff;
  }

  function psvHeader(headerSize, saveType) {
    const h = new Uint8Array(0x40);
    h[1] = 0x56; h[2] = 0x53; h[3] = 0x50;            /* "\0VSP" */
    ascii(SALT_SEED, h, SEED_OFFSET, 0x14);
    const dv = new DataView(h.buffer);
    dv.setUint32(0x38, headerSize, true);
    dv.setUint32(TYPE_OFFSET, saveType, true);
    return h;
  }

  /**
   * Build a signed PS1 .PSV.
   * @param {string} saveName the 20-char product code / filename
   * @param {Uint8Array} data raw save data (a whole number of 8 KB blocks)
   */
  function buildPs1(saveName, data) {
    const out = new Uint8Array(0x84 + data.length);
    out.set(psvHeader(0x14, 1), 0);

    const dv = new DataView(out.buffer);
    /* The save size appears twice, and both copies matter: 0x40 is what the
     * PS3 shows on the XMB, 0x5C is the length it actually copies onto the
     * virtual memory card. Writing only the first leaves saves longer than one
     * block truncated and unloadable on console.
     * https://github.com/ShendoXT/memcardrex/pull/54 */
    dv.setUint32(0x40, data.length, true);   /* size shown by the XMB */
    dv.setUint32(0x44, 0x84, true);          /* startOfSaveData */
    dv.setUint32(0x48, 0x200, true);         /* 0x200 */
    dv.setUint32(0x5c, data.length, true);   /* size copied to the memory card */
    dv.setUint32(0x60, 0x9003, true);        /* unknown1 */
    ascii(saveName, out, 0x64, 20);          /* prodCode */

    out.set(data, 0x84);
    return sign(out);
  }

  /* PS2 structure sizes, from ps2mc.h */
  const PS2_HDR = 0x28;        /* ps2_header_t    */
  const PS2_DIR = 0x38;        /* ps2_MainDirInfo_t */
  const PS2_FILE = 0x3c;       /* ps2_FileInfo_t  */

  function putDate(dv, at, d) {
    const t = d || {};
    dv.setUint8(at, 0);
    dv.setUint8(at + 1, t.sec || 0);
    dv.setUint8(at + 2, t.min || 0);
    dv.setUint8(at + 3, t.hour || 0);
    dv.setUint8(at + 4, t.day || 0);
    dv.setUint8(at + 5, t.month || 0);
    dv.setUint16(at + 6, t.year || 0, true);
  }

  /**
   * Build a signed PS2 .PSV from one save directory.
   *
   * @param {object} save
   *   dir   {name, mode, ctime, mtime, entryCount}  entryCount includes "." and ".."
   *   files [{name, mode, ctime, mtime, data}]      in card order
   *   icons {iconName, copyIconName, deleteIconName} from icon.sys, optional
   */
  function buildPs2(save) {
    const files = save.files;
    const n = files.length;
    const dataStart = 0x40 + PS2_HDR + PS2_DIR + PS2_FILE * n;

    let total = 0;
    for (const f of files) total += f.data.length;

    const out = new Uint8Array(dataStart + total);
    out.set(psvHeader(0x2c, 2), 0);
    const dv = new DataView(out.buffer);

    /* ---- ps2_header_t: sizes and positions of icon.sys and the icons ---- */
    const icons = save.icons || {};
    let pos = dataStart;
    const placed = files.map(f => {
      const at = pos;
      pos += f.data.length;
      return { name: f.name, at, size: f.data.length };
    });
    const find = name => placed.find(p => name && p.name === name);

    const sys = find("icon.sys");
    const i1 = find(icons.iconName), i2 = find(icons.copyIconName), i3 = find(icons.deleteIconName);

    dv.setUint32(0x40, total, true);                              /* displaySize */
    dv.setUint32(0x44, sys ? sys.at : 0, true);                   /* sysPos */
    dv.setUint32(0x48, sys ? sys.size : 0, true);                 /* sysSize */
    dv.setUint32(0x4c, i1 ? i1.at : 0, true);                     /* icon1Pos */
    dv.setUint32(0x50, i1 ? i1.size : 0, true);                   /* icon1Size */
    dv.setUint32(0x54, i2 ? i2.at : 0, true);                     /* icon2Pos */
    dv.setUint32(0x58, i2 ? i2.size : 0, true);                   /* icon2Size */
    dv.setUint32(0x5c, i3 ? i3.at : 0, true);                     /* icon3Pos */
    dv.setUint32(0x60, i3 ? i3.size : 0, true);                   /* icon3Size */
    dv.setUint32(0x64, n, true);                                  /* numberOfFiles */

    /* ---- ps2_MainDirInfo_t ---- */
    const dir = save.dir;
    let o = 0x68;
    putDate(dv, o, dir.ctime);
    putDate(dv, o + 8, dir.mtime);
    dv.setUint32(o + 16, dir.entryCount, true);   /* files + "." + ".." */
    dv.setUint32(o + 20, dir.mode, true);
    ascii(dir.name, out, o + 24, 32);

    /* ---- ps2_FileInfo_t per file ---- */
    o += PS2_DIR;
    files.forEach((f, i) => {
      const at = o + PS2_FILE * i;
      putDate(dv, at, f.ctime);
      putDate(dv, at + 8, f.mtime);
      dv.setUint32(at + 16, f.data.length, true);
      dv.setUint32(at + 20, f.mode, true);
      ascii(f.name, out, at + 24, 32);
      dv.setUint32(at + 56, placed[i].at, true);
    });

    /* ---- file data, packed with no padding ---- */
    files.forEach((f, i) => out.set(f.data, placed[i].at));

    return sign(out);
  }

  return {
    sign, signVmp, buildPs1, buildPs2, sha1,
    SALT_SEED, SEED_OFFSET, HASH_OFFSET, TYPE_OFFSET,
    VMP_SEED_OFFSET, VMP_HASH_OFFSET, VMP_SIZE
  };
});
