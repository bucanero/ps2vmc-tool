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
backend, just ten static files, all of them plain text.

## What it does

| CLI command | Web equivalent |
| --- | --- |
| `--mc-info`, `--mc-free` | Card header and the usage meter |
| `--list` | The save grid; per-save file list in the detail view |
| `--extract-file` | *Save* next to any file |
| `--inject-file` | *Add file…* in the detail view |
| `--remove`, `--remove-directory` | *Delete* on a save card or on a single file inside it |
| `--make-directory` | *New folder* |
| `--psu-export` | *Export ▾ → PSU* on a save card |
| `--psv-export` | *Export ▾ → PSV* — a signed PS3 save |
| `--import` | *Import save…* — PSU, PSV, CBS, MAX or XPS, detected from the file |
| `--xps-export` | *Export ▾ → XPS* on a save card |
| `--mc-image` | *Download card ▾ → Raw, ECC stripped* |
| `--ecc-image` | *Download card ▾ → With ECC spare* |
| `--mc-format` | *Format card* |
| `--icons-png` | *texture .png* in the icon bar |
| *(not in the CLI)* | 3D icon on every save card, animated on hover |
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
cryptoutil.js     AES-128, SHA-1, SHA-256, HMAC-SHA1, shared by all of the below
psv.js            PSV and VMP signing, PSV construction (shared with PS1)
icon3d.js         WebGL icon renderer, animation logic, grid thumbnails
hexedit.js        the hex editor modal (shared with the PS1 page)
ps2vmc-wasm.js         generated: emscripten glue (~13 KB)
ps2vmc-wasm-binary.js  generated: the compiled module, base64 (~65 KB)
src/web_api.c          the C bridge: mcio wrappers, PSU/PSV, image dumps
build.sh               rebuilds both generated files
test/                  differential tests against the native CLI
```

### What runs in the wasm, and what runs in JavaScript

One rule decides where a piece of work lives: **anything that touches the mcio
filesystem is C compiled to wasm; container layout and crypto stay in
JavaScript.**

That is why PSV *import* is a wasm entry point (`vmc_psv_import`) while PSV
*export* is `psv.js`. Importing has to walk the FAT and allocate clusters, so it
has to be mcio. Exporting only reads file data mcio has already handed back,
then lays out a header and signs it — no card filesystem involved.

Keeping the second half in JavaScript is what stops the crypto multiplying. The
PS1 page has no wasm at all, so `cryptoutil.js` and `psv.js` have to exist as
JavaScript whatever this page does; routing PS2 signing through the wasm would
add a third implementation rather than remove the second, and would mean
refactoring `psv_resign()` and `cmd_psv_export()` off `FILE *` first, since the
module is built with `-s FILESYSTEM=0`. What keeps the C and the JS honest
instead is `test/psv.js`, which runs the real `--psv-export` and asserts the
CLI's bytes and ours match exactly, signature included.

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
needed after changing `src/mcio.c`, `src/util.c`, `src/ps2save.c` or
`web-ps2/src/web_api.c`:

```bash
brew install emscripten     # or apt install emscripten
./web-ps2/build.sh
```

## Tests

All four suites need the native tools built first (`make`):

```bash
node web-ps2/test/difftest.js    # wasm vs CLI, 92 checks
node web-ps2/test/icontest.js    # icon parsing and animation, 25 checks
node web-ps2/test/hexedit.js     # hex editing on both cards, 38 checks
node web-ps2/test/psv.js         # crypto, PSV/VMP/MCX signing, CLI options, 103 checks
node web-ps2/test/savefmt.js     # .cbs/.max/.xps readers and the XPS writer, 37 checks
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
uncompressed and RLE encodings), checks the animation logic on all 60 animated
icons, and confirms every save's primary icon has geometry the grid can draw.

## PSV export

*Export ▾* on a save card offers `.PSU` and `.PSV`. A PSV carries a 20-byte
SHA-1 signature at `0x1C` keyed by a salt derived from the seed at `0x08`; the
algorithm comes from
[psv-save-converter](https://github.com/bucanero/psv-save-converter). The CLI
grew a matching `--psv-export`, and the two produce byte-identical files.

File modes are read with `stat()` rather than taken from the directory
listing, because mcio's readdir rebuilds mode from a subset of the flags and
drops the `Exists`/`Closed` bits a PSV expects. The CLI's PSU exporter re-stats
for the same reason.

Output is byte-identical to psv-save-converter across the sample cards, with
one deliberate exception: for a save whose `icon.sys` is not exactly 964 bytes,
the reference reads only `sizeof(ps2_IconSys_t)` of it, desynchronises its own
PSU stream and writes a nonsensical `displaySize`. One sample save (976-byte
`icon.sys`) hits this; we write the true total instead.

The PS1 side of `psv.js` carries its own note: a PS1 PSV stores the save size
twice, at `0x40` and `0x5C`, and both have to be right or multi-block saves are
truncated on console. See `web-ps1/README.md`.

## Third-party save containers

*Import save…* also accepts the three container formats cheat devices wrote
saves in, alongside `.psu` and `.psv`:

| | |
| --- | --- |
| `.cbs` | CodeBreaker — zlib deflate under an RC4 keystream |
| `.max` | Action Replay MAX — LZARI |
| `.xps` | Xploder / SharkPort — uncompressed |

All three hold the same thing, a save directory and its files, so `src/ps2save.c`
turns each into one structure and a single writer puts it on the card. That file
is compiled into both the CLI and the wasm, so the two cannot drift; `.psu` and
`.psv` keep their existing importers untouched.

The format is decided by looking at the data, never at the file extension, so
neither the CLI nor the page needs to be told what a file is: `--import` and
*Import save…* both hand the bytes to the same `ps2save_detect()`. The CLI's
older `--psu-import` and `--psv-import` still work and now accept any of the
five, but they are no longer advertised.

Two things worth knowing:

- **The readers are stricter than the reference.** Every field is bounds-checked
  before it is read, because these files come from the internet. The reference
  reads two variable-length XPS header blocks into a 100-byte stack buffer
  without checking their length; here they are skipped rather than read.
- **`.max` carries no timestamps.** The container has none, and the reference
  takes them from the file on disk — which a browser upload does not have. Those
  saves are stamped with the current time, the way the card stamps a fresh save.
  `.cbs` and `.xps` keep the timestamps stored in the container.

`.max` is the subtle one, in two ways.

`unlzari()` stops when its input runs out and reports how many bytes it wrote,
so a truncated file decompresses "successfully" into a short buffer. Entries are
bounded by what actually came out rather than by the size the header claims, and
the buffer is `calloc`ed so a short stream reads as zeros instead of stale heap.

And the header's `compressedSize` cannot be trusted either — it under-reports.
`samples/BASLUS-20963FF1200.max` claims 17529 for a stream that is really 17533
bytes, so feeding the decoder only what the header allows starves it: it returns
168 bytes short and the last file in the save is cut off. Everything after the
header goes to the decoder instead, which is safe because the stream carries its
own length in its first word.

The reference converter reads that save with the same 168-byte shortfall and
gets away with it: the bytes it never wrote come from a fresh `malloc` of 92 KB,
which the allocator serves as zero pages, and the tail of that particular
`icon.sys` happens to be zeros (its last non-zero byte is at offset 397 of 964).
Our output for all three sample containers is byte-identical to the reference's,
this file included.

### Writing .xps

*Export ▾* offers `.XPS` alongside `.PSU` and `.PSV`. Only that one container is
written: `.cbs` would need a deflate compressor, which the decompress-only miniz
here does not provide, and `.max` is not worth writing — its header under-reports
both of its sizes, so a file we produced would be as awkward to read back as the
ones in the wild.

The two description strings a `.xps` carries are free-form: one real sample holds
its authoring tool's name, another holds the save's title. Ours get the two title
lines from `icon.sys`, converted from Shift-JIS to the 7-bit ASCII those fields
use — full-width letters, digits and punctuation map exactly, kana and kanji
become `?`, and the untouched Shift-JIS original goes in the entry's own field
next to it.

Exporting the save that `samples/myth-makers-super-kart-gp.22840.xps` came from
reproduces that file's directory mode, size word, per-file modes and all four
files byte for byte. The two description strings differ, and account exactly for
the 8-byte difference in total size.

### The closing checksum

A `.xps` ends with a four-byte checksum over its body — the directory entry
through the last byte of file data:

```c
sum = 0;  for each byte b:  sum += b << (sum % 24);
```

Each byte is shifted by the running sum's own remainder, so it depends on order
as well as content. It matches no standard checksum, which is why guessing it
failed; it came out of the divide-by-24 loop at `0x4093c1` in
`PS2SaveConverter.exe`. The three `.xps` files in `samples/` were written by
three different tools and all three verify, so this is the format's checksum
rather than one writer's habit.

### Three description strings, not two

The same disassembly corrected the header. After the magic come **three**
length-prefixed strings — the third is the writer's signature — and then the
size word. Reading only two and skipping eight bytes appears to work whenever
that third string is empty, and it is empty in most files.

The reference converter makes exactly that assumption, so it cannot read
`PS2SaveConverter.exe`'s own output: the signature there is `Made using file
converter by ffgriever`, and the reference walks into the middle of it, ending
up with a save named `sing file co6E766572746572206279…`. Ours reads all three,
and `samples/ps2saveconverter.xps` is in the suite to keep it that way.

### The .max header CRC

Also recovered while in there, though nothing here depends on it: the `.max`
header CRC at offset 12 is a plain CRC32 (poly `0xEDB88320`, init and final xor
`0xFFFFFFFF`) over the whole file with that field zeroed. Verified against
`samples/BASLUS-20963FF1200.max`, whose stored `0xEA258A15` matches exactly. It
is the missing piece if a `.max` writer is ever added.

### Tests

`test/savefmt.js` imports every `.cbs`/`.max`/`.xps` in `samples/` twice, once
through the wasm and once through `./ps2vmc-tool`, and compares the resulting
files byte for byte. Drop a real save into `samples/` and it is picked up with
no change to the test. It also exports every save on the sample card as `.xps`,
checks the wasm and the CLI emit identical bytes, and reads each one back to
confirm the files survive the round trip.

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

### One context for the whole grid

Each save card shows its real model, not the flat 128×128 texture — which is
the unwrapped skin, and looks nothing like the icon the console draws. Tiles
get the save's own `icon.sys` background gradient as well, so a card in the
grid looks like the same card in the detail view. Pass a colour as the second
argument to `createThumbnailer()` to clear to a flat background instead.

A canvas per card will not work: `getContext("webgl")` per tile means one live
context per save, and browsers cap how many exist at once (Chrome force-loses
the oldest past roughly 16), so most of a well-filled card would go blank. The
sample `card32mb.bin` has 133 saves. Instead `createThumbnailer()` keeps a
single offscreen context, renders each icon into it and copies the result out
with `drawImage`, leaving the cards holding cheap 2D canvases.

The cost is close to nothing, because the grid already parsed each icon in full
just to reach its texture: building the 133-save grid takes 98 ms with 3D tiles
against 94 ms with flat ones. 43,164 triangles across the whole card is a
rounding error for a GPU.

Two WebGL details matter when one context draws many images. The colour buffer
is cleared explicitly every frame rather than trusting the gradient quad to
cover it, and the model's vertex attribute arrays are disabled before their
buffers are deleted for the next icon — leaving them dangling makes the very
next draw invalid, and Firefox drops it, which silently cost every tile but the
first its background.

Tiles are stills, and animate only while the pointer is over the card. That is
what keeps the memory flat: holding every parsed icon on that card at once is
about 16 MB of vertex data, so the geometry is dropped after the still frame
and re-read on hover, leaving only the one being looked at resident. Hovering
starts after 120 ms, so sweeping the pointer across the grid uploads nothing,
and leaving restores the still frame. Static icons rotate on hover too.

Some icons carry no texture at all (7 of 246 here): the file ends right after
the animation block and the model is drawn from vertex colours alone. The
parser reports those as textureless, and the renderer falls back to a plain
white texture so the vertex colours show through. Drawing the grid in 3D means
these appear there too — the flat-texture grid had nothing to show for them and
fell back to a `?` placeholder.

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
