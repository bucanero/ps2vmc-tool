/*
 * hexedit.js - a small dependency-free hex editor modal.
 *
 * Same interaction model as the SAROO Saturn save editor: 16 bytes per row,
 * click a byte to edit it, two hex digits commit and advance, edited bytes are
 * highlighted until saved. Large files are paged rather than truncated, since
 * PS2 save files run to hundreds of KB.
 *
 * Either column can be edited. The hex side takes two hex digits per byte; the
 * ASCII side takes characters, so plain text can simply be typed (or pasted)
 * straight into the file.
 *
 * Self-contained: it injects its own stylesheet and markup, so both the PS1
 * and PS2 pages can use it without sharing any CSS.
 *
 *     HexEdit.open({
 *       title:    "BASLUS-01360FF4",
 *       subtitle: "save data · 2 blocks",
 *       data:     Uint8Array,
 *       readOnly: false,
 *       onSave:   bytes => { ... }        // omitted/false = view only
 *     });
 *
 * GPLv3, same as the rest of the repository.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HexEdit = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PAGE = 4096;               /* bytes rendered at once */
  const ROW = 16;

  const HINT = "click either column to edit \u00b7 hex takes two digits, ASCII takes text";
  const hex2 = v => v.toString(16).padStart(2, "0");
  const asciiChar = v => (v >= 0x20 && v < 0x7f) ? String.fromCharCode(v) : ".";

  /**
   * Turn typed or pasted text into bytes for the ASCII column: one character
   * per byte. Characters that need more than one byte (CJK, emoji, …) are
   * dropped rather than mangled, and the run is clamped to `limit` bytes so a
   * paste can never grow the file.
   */
  function encodeText(text, limit) {
    const out = [];
    for (const ch of text) {
      if (out.length >= limit) break;
      const code = ch.codePointAt(0);
      if (code > 0xff) continue;
      out.push(code);
    }
    return out;
  }

  const CSS = `
.hx-bg { position:fixed; inset:0; z-index:200; display:none;
  background:rgba(6,8,12,.78); align-items:center; justify-content:center; padding:18px; }
.hx-bg.hx-on { display:flex; }
.hx-modal { background:#161a22; border:1px solid #3a4356; border-radius:14px;
  width:min(860px,100%); max-height:92vh; display:flex; flex-direction:column;
  box-shadow:0 30px 80px rgba(0,0,0,.6); color:#e6e9ef;
  font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.hx-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap;
  padding:14px 18px; border-bottom:1px solid #2a3140; }
.hx-head h3 { margin:0; font-size:15px; font-weight:650; word-break:break-all; }
.hx-head .hx-sub { color:#6b7688; font-size:12px;
  font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
.hx-head .hx-spacer { flex:1 1 auto; }
.hx-badge { font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  padding:3px 8px; border-radius:999px; background:#1d222c; border:1px solid #3a4356; color:#98a2b3; }
.hx-badge.hx-dirtybadge { background:#3a2d10; border-color:#6b5010; color:#f5c85a; }
.hx-body { padding:14px 18px; overflow:auto; }
.hx-view { font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  background:#0f1218; border:1px solid #2a3140; border-radius:8px;
  padding:10px 12px; overflow:auto; white-space:pre; }
.hx-row { white-space:pre; }
.hx-off { color:#6b7688; user-select:none; }
.hx-b, .hx-a { border-radius:3px; cursor:text; }
.hx-b:hover, .hx-a:hover { background:#33405a; }
.hx-b.hx-d, .hx-a.hx-d { color:#f5a623; }
.hx-ascii, .hx-a { color:#98a2b3; user-select:none; }
.hx-cell { width:2.2ch; font:inherit; background:#12305a; color:#e6e9ef;
  border:1px solid #4f8cff; border-radius:3px; padding:0; margin:0;
  text-align:center; text-transform:lowercase; outline:none; vertical-align:baseline; }
.hx-ro .hx-b, .hx-ro .hx-a { cursor:default; }
.hx-ro .hx-b:hover, .hx-ro .hx-a:hover { background:transparent; }
.hx-cell.hx-txt { width:1.6ch; text-transform:none; }
.hx-bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
.hx-bar .hx-lbl { color:#6b7688; font:11.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
.hx-foot { display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  padding:14px 18px; border-top:1px solid #2a3140; }
.hx-foot .hx-spacer { flex:1 1 auto; }
.hx-modal button { font:inherit; font-size:13px; font-weight:500; color:#e6e9ef;
  background:#1d222c; border:1px solid #3a4356; border-radius:8px; padding:7px 13px;
  cursor:pointer; white-space:nowrap; }
.hx-modal button:hover { background:#262d3a; border-color:#4a5568; }
.hx-modal button.hx-primary { background:#4f8cff; border-color:#4f8cff; color:#fff; }
.hx-modal button.hx-primary:hover { background:#5f97ff; }
.hx-modal button:disabled { opacity:.4; cursor:not-allowed; }
.hx-modal button.hx-mini { padding:4px 9px; font-size:12px; }
.hx-goto { font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  background:#0f1218; color:#e6e9ef; border:1px solid #3a4356; border-radius:6px;
  padding:5px 8px; width:11ch; }
.hx-note { color:#6b7688; font-size:11.5px; margin-top:8px; }
`;

  let el = null;                 /* modal root */
  let data = null;               /* Uint8Array being edited */
  let dirty = false;
  let readOnly = false;
  let onSave = null;
  let pageStart = 0;
  let activeFinish = null;       /* closes whichever cell editor is open */
  const dirtySet = new Set();

  function build() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    el = document.createElement("div");
    el.className = "hx-bg";
    el.innerHTML =
      '<div class="hx-modal">' +
        '<div class="hx-head">' +
          '<h3 class="hx-title"></h3>' +
          '<span class="hx-sub"></span>' +
          '<span class="hx-spacer"></span>' +
          '<span class="hx-badge hx-dirtybadge" style="display:none">edited</span>' +
          '<span class="hx-badge hx-size"></span>' +
        '</div>' +
        '<div class="hx-body">' +
          '<div class="hx-bar">' +
            '<button class="hx-mini hx-prev">&#9664; prev</button>' +
            '<button class="hx-mini hx-next">next &#9654;</button>' +
            '<span class="hx-lbl hx-range"></span>' +
            '<span class="hx-spacer" style="flex:1"></span>' +
            '<input class="hx-goto" placeholder="offset 0x…">' +
            '<button class="hx-mini hx-gobtn">go</button>' +
          '</div>' +
          '<div class="hx-view"></div>' +
          '<div class="hx-note"></div>' +
        '</div>' +
        '<div class="hx-foot">' +
          '<span class="hx-lbl hx-hint"></span>' +
          '<span class="hx-spacer"></span>' +
          '<button class="hx-cancel">Cancel</button>' +
          '<button class="hx-primary hx-save">Save changes</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    const q = s => el.querySelector(s);

    q(".hx-view").addEventListener("click", e => {
      if (readOnly) return;
      const hexCell = e.target.closest(".hx-b");
      if (hexCell) { editHex(hexCell); return; }
      const asciiCell = e.target.closest(".hx-a");
      if (asciiCell) editAscii(asciiCell);
    });
    q(".hx-prev").addEventListener("click", () => gotoOffset(pageStart - PAGE));
    q(".hx-next").addEventListener("click", () => gotoOffset(pageStart + PAGE));
    q(".hx-gobtn").addEventListener("click", () => {
      const v = parseInt(q(".hx-goto").value.trim().replace(/^0x/i, ""), 16);
      if (!isNaN(v)) gotoOffset(v);
    });
    q(".hx-goto").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); q(".hx-gobtn").click(); }
    });
    q(".hx-cancel").addEventListener("click", () => close(true));
    q(".hx-save").addEventListener("click", commit);
    el.addEventListener("mousedown", e => { if (e.target === el) close(true); });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && el.classList.contains("hx-on") &&
          !el.querySelector(".hx-cell")) close(true);
    });
  }

  function esc(s) {
    return s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function render() {
    const q = s => el.querySelector(s);
    const len = data.length;
    const end = Math.min(len, pageStart + PAGE);

    let html = "";
    for (let base = pageStart; base < end; base += ROW) {
      let hx = "", asc = "";
      for (let i = 0; i < ROW; i++) {
        const o = base + i;
        if (o < end) {
          const d = dirtySet.has(o) ? " hx-d" : "";
          hx += '<span class="hx-b' + d + '" data-o="' + o + '">' + hex2(data[o]) + "</span>";
          asc += '<span class="hx-a' + d + '" data-o="' + o + '">' + esc(asciiChar(data[o])) + "</span>";
        } else {
          hx += "  ";
          asc += " ";
        }
        if (i < ROW - 1) hx += " ";
        if (i === 7) hx += " ";
      }
      html += '<div class="hx-row"><span class="hx-off">' +
              base.toString(16).padStart(8, "0") + "</span>  " + hx + "  " + asc + "</div>";
    }
    q(".hx-view").innerHTML = html || '<span class="hx-off">empty file</span>';

    const pages = Math.max(1, Math.ceil(len / PAGE));
    const paged = len > PAGE;
    q(".hx-prev").style.display = paged ? "" : "none";
    q(".hx-next").style.display = paged ? "" : "none";
    q(".hx-goto").style.display = paged ? "" : "none";
    q(".hx-gobtn").style.display = paged ? "" : "none";
    q(".hx-prev").disabled = pageStart <= 0;
    q(".hx-next").disabled = pageStart + PAGE >= len;
    q(".hx-range").textContent = paged
      ? "0x" + pageStart.toString(16).padStart(8, "0") + " – 0x" +
        Math.max(pageStart, end - 1).toString(16).padStart(8, "0") +
        "   (page " + (Math.floor(pageStart / PAGE) + 1) + " of " + pages + ")"
      : "";
    q(".hx-note").textContent = paged
      ? "The whole file is kept in memory; paging only limits how much is drawn at once."
      : "";
    q(".hx-size").textContent = len + " bytes (0x" + len.toString(16) + ")";
    q(".hx-dirtybadge").style.display = dirty ? "" : "none";
    q(".hx-hint").textContent = readOnly
      ? "read only"
      : (dirty ? dirtySet.size + " byte" + (dirtySet.size === 1 ? "" : "s") + " changed"
               : HINT);
    q(".hx-save").disabled = readOnly || !dirty;
  }

  function gotoOffset(off) {
    activeFinish = null;         /* render() is about to drop the input */
    const len = data.length;
    off = Math.max(0, Math.min(off, Math.max(0, len - 1)));
    pageStart = Math.floor(off / PAGE) * PAGE;
    render();
    el.querySelector(".hx-view").scrollTop = 0;
  }

  /* ---- editing -------------------------------------------------------
   * Both columns drive the same byte store. The hex column takes two hex
   * digits per byte; the ASCII column takes one character per byte, so plain
   * text can be typed or pasted straight in.
   * ------------------------------------------------------------------- */

  const cellFor = (kind, o) =>
    el.querySelector("." + (kind === "hex" ? "hx-b" : "hx-a") + '[data-o="' + o + '"]');

  /* Repaint one byte in both columns without rebuilding the whole page. */
  function paintByte(o) {
    const hexCell = cellFor("hex", o), ascCell = cellFor("ascii", o);
    const d = dirtySet.has(o);
    if (hexCell && !hexCell.querySelector("input")) {
      hexCell.textContent = hex2(data[o]);
      hexCell.classList.toggle("hx-d", d);
    }
    if (ascCell && !ascCell.querySelector("input")) {
      ascCell.textContent = asciiChar(data[o]);
      ascCell.classList.toggle("hx-d", d);
    }
  }

  /* Header badge, footer hint and the Save button. */
  function paintChrome() {
    const q = sel => el.querySelector(sel);
    q(".hx-dirtybadge").style.display = dirty ? "" : "none";
    q(".hx-hint").textContent = readOnly
      ? "read only"
      : (dirty ? dirtySet.size + " byte" + (dirtySet.size === 1 ? "" : "s") + " changed"
               : HINT);
    q(".hx-save").disabled = readOnly || !dirty;
  }

  function setByte(o, v) {
    if (o < 0 || o >= data.length || data[o] === (v & 0xff)) return false;
    data[o] = v & 0xff;
    dirtySet.add(o);
    dirty = true;
    return true;
  }

  /* Move the caret to another byte, paging there first if needed. */
  function focusByte(kind, o) {
    if (o < 0 || o >= data.length) return;
    if (o < pageStart || o >= pageStart + PAGE) gotoOffset(o);
    const cell = cellFor(kind, o);
    if (cell) (kind === "hex" ? editHex : editAscii)(cell);
  }

  /* Only one cell may be under edit at a time. A real mouse click blurs the
   * previous input, but focusByte() opens one programmatically, so close any
   * open editor explicitly. The stored finisher uses blur semantics and never
   * advances, so this cannot recurse. */
  function closeActiveCell() {
    const f = activeFinish;
    activeFinish = null;
    if (f) f();
  }

  /* Shared plumbing for an inline input over one cell. */
  function makeInput(cell, kind, value, extraClass) {
    const inp = document.createElement("input");
    inp.className = "hx-cell" + (extraClass ? " " + extraClass : "");
    inp.value = value;
    inp.spellcheck = false;
    inp.autocapitalize = "off";
    inp.autocomplete = "off";
    cell.textContent = "";
    cell.appendChild(inp);
    inp.focus();
    inp.select();
    return inp;
  }

  function editHex(cell) {
    if (cell.querySelector("input")) return;
    closeActiveCell();
    const o = +cell.dataset.o;
    const inp = makeInput(cell, "hex", hex2(data[o]));
    inp.maxLength = 2;

    let done = false;
    const finish = (commitValue, advance) => {
      if (done) return;
      done = true;
      if (activeFinish === selfFinish) activeFinish = null;
      if (commitValue) {
        const v = parseInt(inp.value, 16);
        if (!isNaN(v)) setByte(o, v);
      }
      cell.textContent = hex2(data[o]);
      cell.classList.toggle("hx-d", dirtySet.has(o));
      paintByte(o);
      paintChrome();
      if (commitValue && advance) focusByte("hex", o + 1);
    };

    inp.addEventListener("input", () => {
      inp.value = inp.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 2);
      if (inp.value.length === 2) finish(true, true);
    });
    inp.addEventListener("keydown", ev => {
      if (ev.key === "Enter") { ev.preventDefault(); finish(true, false); }
      else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finish(false, false); }
      else if (ev.key === "Tab") { ev.preventDefault(); finish(true, true); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); finish(true, true); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); finish(true, false); focusByte("hex", o - 1); }
    });
    inp.addEventListener("blur", () => finish(true, false));

    const selfFinish = () => finish(true, false);   /* blur semantics */
    activeFinish = selfFinish;
  }

  function editAscii(cell) {
    if (cell.querySelector("input")) return;
    closeActiveCell();
    const o = +cell.dataset.o;
    const inp = makeInput(cell, "ascii", asciiChar(data[o]), "hx-txt");

    let done = false;

    /* Write a run of characters starting at `o`; returns how many bytes it
     * covered. See encodeText() for what happens to multi-byte characters. */
    const writeText = text => {
      const bytes = encodeText(text, data.length - o);
      bytes.forEach((b, i) => setByte(o + i, b));
      return bytes.length;
    };

    const finish = (commitValue, advance, typed) => {
      if (done) return;
      done = true;
      if (activeFinish === selfFinish) activeFinish = null;
      let written = 0;
      if (commitValue && typed !== "") written = writeText(typed !== undefined ? typed : inp.value);

      cell.textContent = asciiChar(data[o]);
      cell.classList.toggle("hx-d", dirtySet.has(o));
      for (let i = 0; i < Math.max(1, written); i++) paintByte(o + i);
      paintChrome();

      if (commitValue && advance) focusByte("ascii", o + Math.max(1, written));
    };

    /* Typing a character (or pasting several) commits immediately and moves
     * on, so a whole string can just be typed into the file. */
    inp.addEventListener("input", () => {
      const v = inp.value;
      if (v.length === 0) return;
      finish(true, true, v);
    });
    inp.addEventListener("keydown", ev => {
      if (ev.key === "Enter") { ev.preventDefault(); finish(true, false); }
      else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finish(false, false, ""); }
      else if (ev.key === "Tab") { ev.preventDefault(); finish(true, true); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); finish(false, false, ""); focusByte("ascii", o + 1); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); finish(false, false, ""); focusByte("ascii", o - 1); }
      else if (ev.key === "Backspace") { ev.preventDefault(); finish(false, false, ""); focusByte("ascii", o - 1); }
    });
    inp.addEventListener("blur", () => finish(false, false, ""));

    const selfFinish = () => finish(false, false, "");   /* blur semantics */
    activeFinish = selfFinish;
  }

  function commit() {
    if (readOnly || !dirty || !onSave) return;
    const fn = onSave;
    const bytes = data;
    close(false);
    fn(bytes);
  }

  function close(confirmIfDirty) {
    if (confirmIfDirty && dirty &&
        !confirm("Discard the edits you made to these bytes?")) return;
    closeActiveCell();
    el.classList.remove("hx-on");
    data = null;
    onSave = null;
    dirty = false;
    dirtySet.clear();
  }

  function open(opts) {
    if (!el) build();
    data = opts.data instanceof Uint8Array ? opts.data.slice() : new Uint8Array(opts.data || 0);
    onSave = opts.onSave || null;
    readOnly = !!opts.readOnly || !onSave;
    dirty = false;
    dirtySet.clear();
    pageStart = 0;

    el.querySelector(".hx-title").textContent = opts.title || "Hex editor";
    el.querySelector(".hx-sub").textContent = opts.subtitle || "";
    el.querySelector(".hx-save").style.display = readOnly ? "none" : "";
    el.querySelector(".hx-cancel").textContent = readOnly ? "Close" : "Cancel";
    el.querySelector(".hx-view").classList.toggle("hx-ro", readOnly);

    render();
    el.classList.add("hx-on");
  }

  return { open, close: () => close(false), PAGE, encodeText };
});
