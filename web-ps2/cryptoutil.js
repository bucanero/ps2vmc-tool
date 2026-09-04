/*
 * cryptoutil.js - the small amount of crypto the memory card tools need.
 *
 * AES-128 (ECB and CBC, both directions), SHA-1, SHA-256 and HMAC-SHA1, in
 * one place so the PS1 page, the PS2 page and the PSV/VMP/MCX signing code all
 * share a single implementation.
 *
 * Deliberately not WebCrypto: that is unavailable on file:// pages, is async,
 * and forces PKCS#7 padding on CBC, none of which suits these formats.
 *
 * GPLv3, same as the rest of the repository.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CryptoUtil = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* AES-128                                                            */
  /* ------------------------------------------------------------------ */

  const SBOX = new Uint8Array(256), RSBOX = new Uint8Array(256);
  (function () {
    const hex =
      "637c777bf26b6fc53001672bfed7ab76ca82c97dfa5947f0add4a2af9ca472c0b7fd9326363ff7cc34a5e5f171d8311504c723c31896059a071280e2eb27b275" +
      "09832c1a1b6e5aa0523bd6b329e32f8453d100ed20fcb15b6acbbe394a4c58cfd0efaafb434d338545f9027f503c9fa851a3408f929d38f5bcb6da2110fff3d2" +
      "cd0c13ec5f974417c4a77e3d645d197360814fdc222a908846eeb814de5e0bdbe0323a0a4906245cc2d3ac629195e479e7c8376d8dd54ea96c56f4ea657aae08" +
      "ba78252e1ca6b4c6e8dd741f4bbd8b8a703eb5664803f60e613557b986c11d9ee1f8981169d98e949b1e87e9ce5528df8ca1890dbfe6426841992d0fb054bb16";
    for (let i = 0; i < 256; i++) SBOX[i] = parseInt(hex.substr(i * 2, 2), 16);
    for (let i = 0; i < 256; i++) RSBOX[SBOX[i]] = i;
  })();

  const xtime = x => ((x << 1) ^ ((x & 0x80) ? 0x1b : 0)) & 0xff;

  function expandKey(key) {
    const w = new Uint8Array(176);
    w.set(key);
    let rcon = 1;
    for (let i = 16; i < 176; i += 4) {
      let t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
      if (i % 16 === 0) {
        const a = t0;
        t0 = SBOX[t1] ^ rcon; t1 = SBOX[t2]; t2 = SBOX[t3]; t3 = SBOX[a];
        rcon = xtime(rcon);
      }
      w[i] = w[i - 16] ^ t0; w[i + 1] = w[i - 15] ^ t1;
      w[i + 2] = w[i - 14] ^ t2; w[i + 3] = w[i - 13] ^ t3;
    }
    return w;
  }

  const addRoundKey = (s, w, r) => { for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; };

  function shiftRows(s) {
    let t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
    t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
  }
  function invShiftRows(s) {
    let t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
    t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
  }
  function mixColumns(s) {
    for (let c = 0; c < 16; c += 4) {
      const a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3];
      const t = a0 ^ a1 ^ a2 ^ a3;
      s[c]     ^= t ^ xtime(a0 ^ a1);
      s[c + 1] ^= t ^ xtime(a1 ^ a2);
      s[c + 2] ^= t ^ xtime(a2 ^ a3);
      s[c + 3] ^= t ^ xtime(a3 ^ a0);
    }
  }
  function invMixColumns(s) {
    for (let c = 0; c < 16; c += 4) {
      const a0 = s[c], a1 = s[c + 1], a2 = s[c + 2], a3 = s[c + 3];
      const u = xtime(xtime(a0 ^ a2)), v = xtime(xtime(a1 ^ a3));
      s[c] = a0 ^ u; s[c + 1] = a1 ^ v; s[c + 2] = a2 ^ u; s[c + 3] = a3 ^ v;
    }
    mixColumns(s);
  }

  function encBlock(s, w) {
    addRoundKey(s, w, 0);
    for (let r = 1; r < 10; r++) {
      for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
      shiftRows(s); mixColumns(s); addRoundKey(s, w, r);
    }
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    shiftRows(s); addRoundKey(s, w, 10);
  }
  function decBlock(s, w) {
    addRoundKey(s, w, 10);
    for (let r = 9; r > 0; r--) {
      invShiftRows(s);
      for (let i = 0; i < 16; i++) s[i] = RSBOX[s[i]];
      addRoundKey(s, w, r); invMixColumns(s);
    }
    invShiftRows(s);
    for (let i = 0; i < 16; i++) s[i] = RSBOX[s[i]];
    addRoundKey(s, w, 0);
  }

  const aes = {
    /** One 16-byte block, returned as a new array. */
    ecbEncrypt(block, key) {
      const s = Uint8Array.from(block);
      encBlock(s, expandKey(key));
      return s;
    },
    ecbDecrypt(block, key) {
      const s = Uint8Array.from(block);
      decBlock(s, expandKey(key));
      return s;
    },
    /** In place, over whole blocks; no padding is added or expected. */
    cbcEncrypt(buf, key, iv) {
      const w = expandKey(key), prev = Uint8Array.from(iv), blk = new Uint8Array(16);
      for (let o = 0; o + 16 <= buf.length; o += 16) {
        for (let i = 0; i < 16; i++) blk[i] = buf[o + i] ^ prev[i];
        encBlock(blk, w);
        buf.set(blk, o);
        prev.set(blk);
      }
      return buf;
    },
    cbcDecrypt(buf, key, iv) {
      const w = expandKey(key), prev = Uint8Array.from(iv);
      const blk = new Uint8Array(16), cipher = new Uint8Array(16);
      for (let o = 0; o + 16 <= buf.length; o += 16) {
        cipher.set(buf.subarray(o, o + 16));
        blk.set(cipher);
        decBlock(blk, w);
        for (let i = 0; i < 16; i++) buf[o + i] = blk[i] ^ prev[i];
        prev.set(cipher);
      }
      return buf;
    }
  };

  /* ------------------------------------------------------------------ */
  /* hashes                                                             */
  /* ------------------------------------------------------------------ */

  /* message || 0x80 || zero pad || 64-bit big-endian bit length */
  function padMessage(chunks) {
    let total = 0;
    for (const c of chunks) total += c.length;

    const padded = new Uint8Array((((total + 8) >> 6) + 1) << 6);
    let o = 0;
    for (const c of chunks) { padded.set(c, o); o += c.length; }
    padded[total] = 0x80;

    const dv = new DataView(padded.buffer);
    const bits = total * 8;
    dv.setUint32(padded.length - 8, Math.floor(bits / 0x100000000), false);
    dv.setUint32(padded.length - 4, bits >>> 0, false);
    return { padded, dv };
  }

  const rol = (n, s) => (n << s) | (n >>> (32 - s));
  const ror = (n, s) => (n >>> s) | (n << (32 - s));

  /**
   * @param {Array<Uint8Array>} chunks hashed as if concatenated
   * @returns {Uint8Array} 20 bytes
   */
  function sha1(chunks) {
    const { padded, dv } = padMessage(chunks);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe,
        h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Int32Array(80);

    for (let i = 0; i < padded.length; i += 64) {
      for (let j = 0; j < 16; j++) w[j] = dv.getInt32(i + j * 4, false);
      for (let j = 16; j < 80; j++) w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);

      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let j = 0; j < 80; j++) {
        let f, k;
        if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        const t = (rol(a, 5) + f + e + k + w[j]) | 0;
        e = d; d = c; c = rol(b, 30); b = a; a = t;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }

    const out = new Uint8Array(20), odv = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((h, i) => odv.setInt32(i * 4, h, false));
    return out;
  }

  const K256 = new Int32Array([
    0x428a2f98|0, 0x71374491|0, 0xb5c0fbcf|0, 0xe9b5dba5|0, 0x3956c25b|0, 0x59f111f1|0, 0x923f82a4|0, 0xab1c5ed5|0,
    0xd807aa98|0, 0x12835b01|0, 0x243185be|0, 0x550c7dc3|0, 0x72be5d74|0, 0x80deb1fe|0, 0x9bdc06a7|0, 0xc19bf174|0,
    0xe49b69c1|0, 0xefbe4786|0, 0x0fc19dc6|0, 0x240ca1cc|0, 0x2de92c6f|0, 0x4a7484aa|0, 0x5cb0a9dc|0, 0x76f988da|0,
    0x983e5152|0, 0xa831c66d|0, 0xb00327c8|0, 0xbf597fc7|0, 0xc6e00bf3|0, 0xd5a79147|0, 0x06ca6351|0, 0x14292967|0,
    0x27b70a85|0, 0x2e1b2138|0, 0x4d2c6dfc|0, 0x53380d13|0, 0x650a7354|0, 0x766a0abb|0, 0x81c2c92e|0, 0x92722c85|0,
    0xa2bfe8a1|0, 0xa81a664b|0, 0xc24b8b70|0, 0xc76c51a3|0, 0xd192e819|0, 0xd6990624|0, 0xf40e3585|0, 0x106aa070|0,
    0x19a4c116|0, 0x1e376c08|0, 0x2748774c|0, 0x34b0bcb5|0, 0x391c0cb3|0, 0x4ed8aa4a|0, 0x5b9cca4f|0, 0x682e6ff3|0,
    0x748f82ee|0, 0x78a5636f|0, 0x84c87814|0, 0x8cc70208|0, 0x90befffa|0, 0xa4506ceb|0, 0xbef9a3f7|0, 0xc67178f2|0
  ]);

  /**
   * @param {Array<Uint8Array>} chunks hashed as if concatenated
   * @returns {Uint8Array} 32 bytes
   */
  function sha256(chunks) {
    const { padded, dv } = padMessage(chunks);
    const h = new Int32Array([
      0x6a09e667|0, 0xbb67ae85|0, 0x3c6ef372|0, 0xa54ff53a|0,
      0x510e527f|0, 0x9b05688c|0, 0x1f83d9ab|0, 0x5be0cd19|0
    ]);
    const w = new Int32Array(64);

    for (let i = 0; i < padded.length; i += 64) {
      for (let j = 0; j < 16; j++) w[j] = dv.getInt32(i + j * 4, false);
      for (let j = 16; j < 64; j++) {
        const x = w[j - 15], y = w[j - 2];
        const s0 = ror(x, 7) ^ ror(x, 18) ^ (x >>> 3);
        const s1 = ror(y, 17) ^ ror(y, 19) ^ (y >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }

      let a = h[0], b = h[1], c = h[2], d = h[3],
          e = h[4], f = h[5], g = h[6], hh = h[7];

      for (let j = 0; j < 64; j++) {
        const S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K256[j] + w[j]) | 0;
        const S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }

      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }

    const out = new Uint8Array(32), odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setInt32(i * 4, h[i], false);
    return out;
  }

  const SHA1_BLOCK = 64;

  /**
   * HMAC-SHA1, RFC 2104.
   *
   * @param {Uint8Array} key any length; hashed if longer than the 64-byte
   *        block, zero padded if shorter
   * @param {Array<Uint8Array>} chunks the message, as if concatenated
   * @returns {Uint8Array} 20 bytes
   */
  function hmacSha1(key, chunks) {
    let k = key;
    if (k.length > SHA1_BLOCK) k = sha1([k]);

    const ipad = new Uint8Array(SHA1_BLOCK);
    const opad = new Uint8Array(SHA1_BLOCK);
    ipad.set(k);
    opad.set(k);
    for (let i = 0; i < SHA1_BLOCK; i++) {
      ipad[i] ^= 0x36;
      opad[i] ^= 0x5c;
    }

    return sha1([opad, sha1([ipad].concat(chunks))]);
  }

  return { aes, sha1, sha256, hmacSha1 };
});
