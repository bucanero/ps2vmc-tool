/*
 * app.js - UI for the PS2 memory card manager.
 *
 * Talks to the wasm filesystem through ps2vmc.js, decodes save icons with
 * ps2icon.js and renders them with icon3d.js.
 *
 * GPLv3, same as the rest of the repository.
 */
"use strict";

const $ = id => document.getElementById(id);

let vmc = null;          /* PS2VMC api */
let viewer = null;       /* PS2Icon3D renderer (created lazily) */
let state = { fileName: "memcard.vmc", dirty: false, info: null, current: null };

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function toast(msg, kind) {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast("Downloaded " + name, "ok");
}

function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result));
    fr.onerror = () => reject(new Error("could not read " + file.name));
    fr.readAsArrayBuffer(file);
  });
}

function markDirty() {
  state.dirty = true;
  $("card-dirty").style.display = "";
}

function baseName() {
  return state.fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "") || "memcard";
}

function safeName(s, fallback) {
  const t = (s || "").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
  return t || fallback;
}

function fmtSize(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
}

/* ------------------------------------------------------------------ */
/* popup menus                                                        */
/* ------------------------------------------------------------------ */

function closeMenus() {
  document.querySelectorAll(".menu").forEach(m => m.remove());
  document.querySelectorAll("[data-menu-owner]").forEach(a => a.removeAttribute("data-menu-owner"));
}

document.addEventListener("click", e => {
  if (!e.target.closest(".menu") && !e.target.closest("[data-menu-owner]")) closeMenus();
});

function popMenu(anchor, items) {
  const wasOpen = anchor.hasAttribute("data-menu-owner");
  closeMenus();
  if (wasOpen) return;
  anchor.setAttribute("data-menu-owner", "1");

  const menu = document.createElement("div");
  menu.className = "menu";
  for (const it of items) {
    if (it.sep) { const d = document.createElement("div"); d.className = "sep"; menu.appendChild(d); continue; }
    if (it.lbl) { const d = document.createElement("div"); d.className = "lbl"; d.textContent = it.lbl; menu.appendChild(d); continue; }
    const b = document.createElement("button");
    b.textContent = it.text;
    b.addEventListener("click", () => { closeMenus(); it.fn(); });
    menu.appendChild(b);
  }

  let wrap = anchor.parentElement;
  if (!wrap.classList.contains("menuwrap")) {
    wrap = document.createElement("span");
    wrap.className = "menuwrap";
    anchor.parentElement.insertBefore(wrap, anchor);
    wrap.appendChild(anchor);
  }
  wrap.appendChild(menu);
}

/* ------------------------------------------------------------------ */
/* save model                                                         */
/* ------------------------------------------------------------------ */

/** Collect one root directory into a save descriptor. */
function readSave(dirEntry) {
  const path = "/" + dirEntry.name;
  const save = {
    name: dirEntry.name,
    path,
    mtime: dirEntry.mtimeText,
    files: [],
    bytes: 0,
    sys: null,
    titleLines: [dirEntry.name],
    iconNames: []
  };

  try {
    save.files = vmc.list(path).filter(f => !f.isDir);
    save.bytes = save.files.reduce((n, f) => n + f.size, 0);
  } catch (e) { /* unreadable directory: leave empty */ }

  const sysFile = save.files.find(f => f.name.toLowerCase() === "icon.sys");
  if (sysFile) {
    try {
      save.sys = PS2Icon.parseIconSys(vmc.readFile(path + "/" + sysFile.name));
      if (save.sys.titleLines.length) save.titleLines = save.sys.titleLines;
      save.iconNames = [save.sys.iconName, save.sys.copyIconName, save.sys.deleteIconName]
        .filter((v, i, a) => v && a.indexOf(v) === i);
    } catch (e) { /* malformed icon.sys */ }
  }
  return save;
}

/** Parse an icon file belonging to a save; null if missing or malformed. */
function loadIcon(save, iconName) {
  if (!iconName) return null;
  try {
    return PS2Icon.parseIco(vmc.readFile(save.path + "/" + iconName));
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* rendering                                                          */
/* ------------------------------------------------------------------ */

function drawThumb(canvas, texture) {
  const ctx = canvas.getContext("2d");
  canvas.width = 128; canvas.height = 128;
  ctx.putImageData(new ImageData(texture, 128, 128), 0, 0);
}

/** A button inside a save card: never opens the card's detail view. */
function mkSaveBtn(label, cls, fn) {
  const b = document.createElement("button");
  b.className = "tiny" + (cls ? " " + cls : "");
  b.textContent = label;
  b.addEventListener("click", e => { e.stopPropagation(); fn(); });
  return b;
}

function render() {
  const info = state.info;
  $("card-name").textContent = state.fileName;
  $("card-size").textContent = Math.round(info.cardSize / 1024 / 1024) + " MB";
  $("card-ecc").textContent = info.usesEcc ? "ECC" : "no ECC";
  $("st-page").textContent = info.pageSize;
  $("st-block").textContent = info.blockSize;

  let free = 0;
  try { free = vmc.freeSpace(); } catch (e) { /* unformatted */ }
  const total = info.cardSize;
  const used = Math.max(0, total - free);
  $("st-used").textContent = Math.round(used / 1024);
  $("st-free").textContent = Math.round(free / 1024);
  $("meter-fill").style.width = (100 * used / total).toFixed(1) + "%";

  let roots = [];
  try { roots = vmc.list("/").filter(e => e.isDir); } catch (e) { /* unformatted */ }
  $("st-saves").textContent = roots.length;

  const grid = $("grid");
  grid.innerHTML = "";

  for (const r of roots) {
    const save = readSave(r);
    const card = document.createElement("div");
    card.className = "save";
    card.title = "Open " + save.name + " to browse and edit its files";
    card.addEventListener("click", () => openSave(save));

    const icon = save.iconNames.length ? loadIcon(save, save.iconNames[0]) : null;
    if (icon && icon.texture) {
      const cv = document.createElement("canvas");
      cv.className = "thumb";
      card.appendChild(cv);
      drawThumb(cv, icon.texture);
    } else {
      const ph = document.createElement("div");
      ph.className = "noicon";
      ph.textContent = "?";
      card.appendChild(ph);
    }

    const body = document.createElement("div");
    body.className = "body";

    const title = document.createElement("div");
    title.className = "title";
    for (const line of save.titleLines.slice(0, 2)) {
      const s = document.createElement("span");
      s.textContent = line;
      s.title = line;
      title.appendChild(s);
    }
    body.appendChild(title);

    const dir = document.createElement("div");
    dir.className = "dir";
    dir.textContent = save.name;
    body.appendChild(dir);

    const meta = document.createElement("div");
    meta.className = "meta";
    const chips = [fmtSize(save.bytes), save.files.length + " files"];
    if (icon && icon.shapeCount > 1) chips.push("animated");
    if (save.mtime) chips.push(save.mtime.split(" ")[0]);
    for (const c of chips) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = c;
      meta.appendChild(b);
    }
    body.appendChild(meta);

    /* Whole-save actions, so the detail view is only needed for the files
     * inside a save. Clicks must not bubble up to the card's open handler. */
    const acts = document.createElement("div");
    acts.className = "acts";
    acts.appendChild(mkSaveBtn("Export .PSU", "", () => exportPsu(save)));
    acts.appendChild(mkSaveBtn("Delete", "danger", () => deleteSave(save)));
    body.appendChild(acts);

    card.appendChild(body);
    grid.appendChild(card);
  }

  $("grid-empty").style.display = roots.length ? "none" : "";
}

/* ------------------------------------------------------------------ */
/* save detail modal                                                  */
/* ------------------------------------------------------------------ */

function openSave(save) {
  state.current = save;

  $("m-title").textContent = save.titleLines.join(" — ") || save.name;
  $("m-size").textContent = fmtSize(save.bytes);
  $("modal").classList.add("on");

  renderFileList(save);
  renderIconBar(save);
  showIcon(save, save.iconNames[0]);
}

function renderFileList(save) {
  const tb = $("m-files");
  tb.innerHTML = "";

  for (const f of save.files) {
    const tr = document.createElement("tr");

    const nm = document.createElement("td");
    nm.className = "nm";
    nm.textContent = f.name;
    tr.appendChild(nm);

    const sz = document.createElement("td");
    sz.className = "sz";
    sz.textContent = fmtSize(f.size);
    tr.appendChild(sz);

    const ac = document.createElement("td");
    ac.className = "ac";

    const get = document.createElement("button");
    get.className = "tiny";
    get.textContent = "Save";
    get.addEventListener("click", () => {
      try {
        download(vmc.readFile(save.path + "/" + f.name), safeName(f.name, "file.bin"));
      } catch (e) { toast(e.message, "err"); }
    });
    ac.appendChild(get);

    const hex = document.createElement("button");
    hex.className = "tiny";
    hex.textContent = "Hex";
    hex.style.marginLeft = "6px";
    hex.addEventListener("click", () => openHexEditor(save, f));
    ac.appendChild(hex);

    const del = document.createElement("button");
    del.className = "tiny danger";
    del.textContent = "Delete";
    del.style.marginLeft = "6px";
    del.addEventListener("click", () => {
      if (!confirm("Delete " + f.name + " from " + save.name + "?")) return;
      try {
        vmc.remove(save.path + "/" + f.name);
        markDirty();
        refreshSave();
        toast("Deleted " + f.name);
      } catch (e) { toast(e.message, "err"); }
    });
    ac.appendChild(del);

    tr.appendChild(ac);
    tb.appendChild(tr);
  }

  if (!save.files.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.style.color = "var(--fg-faint)";
    td.textContent = "empty";
    tr.appendChild(td);
    tb.appendChild(tr);
  }
}

/**
 * Hex-edit one file on the card. Writing back keeps the same length, so the
 * file stays in the clusters it already occupies.
 */
function openHexEditor(save, fileEntry) {
  let bytes;
  try {
    bytes = vmc.readFile(save.path + "/" + fileEntry.name);
  } catch (e) {
    toast("Could not read " + fileEntry.name + " — " + e.message, "err");
    return;
  }

  HexEdit.open({
    title: fileEntry.name,
    subtitle: save.path + " · " + fmtSize(bytes.length),
    data: bytes,
    onSave: edited => {
      try {
        vmc.writeFile(save.path + "/" + fileEntry.name, edited);
      } catch (e) {
        toast("Could not write " + fileEntry.name + " — " + e.message, "err");
        return;
      }
      markDirty();
      refreshSave();
      toast("Saved " + fileEntry.name + " (" + fmtSize(edited.length) + ")", "ok");
    }
  });
}

function renderIconBar(save) {
  const bar = $("m-iconbar");
  bar.innerHTML = "";
  const labels = ["list", "copy", "delete"];

  save.iconNames.forEach((nm, i) => {
    const b = document.createElement("button");
    b.className = "tiny";
    b.textContent = labels[i] || nm;
    b.title = nm;
    b.addEventListener("click", () => {
      bar.querySelectorAll("button").forEach(x => x.classList.remove("primary"));
      b.classList.add("primary");
      showIcon(save, nm);
    });
    if (i === 0) b.classList.add("primary");
    bar.appendChild(b);
  });

  if (save.iconNames.length) {
    const png = document.createElement("button");
    png.className = "tiny";
    png.textContent = "texture .png";
    png.addEventListener("click", () => exportTexture(save));
    bar.appendChild(png);
  }
}

function showIcon(save, iconName) {
  const canvas = $("icon3d");
  const icon = loadIcon(save, iconName);

  if (!icon) {
    if (viewer) viewer.stop();
    const ctx2d = canvas.getContext("webgl") ? null : canvas.getContext("2d");
    if (ctx2d) { ctx2d.clearRect(0, 0, canvas.width, canvas.height); }
    $("m-hint").textContent = iconName ? "could not read " + iconName : "this save has no icon";
    return;
  }

  try {
    if (!viewer) viewer = PS2Icon3D.create(canvas);
    viewer.setIcon(icon, save.sys);
    viewer.start();
    const bits = ["drag to rotate", icon.vertexCount / 3 + " tris"];
    bits.push(icon.shapeCount > 1
      ? icon.shapeCount + " animation shapes (" + viewer.loopSeconds().toFixed(1) + "s loop)"
      : "static icon");
    if (!icon.texture) bits.push("no texture — vertex colours only");
    $("m-hint").textContent = bits.join(" · ");
  } catch (e) {
    $("m-hint").textContent = "3D preview unavailable: " + e.message;
  }
}

function exportTexture(save) {
  const icon = loadIcon(save, save.iconNames[0]);
  if (!icon || !icon.texture) { toast("no texture in this icon", "err"); return; }
  const cv = document.createElement("canvas");
  cv.width = 128; cv.height = 128;
  cv.getContext("2d").putImageData(new ImageData(icon.texture, 128, 128), 0, 0);
  cv.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeName(save.name, "icon") + ".png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("Exported icon texture", "ok");
  });
}

/** Re-read the open save after a mutation. */
function refreshSave() {
  if (!state.current) return;
  let entry;
  try {
    entry = vmc.stat(state.current.path);
  } catch (e) {
    closeModal();
    render();
    return;
  }
  const fresh = readSave({ name: state.current.name, mtimeText: entry.mtimeText, isDir: true });
  state.current = fresh;
  renderFileList(fresh);
  render();
}

function closeModal() {
  $("modal").classList.remove("on");
  if (viewer) viewer.stop();
  state.current = null;
}

/* ------------------------------------------------------------------ */
/* card open / close                                                  */
/* ------------------------------------------------------------------ */

async function loadCard(file) {
  let bytes;
  try {
    bytes = await readFileBytes(file);
  } catch (e) { toast(e.message, "err"); return; }

  if (bytes.length < 0x200000) {
    toast("That file is too small to be a PS2 memory card (" + fmtSize(bytes.length) + ")", "err");
    return;
  }

  try {
    state.info = vmc.openCard(bytes);
  } catch (e) {
    toast("Not a recognised PS2 memory card — " + e.message, "err");
    return;
  }

  state.fileName = file.name;
  state.dirty = false;
  $("card-dirty").style.display = "none";
  $("dropzone").style.display = "none";
  $("cardview").classList.add("on");
  render();
  toast("Opened " + file.name + " — " + Math.round(state.info.cardSize / 1024 / 1024) +
        " MB" + (state.info.usesEcc ? " with ECC" : ""), "ok");
}

function closeCard() {
  if (state.dirty && !confirm("This card has unsaved changes. Close anyway?")) return;
  state.dirty = false;
  state.info = null;
  $("card-dirty").style.display = "none";
  $("cardview").classList.remove("on");
  $("dropzone").style.display = "";
  closeModal();
}

/* ------------------------------------------------------------------ */
/* actions                                                            */
/* ------------------------------------------------------------------ */

async function importSaveFile(file) {
  let bytes;
  try {
    bytes = await readFileBytes(file);
  } catch (e) { toast(e.message, "err"); return; }

  const isPsv = bytes.length > 4 && bytes[0] === 0x00 && bytes[1] === 0x56 &&
                bytes[2] === 0x53 && bytes[3] === 0x50;
  try {
    if (isPsv) vmc.psvImport(bytes);
    else vmc.psuImport(bytes);
    markDirty();
    render();
    toast("Imported " + file.name + " (" + (isPsv ? "PSV" : "PSU") + ")", "ok");
  } catch (e) {
    toast("Could not import " + file.name + " — " + e.message, "err");
  }
}

/* Whole-save actions live only on the grid cards, so both are always called
 * with the save to act on. Anything else (such as a click Event from a stray
 * listener) is ignored rather than acted on. */
const isSave = arg => !!(arg && typeof arg === "object" && typeof arg.path === "string");

/** Export a save as .PSU. */
function exportPsu(save) {
  if (!isSave(save)) return;
  try {
    download(vmc.psuExport(save.path), safeName(save.name, "save") + ".psu");
  } catch (e) { toast(e.message, "err"); }
}

/** Erase a whole save, including any file inside it. */
function deleteSave(save) {
  if (!isSave(save)) return;
  if (!confirm("Delete the save \"" + (save.titleLines.join(" ") || save.name) + "\"?\n\n" +
               save.files.length + " file(s) will be erased from the card. " +
               "The file on disk is untouched until you download the card."))
    return;

  try {
    /* re-read the directory: the list captured at render time may be stale */
    let files;
    try { files = vmc.list(save.path).filter(f => !f.isDir); }
    catch (e) { files = save.files; }

    for (const f of files) vmc.remove(save.path + "/" + f.name);
    vmc.rmdir(save.path);
    markDirty();
    if (state.current && state.current.path === save.path) closeModal();
    render();
    toast("Deleted " + save.name);
  } catch (e) {
    toast("Could not delete: " + e.message, "err");
    render();
  }
}

async function injectFile(file) {
  const save = state.current;
  if (!save) return;
  try {
    const bytes = await readFileBytes(file);
    vmc.writeFile(save.path + "/" + file.name, bytes);
    markDirty();
    refreshSave();
    toast("Added " + file.name + " (" + fmtSize(bytes.length) + ")", "ok");
  } catch (e) {
    toast("Could not add " + file.name + " — " + e.message, "err");
  }
}

/* ------------------------------------------------------------------ */
/* wiring                                                             */
/* ------------------------------------------------------------------ */

function wire() {
  $("btn-open").addEventListener("click", () => $("file-card").click());
  $("file-card").addEventListener("change", e => {
    if (e.target.files[0]) loadCard(e.target.files[0]);
    e.target.value = "";
  });

  $("btn-close").addEventListener("click", closeCard);

  $("btn-import").addEventListener("click", () => $("file-save").click());
  $("file-save").addEventListener("change", e => {
    if (e.target.files[0]) importSaveFile(e.target.files[0]);
    e.target.value = "";
  });

  $("m-inject").addEventListener("click", () => $("file-inject").click());
  $("file-inject").addEventListener("change", e => {
    if (e.target.files[0]) injectFile(e.target.files[0]);
    e.target.value = "";
  });

  $("btn-download").addEventListener("click", e => {
    const base = baseName();
    popMenu(e.currentTarget, [
      { lbl: "Download card image" },
      {
        text: "Same layout as opened",
        fn: () => { download(vmc.cardBytes(), base + ".vmc"); state.dirty = false; $("card-dirty").style.display = "none"; }
      },
      { sep: true },
      { text: "Raw, ECC stripped (.bin)", fn: () => download(vmc.imageRaw(), base + "-raw.bin") },
      { text: "With ECC spare (.vmc)", fn: () => download(vmc.imageEcc(), base + "-ecc.vmc") }
    ]);
  });

  $("btn-mkdir").addEventListener("click", () => {
    const name = prompt("New folder name on the card (a save is one folder):");
    if (!name) return;
    try {
      vmc.mkdir("/" + name.replace(/^\/+/, ""));
      markDirty();
      render();
      toast("Created /" + name, "ok");
    } catch (e) { toast(e.message, "err"); }
  });

  $("btn-format").addEventListener("click", () => {
    if (!confirm("Format this memory card?\n\nEvery save will be erased. " +
                 "The file on disk is untouched until you download the card."))
      return;
    try {
      vmc.format();
      markDirty();
      closeModal();
      render();
      toast("Card formatted");
    } catch (e) { toast(e.message, "err"); }
  });

  $("m-close").addEventListener("click", closeModal);

  $("modal").addEventListener("click", e => { if (e.target === $("modal")) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

  /* drag and drop */
  const dz = $("dropzone");
  ["dragenter", "dragover"].forEach(ev => document.addEventListener(ev, e => {
    e.preventDefault();
    if (!state.info) dz.classList.add("over");
  }));
  ["dragleave", "drop"].forEach(ev => document.addEventListener(ev, e => {
    e.preventDefault();
    dz.classList.remove("over");
  }));
  document.addEventListener("drop", e => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    /* an open card + a small file means "import this save" */
    if (state.info && file.size < 0x200000) importSaveFile(file);
    else loadCard(file);
  });

  window.addEventListener("beforeunload", e => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */

PS2VMC.load().then(api => {
  vmc = api;
  $("boot").style.display = "none";
  $("dropzone").style.display = "";
  wire();
}).catch(e => {
  $("boot").textContent = "Could not start the memory card engine: " + e.message;
  $("boot").style.color = "var(--bad)";
});
