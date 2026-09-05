/*
 * ps2vmc.js - JavaScript API over the PS2VMC WebAssembly module.
 *
 * Wraps web-ps2/src/web_api.c so callers work with strings, Uint8Arrays and
 * plain objects instead of heap pointers. Loads in a browser (window.PS2VMC)
 * and in Node (module.exports), so the same API backs both the web UI and the
 * differential tests in test/.
 *
 * GPLv3, same as the rest of the repository.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PS2VMC = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* mcio error codes, from include/mcio.h */
  const ERRORS = {
    0: "ok",
    "-1": "changed card",
    "-2": "card is not formatted",
    "-3": "card is full",
    "-4": "no such file or directory",
    "-5": "permission denied",
    "-6": "directory is not empty",
    "-7": "too many open handles",
    "-8": "failed to replace block",
    "-11": "failed to reset auth",
    "-12": "not a PS2 memory card",
    "-13": "unrecognised card image",
    "-21": "failed to read cluster",
    "-47": "failed to check backup blocks",
    "-48": "I/O error",
    "-49": "failed to set device specs",
    "-51": "PS1 card access denied",
    "-90": "auth failed",
    "-100": "not a directory",
    "-101": "not a file",
    "-1000": "out of memory",
    "-1010": "not a PS2 save container",
    "-1011": "file is truncated",
    "-1012": "could not decompress the save",
    "-1013": "the card already has a save with that name",
    "-1001": "short read",
    "-1002": "allocation failed",
    "-1003": "truncated or malformed container",
    "-1004": "write failed"
  };

  function errText(code) {
    return ERRORS[String(code)] || ("error " + code);
  }

  /* file mode bits, from include/mcio.h */
  const ATTR = {
    READABLE: 0x0001, WRITEABLE: 0x0002, EXECUTABLE: 0x0004,
    DUPPROHIBIT: 0x0008, FILE: 0x0010, SUBDIR: 0x0020,
    CLOSED: 0x0080, PDAEXEC: 0x0800, PS1: 0x1000,
    HIDDEN: 0x2000, EXISTS: 0x8000
  };

  /* Save containers the wasm can identify; mirrors enum ps2save_format. */
  const FORMAT = {
    UNKNOWN: 0, PSU: 1, PSV: 2, CBS: 3, MAX: 4, XPS: 5
  };

  const FORMAT_NAME = {
    0: "unknown", 1: "PSU", 2: "PSV",
    3: "CodeBreaker", 4: "Action Replay MAX", 5: "Xploder/SharkPort"
  };

  class VmcError extends Error {
    constructor(code, what) {
      super((what ? what + ": " : "") + errText(code));
      this.code = code;
    }
  }

  function create(Module) {
    const c = {
      alloc:      Module.cwrap("vmc_alloc", "number", ["number"]),
      dataPtr:    Module.cwrap("vmc_data_ptr", "number", []),
      dataSize:   Module.cwrap("vmc_data_size", "number", []),
      open:       Module.cwrap("vmc_open", "number", []),
      free:       Module.cwrap("vmc_free", null, ["number"]),
      info:       Module.cwrap("vmc_info", "number", ["number", "number", "number", "number"]),
      freeSpace:  Module.cwrap("vmc_free_space", "number", ["number"]),
      format:     Module.cwrap("vmc_format", "number", []),
      unformat:   Module.cwrap("vmc_unformat", "number", []),
      dopen:      Module.cwrap("vmc_dopen", "number", ["string"]),
      dread:      Module.cwrap("vmc_dread", "number", ["number", "number"]),
      dclose:     Module.cwrap("vmc_dclose", "number", ["number"]),
      stat:       Module.cwrap("vmc_stat", "number", ["string", "number"]),
      mkdir:      Module.cwrap("vmc_mkdir", "number", ["string"]),
      rmdir:      Module.cwrap("vmc_rmdir", "number", ["string"]),
      remove:     Module.cwrap("vmc_remove", "number", ["string"]),
      crosslink:  Module.cwrap("vmc_crosslink", "number", ["string", "string"]),
      fileRead:   Module.cwrap("vmc_file_read", "number", ["string", "number"]),
      fileWrite:  Module.cwrap("vmc_file_write", "number", ["string", "number", "number"]),
      imageRaw:   Module.cwrap("vmc_image_raw", "number", ["number"]),
      imageEcc:   Module.cwrap("vmc_image_ecc", "number", ["number"]),
      psuExport:  Module.cwrap("vmc_psu_export", "number", ["string", "number"]),
      psuImport:  Module.cwrap("vmc_psu_import", "number", ["number", "number"]),
      psvImport:  Module.cwrap("vmc_psv_import", "number", ["number", "number"]),
      saveImport: Module.cwrap("vmc_save_import", "number", ["number", "number"]),
      xpsExport:  Module.cwrap("vmc_xps_export", "number", ["string", "number"]),
      saveDetect: Module.cwrap("vmc_save_detect", "number", ["number", "number"]),
      saveDirName: Module.cwrap("vmc_save_dirname", "string", ["number", "number"]),
      blankCard:  Module.cwrap("vmc_blank_card", "number", ["number"]),
      sizeofDirent: Module.cwrap("vmc_sizeof_dirent", "number", []),
      offsetofName: Module.cwrap("vmc_offsetof_name", "number", [])
    };

    /* Struct geometry comes from the C side so the two can never drift. */
    const DIRENT_SIZE = c.sizeofDirent();
    const NAME_OFF = c.offsetofName();

    const heap = () => Module.HEAPU8;
    const view = () => new DataView(Module.HEAPU8.buffer);

    /* scratch space for int out-params */
    let scratch = 0;
    function scratchPtr(bytes) {
      if (!scratch) scratch = Module._malloc(64);
      if (bytes > 64) throw new Error("scratch too small");
      return scratch;
    }

    function readDate(dv, off) {
      return {
        sec: dv.getUint8(off + 1), min: dv.getUint8(off + 2), hour: dv.getUint8(off + 3),
        day: dv.getUint8(off + 4), month: dv.getUint8(off + 5), year: dv.getUint16(off + 6, true)
      };
    }

    function fmtDate(d) {
      const p = n => String(n).padStart(2, "0");
      if (!d.year) return "";
      return p(d.month) + "/" + p(d.day) + "/" + d.year + " " +
             p(d.hour) + ":" + p(d.min) + ":" + p(d.sec);
    }

    function readCString(ptr, max) {
      const h = heap();
      let end = ptr;
      while (end < ptr + max && h[end] !== 0) end++;
      /* PS2 filenames are ASCII in practice; decode leniently either way */
      return new TextDecoder("utf-8", { fatal: false }).decode(h.subarray(ptr, end));
    }

    function parseDirent(ptr) {
      const dv = view();
      const mode = dv.getUint32(ptr + 0, true);
      const d = {
        mode,
        attr: dv.getUint32(ptr + 4, true),
        size: dv.getUint32(ptr + 8, true),
        ctime: readDate(dv, ptr + 12),
        mtime: readDate(dv, ptr + 20),
        name: readCString(ptr + NAME_OFF, 256)
      };
      d.isDir = !!(mode & ATTR.SUBDIR);
      d.mtimeText = fmtDate(d.mtime);
      d.ctimeText = fmtDate(d.ctime);
      d.attrText =
        ((mode & ATTR.READABLE) ? "r" : "-") +
        ((mode & ATTR.WRITEABLE) ? "w" : "-") +
        ((mode & ATTR.EXECUTABLE) ? "x" : "-") +
        ((mode & ATTR.DUPPROHIBIT) ? "p" : "-") +
        ((mode & ATTR.HIDDEN) ? "H" : "-") +
        ((mode & ATTR.PDAEXEC) ? "S" : "-") +
        ((mode & ATTR.PS1) ? "1" : "-");
      return d;
    }

    /* Take ownership of a malloc'd (ptr,len) pair and copy it out to JS. */
    function takeBuffer(ptr, len) {
      const out = heap().slice(ptr, ptr + len);
      c.free(ptr);
      return out;
    }

    const api = {
      ATTR,
      VmcError,
      errText,

      /* ---- card ---- */

      /**
       * Build an empty 8 MB card image, raw and without ECC spare bytes.
       * Written by src/ps2blank.c, the same code behind the CLI's
       * --mc-create, because mcio cannot format an image that is not
       * already a card.
       */
      blankCard() {
        const lp = scratchPtr(4);
        const ptr = c.blankCard(lp);
        const len = view().getInt32(lp, true);
        if (!ptr) throw new VmcError(len, "building a blank card");
        return takeBuffer(ptr, len);
      },

      /** Load a .vmc/.ps2/.mcd image. Returns card info; throws VmcError. */
      openCard(bytes) {
        const ptr = c.alloc(bytes.length);
        if (!ptr) throw new VmcError(-1000, "allocating card");
        heap().set(bytes, ptr);
        const r = c.open();
        if (r < 0) throw new VmcError(r, "opening card");
        return api.info();
      },

      /** The live card image, with every edit applied. */
      cardBytes() {
        const ptr = c.dataPtr(), len = c.dataSize();
        return heap().slice(ptr, ptr + len);
      },

      info() {
        const p = scratchPtr(16);
        const r = c.info(p, p + 4, p + 8, p + 12);
        if (r < 0) throw new VmcError(r, "reading card info");
        const dv = view();
        const flags = dv.getInt32(p + 12, true);
        return {
          pageSize: dv.getInt32(p, true),
          blockSize: dv.getInt32(p + 4, true),
          cardSize: dv.getInt32(p + 8, true),
          cardFlags: flags,
          usesEcc: !!(flags & 1),
          badBlockMgmt: !!(flags & 8),
          eraseByte: (flags & 16) ? 0x00 : 0xff
        };
      },

      /** Free space in bytes. */
      freeSpace() {
        const p = scratchPtr(4);
        const r = c.freeSpace(p);
        if (r < 0) throw new VmcError(r, "reading free space");
        return view().getInt32(p, true);
      },

      format() {
        const r = c.format();
        if (r < 0) throw new VmcError(r, "formatting card");
      },

      /* ---- directories ---- */

      /** List a directory. Returns entries excluding "." and ".." by default. */
      list(path, includeDots) {
        const dd = c.dopen(path);
        if (dd < 0) throw new VmcError(dd, "opening " + path);

        const buf = Module._malloc(DIRENT_SIZE);
        const out = [];
        try {
          for (;;) {
            const r = c.dread(dd, buf);
            if (!r) break;
            const e = parseDirent(buf);
            if (includeDots || (e.name !== "." && e.name !== "..")) out.push(e);
          }
        } finally {
          Module._free(buf);
          c.dclose(dd);
        }
        return out;
      },

      stat(path) {
        const buf = Module._malloc(DIRENT_SIZE);
        try {
          const r = c.stat(path, buf);
          if (r < 0) throw new VmcError(r, "stat " + path);
          return parseDirent(buf);
        } finally {
          Module._free(buf);
        }
      },

      mkdir(path) {
        const r = c.mkdir(path);
        if (r < 0) throw new VmcError(r, "mkdir " + path);
      },

      rmdir(path) {
        const r = c.rmdir(path);
        if (r < 0) throw new VmcError(r, "rmdir " + path);
      },

      remove(path) {
        const r = c.remove(path);
        if (r < 0) throw new VmcError(r, "remove " + path);
      },

      crosslink(realPath, dummyPath) {
        const r = c.crosslink(realPath, dummyPath);
        if (r < 0) throw new VmcError(r, "crosslink " + dummyPath);
      },

      /* ---- files ---- */

      readFile(path) {
        const lp = scratchPtr(4);
        const ptr = c.fileRead(path, lp);
        const len = view().getInt32(lp, true);
        if (!ptr) throw new VmcError(len, "reading " + path);
        return takeBuffer(ptr, len);
      },

      writeFile(path, bytes) {
        const ptr = Module._malloc(bytes.length || 1);
        try {
          heap().set(bytes, ptr);
          const r = c.fileWrite(path, ptr, bytes.length);
          if (r < 0) throw new VmcError(r, "writing " + path);
        } finally {
          Module._free(ptr);
        }
      },

      /* ---- containers ---- */

      psuExport(path) {
        const lp = scratchPtr(4);
        const ptr = c.psuExport(path, lp);
        const len = view().getInt32(lp, true);
        if (!ptr) throw new VmcError(len, "exporting " + path);
        return takeBuffer(ptr, len);
      },

      /** Export a save as an Xploder/SharkPort .xps. */
      xpsExport(path) {
        const lp = scratchPtr(4);
        const ptr = c.xpsExport(path, lp);
        const len = view().getInt32(lp, true);
        if (!ptr) throw new VmcError(len, "exporting " + path);
        return takeBuffer(ptr, len);
      },

      psuImport(bytes) {
        const ptr = Module._malloc(bytes.length);
        try {
          heap().set(bytes, ptr);
          const r = c.psuImport(ptr, bytes.length);
          if (r < 0) throw new VmcError(r, "importing PSU");
        } finally {
          Module._free(ptr);
        }
      },

      psvImport(bytes) {
        const ptr = Module._malloc(bytes.length);
        try {
          heap().set(bytes, ptr);
          const r = c.psvImport(ptr, bytes.length);
          if (r < 0) throw new VmcError(r, "importing PSV");
        } finally {
          Module._free(ptr);
        }
      },

      /** Which container is this? One of PS2VMC.FORMAT. */
      detect(bytes) {
        const ptr = Module._malloc(bytes.length || 1);
        try {
          heap().set(bytes, ptr);
          return c.saveDetect(ptr, bytes.length);
        } finally {
          Module._free(ptr);
        }
      },

      /** The directory a .cbs/.max/.xps would create, or "" if unreadable. */
      saveDirName(bytes) {
        const ptr = Module._malloc(bytes.length || 1);
        try {
          heap().set(bytes, ptr);
          return c.saveDirName(ptr, bytes.length);
        } finally {
          Module._free(ptr);
        }
      },

      /** Import a .cbs/.max/.xps save; the format is detected from the data. */
      saveImport(bytes) {
        const ptr = Module._malloc(bytes.length);
        try {
          heap().set(bytes, ptr);
          const r = c.saveImport(ptr, bytes.length);
          if (r < 0) throw new VmcError(r, "importing save");
        } finally {
          Module._free(ptr);
        }
      },

      /* ---- images ---- */

      imageRaw() {
        const lp = scratchPtr(4);
        const ptr = c.imageRaw(lp);
        const len = view().getInt32(lp, true);
        if (!ptr) throw new VmcError(len, "building raw image");
        return takeBuffer(ptr, len);
      },

      imageEcc() {
        const lp = scratchPtr(4);
        const ptr = c.imageEcc(lp);
        const len = view().getInt32(lp, true);
        if (!ptr) throw new VmcError(len, "building ECC image");
        return takeBuffer(ptr, len);
      },

      /** Walk the whole card, depth-first. Returns a flat list of entries. */
      walk(root) {
        const start = root || "/";
        const out = [];
        const visit = (dir) => {
          let entries;
          try { entries = api.list(dir); } catch (e) { return; }
          for (const e of entries) {
            const full = (dir === "/" ? "/" : dir + "/") + e.name;
            out.push(Object.assign({ path: full }, e));
            if (e.isDir) visit(full);
          }
        };
        visit(start);
        return out;
      }
    };

    return api;
  }

  function decodeBase64(b64) {
    if (typeof Buffer !== "undefined")
      return new Uint8Array(Buffer.from(b64, "base64"));
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** The base64 module, however this file was loaded. */
  function wasmBinary() {
    let b64 = typeof PS2VMC_WASM_BASE64 !== "undefined" ? PS2VMC_WASM_BASE64 : null;
    if (!b64 && typeof require !== "undefined") {
      try { b64 = require("./ps2vmc-wasm-binary.js"); } catch (e) { /* fetched instead */ }
    }
    return b64 ? decodeBase64(b64) : null;
  }

  /** Instantiate the wasm module and return the API. */
  async function load(factory) {
    const make = factory ||
      (typeof createPS2VMC !== "undefined" ? createPS2VMC : null) ||
      (typeof require !== "undefined" ? require("./ps2vmc-wasm.js") : null);
    if (!make) throw new Error("ps2vmc-wasm.js not loaded");

    /* Handing emscripten the bytes up front means it never fetches, so the
     * page runs from a file:// URL as well as over HTTP. */
    const bin = wasmBinary();
    const Module = await make(bin ? { wasmBinary: bin } : {});
    return create(Module);
  }


  return { load, ATTR, FORMAT, FORMAT_NAME, errText, VmcError };
});
