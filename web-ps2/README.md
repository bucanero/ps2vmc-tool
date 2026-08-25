# PS2 Memory Card Manager (web)

A browser front end for `ps2vmc-tool`. It opens PS2 virtual memory card images,
browses the filesystem inside them, imports and exports saves, and renders each
save's **real animated 3D icon**.

Unlike the PS1 page next door, the filesystem here is not a re-implementation:
`src/mcio.c` is compiled to WebAssembly and driven directly, so the page and the
command line tool run the same code and produce byte-identical results.

## Running it

Open `web-ps2/index.html` in a browser. It works straight from a `file://` URL,
with no server — the WebAssembly module is embedded as base64, so nothing is
fetched at run time.

Serving it over HTTP works just as well, and is handy if you want to keep the
sample cards next to it:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/web-ps2/>. Any static host works — there is no
backend, just eight static files, all of them plain text.

## What it does

| CLI command | Web equivalent |
| --- | --- |
| `--mc-info`, `--mc-free` | Card header and the usage meter |
| `--list` | The save grid; per-save file list in the detail view |
| `--extract-file` | *Save* next to any file |
| `--inject-file` | *Add file…* in the detail view |
| `--remove`, `--remove-directory` | *Delete* on a save card or on a single file inside it |
| `--make-directory` | *New folder* |
| `--psu-export` | *Export .PSU* on a save card |
| `--psu-import`, `--psv-import` | *Import save…* (the format is detected from the file) |
| `--mc-image` | *Download card ▾ → Raw, ECC stripped* |
| `--ecc-image` | *Download card ▾ → With ECC spare* |
| `--mc-format` | *Format card* |
| `--icons-png` | *texture .png* in the icon bar |
| *(not in the CLI)* | Animated 3D icon viewer, drag to orbit |
| *(not in the CLI)* | *Hex* — edit any file on the card byte by byte |

Whole-save actions live only on the grid: each save card carries its own
*Export .PSU* and *Delete*. Clicking the card opens the save itself, which is
where the 3D icon and the per-file actions are — saving, hex editing or
deleting an individual file, and adding a new one. Keeping the two levels
separate means a *Delete* button always refers to the thing you are looking at.

Card images are read with or without ECC spare bytes, at any size the tool
supports (8 MB and up). Editing only changes the copy in the page; the file on
disk is untouched until you use **Download card**.

## Layout

```
index.html        markup and styles
app.js            UI logic
ps2vmc.js         JS API over the wasm module (strings, Uint8Arrays, objects)
ps2icon.js        .ico and icon.sys parsers
icon3d.js         WebGL icon renderer + animation logic
hexedit.js        the hex editor modal (shared with the PS1 page)
ps2vmc-wasm.js         generated: emscripten glue (~13 KB)
ps2vmc-wasm-binary.js  generated: the compiled module, base64 (~65 KB)
src/web_api.c          the C bridge: mcio wrappers, PSU/PSV, image dumps
build.sh               rebuilds both generated files
test/                  differential tests against the native CLI
```

### Why the module is base64 and not a .wasm file

Two properties are worth having at once: every shipped file should be plain
text, and the page should run from `file://` without a server.

- Emscripten's `SINGLE_FILE` gets the second but not the first. It does **not**
  base64-encode; it writes the module's raw bytes into a JS string literal,
  leaving thousands of NUL and high bytes inside a `.js` file that cannot
  safely be opened or edited in a text editor.
- Shipping a separate `.wasm` gets the first but not the second: loading it
  needs a `fetch`, which browsers refuse on `file://` URLs, so the page only
  works over HTTP.

So `build.sh` compiles to a real `.wasm`, base64-encodes it into
`ps2vmc-wasm-binary.js`, and hands the bytes to emscripten through
`Module.wasmBinary` (which needs `-s INCOMING_MODULE_JS_API=wasmBinary`,
because `-s STRICT=1` otherwise drops it). Nothing is fetched, and every file
stays ASCII.

## Rebuilding the WebAssembly module

`ps2vmc-wasm.js` and `ps2vmc-wasm-binary.js` are checked in, so this is only
needed after changing `src/mcio.c`, `src/util.c` or `web-ps2/src/web_api.c`:

```bash
brew install emscripten     # or apt install emscripten
./web-ps2/build.sh
```

## Tests

Both suites need the native tool built first (`make`):

```bash
node web-ps2/test/difftest.js    # wasm vs CLI, 92 checks
node web-ps2/test/icontest.js    # icon parsing and animation, 20 checks
node web-ps2/test/hexedit.js     # hex editing on both cards, 38 checks
```

`difftest.js` runs each operation twice — once through the wasm module, once
through `./ps2vmc-tool` — and compares the resulting card images byte for byte
across four sample cards (8/16/32 MB, with and without ECC). It covers card
info, free space, listings, file extraction, raw and ECC image dumps, PSU
export, `mkdir`, file injection, file removal, formatting, and PSU re-import.

Because `mcio_getmcrtime()` stamps directory entries with wall-clock `time()`,
two runs of the same mutation legitimately differ if they straddle a second
boundary. The comparison classifies each differing byte and only excuses those
inside an `MCFsEntry` created/modified field or an ECC spare area; a difference
anywhere else still fails.

`icontest.js` parses all 246 icons on the sample cards, verifies the texture
decoder against the CLI's own `--icons-png` output byte for byte (both the
uncompressed and RLE encodings), and checks the animation logic on all 60
animated icons.

## Hex editor

*Hex* next to any file in a save opens a byte editor on it. Click a byte, type
two hex digits and it commits and moves to the next one; Enter commits, Escape
cancels, Tab commits and advances. Changed bytes stay highlighted until you
press *Save changes*.

Either column is editable. The hex side takes two digits per byte; the ASCII
side takes characters, so plain text can simply be typed — or pasted, filling
consecutive bytes — without converting anything by hand. A character that
needs more than one byte (CJK, emoji) is dropped rather than mangled, since one
cell is one byte, and a run is clamped at the end of the file so a paste can
never change its length.

Saving writes the file back at the same length, so it stays in the clusters it
already occupies and no space is consumed. `test/hexedit.js` checks that the
resulting card image is byte-identical to doing the same edit with the CLI's
`--inject-file`.

Files are paged 4 KB at a time with prev/next and an offset jump, rather than
truncated at a fixed cap — PS2 save files run to hundreds of KB and the whole
file needs to be reachable. The bytes are all held in memory regardless; paging
only limits how much is drawn at once.

The same module backs the PS1 page, which inlines a copy because it ships as a
single file. `test/hexedit.js` fails if the two drift apart.

## Notes on the 3D icons

PS2 save icons are textured 3D models, not images: a vertex list with several
*animation shapes* (morph targets), a keyframed animation track, a 128×128
texture, and lighting defined in `icon.sys` (three directional lights plus an
ambient term, and a four-corner background gradient). All of that is used here.

Two things are worth knowing:

- **Vertex alpha is ignored.** Roughly a third of real save icons (52 of the 175
  on the sample cards) store 0 in the vertex colour alpha channel and are still
  drawn solid on console, so treating it as transparency would make them
  invisible.
- **Animation timing is an interpretation.** The format notes mark
  `frame_length` and `anim_speed` as unknown. Measured across the samples,
  `frame_length` behaves like the loop length in 60 Hz display frames, so the
  loop runs for `frame_length / (60 × anim_speed)` seconds, clamped to
  0.3–10 s. Shapes are interpolated linearly.

Some icons carry no texture at all (7 of 246 here): the file ends right after
the animation block and the model is drawn from vertex colours alone. The
parser reports those as textureless, and the renderer falls back to a plain
white texture so the vertex colours show through.

## Two bugs this work turned up in the C tool

1. **`setPsvHeader()` out-of-bounds read** — copied `0x20` bytes out of the
   21-byte `saveName` field, leaking 11 bytes of adjacent struct memory into
   every exported `.psv`. Fixed in `src/ps1card.c`.
2. **`ps2IconTexture()` out-of-bounds reads** — the parser walked the header,
   vertex block, animation block and texture with no reference to the file's
   length, and the RLE decoder could also run past the end of its own 64 KB
   output buffer. AddressSanitizer reported a heap-buffer-overflow on 8 of the
   175 saves on the sample cards. Fixed in `src/ps2icon.c`: every read is now
   bounded, and `getIconPS2()` passes the number of bytes it actually read.

Both were found by writing this port, and both are fixed in the repository.

## Credits

Filesystem: `mcio.c` from ps3mca-tool by jimmikaelkael et al., as shipped in
[ps2vmc-tool](https://github.com/bucanero/ps2vmc-tool) by Bucanero.
Icon format reference: <https://ghulbus-inc.de/projects/ps2iconsys/>.
GPLv3, same as the rest of the repository.
