/*
 * ps2icon.js - parser for PS2 save icons (.ico) and icon.sys.
 *
 * PS2 icons are not images: they are small textured 3D models with per-vertex
 * morph targets ("animation shapes") and a keyframed animation track, lit by
 * three directional lights defined in icon.sys. This module turns both files
 * into plain JS objects; rendering lives in icon3d.js.
 *
 * Format reference: https://ghulbus-inc.de/projects/ps2iconsys/
 * Layout mirrors include/ps2icon.h.
 *
 * GPLv3, same as the rest of the repository.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PS2Icon = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const F16 = 1 / 4096;   /* fixed point 12.4 -> float */

  /* 16-bit BGR555 texel -> RGBA bytes. Mirrors TIM2RGBA() in src/ps2icon.c. */
  function texel(lo, hi) {
    const v = (hi << 8) | lo;
    return [8 * (v & 0x1f), 8 * ((v >> 5) & 0x1f), 8 * ((v >> 10) & 0x1f), 0xff];
  }

  /**
   * Parse a .ico file.
   * @param {Uint8Array} bytes
   * @returns {{shapes: Float32Array[], normals: Float32Array, uvs: Float32Array,
   *            colors: Uint8Array, texture: Uint8ClampedArray|null,
   *            vertexCount: number, shapeCount: number, frames: Array, animSpeed: number}}
   */
  function parseIco(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 0;

    const fileId = dv.getUint32(o, true); o += 4;
    const shapeCount = dv.getUint32(o, true); o += 4;
    const textureType = dv.getUint32(o, true); o += 4;
    o += 4; /* reserved */
    const vertexCount = dv.getUint32(o, true); o += 4;

    if (fileId !== 0x010000 || vertexCount % 3 !== 0 || vertexCount === 0)
      throw new Error("not a PS2 icon (id=0x" + fileId.toString(16) + ", " + vertexCount + " vertices)");
    if (shapeCount < 1 || shapeCount > 64)
      throw new Error("implausible shape count: " + shapeCount);

    /* --- vertex block ---
     * per vertex: shapeCount position tuples, one normal tuple, one texture tuple
     * (each tuple is 8 bytes) */
    const stride = 8 * shapeCount + 8 + 8;
    if (o + stride * vertexCount > bytes.length)
      throw new Error("icon truncated in vertex data");

    const shapes = [];
    for (let s = 0; s < shapeCount; s++) shapes.push(new Float32Array(vertexCount * 3));
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = new Uint8Array(vertexCount * 4);

    for (let i = 0; i < vertexCount; i++) {
      for (let s = 0; s < shapeCount; s++) {
        shapes[s][i * 3]     = dv.getInt16(o, true) * F16;
        shapes[s][i * 3 + 1] = dv.getInt16(o + 2, true) * F16;
        shapes[s][i * 3 + 2] = dv.getInt16(o + 4, true) * F16;
        o += 8;
      }
      normals[i * 3]     = dv.getInt16(o, true) * F16;
      normals[i * 3 + 1] = dv.getInt16(o + 2, true) * F16;
      normals[i * 3 + 2] = dv.getInt16(o + 4, true) * F16;
      o += 8;

      uvs[i * 2]     = dv.getInt16(o, true) * F16;
      uvs[i * 2 + 1] = dv.getInt16(o + 2, true) * F16;
      colors[i * 4]     = bytes[o + 4];
      colors[i * 4 + 1] = bytes[o + 5];
      colors[i * 4 + 2] = bytes[o + 6];
      colors[i * 4 + 3] = bytes[o + 7];
      o += 8;
    }

    /* --- animation block --- */
    let animSpeed = 1, frameLength = 0, frames = [];
    if (o + 20 <= bytes.length) {
      o += 4;                                   /* id_tag */
      frameLength = dv.getUint32(o, true); o += 4;
      animSpeed = dv.getFloat32(o, true); o += 4;
      o += 4;                                   /* play_offset */
      const frameCount = dv.getUint32(o, true); o += 4;

      if (frameCount < 4096) {
        for (let f = 0; f < frameCount && o + 8 <= bytes.length; f++) {
          const shapeId = dv.getUint32(o, true);
          const keyCount = dv.getUint32(o + 4, true);
          o += 8;
          const keys = [];
          for (let k = 0; k < keyCount && o + 8 <= bytes.length; k++) {
            keys.push({ time: dv.getFloat32(o, true), value: dv.getFloat32(o + 4, true) });
            o += 8;
          }
          frames.push({ shapeId, keys });
        }
      }
    }

    /* --- texture (128x128) --- */
    const texture = parseTexture(bytes, o, textureType);

    return {
      shapes, normals, uvs, colors, texture,
      vertexCount, shapeCount, textureType,
      frames, frameLength, animSpeed: animSpeed > 0 ? animSpeed : 1
    };
  }

  /* Both texture encodings from ps2IconTexture() in src/ps2icon.c. */
  function parseTexture(bytes, o, textureType) {
    const out = new Uint8ClampedArray(128 * 128 * 4);
    let px = 0;

    if (textureType <= 7) {
      if (o + 128 * 128 * 2 > bytes.length) return null;
      for (let i = 0; i < 128 * 128; i++, o += 2) {
        const c = texel(bytes[o], bytes[o + 1]);
        out[px++] = c[0]; out[px++] = c[1]; out[px++] = c[2]; out[px++] = c[3];
      }
      return out;
    }

    /* RLE: a signed count, negative meaning "n literal texels" */
    o += 4;
    let guard = 0;
    while (px < 128 * 128 * 4 && o + 2 <= bytes.length && guard++ < 200000) {
      let n = (bytes[o + 1] << 8) | bytes[o];
      if ((n & 0xff00) === 0xff00) {
        n = (0x10000 - n) & 0xffff;
        for (; n > 0 && px < out.length; n--) {
          o += 2;
          if (o + 2 > bytes.length) break;
          const c = texel(bytes[o], bytes[o + 1]);
          out[px++] = c[0]; out[px++] = c[1]; out[px++] = c[2]; out[px++] = c[3];
        }
      } else {
        o += 2;
        if (o + 2 > bytes.length) break;
        const c = texel(bytes[o], bytes[o + 1]);
        for (; n > 0 && px < out.length; n--) {
          out[px++] = c[0]; out[px++] = c[1]; out[px++] = c[2]; out[px++] = c[3];
        }
      }
      o += 2;
    }

    /* A short decode means the texture block is truncated or missing entirely,
     * which is the same case the uncompressed branch rejects above. Report it
     * as textureless rather than handing back a half-decoded image: the
     * renderer falls back to vertex colours, and the grid would otherwise show
     * a black tile that looks like real texture data. */
    return px === out.length ? out : null;
  }

  /**
   * Parse icon.sys (964 bytes). Layout mirrors ps2_IconSys_t in include/ps2icon.h.
   */
  function parseIconSys(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);

    const u32rgba = off => [
      dv.getUint32(off, true) / 255, dv.getUint32(off + 4, true) / 255,
      dv.getUint32(off + 8, true) / 255, dv.getUint32(off + 12, true) / 255
    ];
    const f32vec = off => [
      dv.getFloat32(off, true), dv.getFloat32(off + 4, true),
      dv.getFloat32(off + 8, true), dv.getFloat32(off + 12, true)
    ];
    const str = (off, len) => {
      let end = off;
      while (end < off + len && bytes[end] !== 0) end++;
      const raw = bytes.subarray(off, end);
      try {
        return new TextDecoder("shift-jis").decode(raw).normalize("NFKC");
      } catch (e) {
        return String.fromCharCode.apply(null, Array.from(raw)).replace(/[^\x20-\x7e]/g, "");
      }
    };

    const secondLineOffset = dv.getUint16(6, true);

    /* offsets follow the struct field order in ps2icon.h */
    let o = 16;
    const bg = [u32rgba(o), u32rgba(o + 16), u32rgba(o + 32), u32rgba(o + 48)];
    o += 64;
    const lightDir = [f32vec(o), f32vec(o + 16), f32vec(o + 32)];
    o += 48;
    const lightCol = [f32vec(o), f32vec(o + 16), f32vec(o + 32)];
    o += 48;
    const ambient = f32vec(o);
    o += 16;

    const titleRaw = str(o, 68);
    const title = secondLineOffset > 0
      ? [titleRaw.slice(0, secondLineOffset / 2), titleRaw.slice(secondLineOffset / 2)]
      : [titleRaw, ""];

    return {
      magic,
      transparency: dv.getUint32(12, true) / 128,
      background: bg,
      lightDirections: lightDir,
      lightColors: lightCol,
      ambient,
      titleLines: title.map(s => s.trim()).filter(s => s !== ""),
      title: title.join(" ").trim(),
      iconName: str(o + 68, 64),
      copyIconName: str(o + 132, 64),
      deleteIconName: str(o + 196, 64)
    };
  }

  return { parseIco, parseIconSys };
});
