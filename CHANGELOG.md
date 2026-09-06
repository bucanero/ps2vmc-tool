# Changelog

## v2.0.0

The first release since `v1.1.2` (October 2024). Both command-line tools go to
2.0.0, and the repository gains browser versions of each of them.

### Web memory card managers (new)

Two single-page tools, published to GitHub Pages and also usable straight from
a checkout over `file://`:

- **[PS2 memory cards](https://bucanero.github.io/ps2vmc-tool/)**
- **[PS1 memory cards](https://bucanero.github.io/ps2vmc-tool/ps1/)**

Cards are read and written entirely in the page. Nothing is uploaded, no server
is involved, and the file on disk is untouched until you download the result.

The PS2 manager runs the tool's own `mcio.c` compiled to WebAssembly, so the
filesystem behaves exactly as the CLI does. The PS1 manager is a JavaScript port
of `ps1card.c`, checked against the CLI byte for byte.

Beyond what the CLIs offer, both pages add:

- animated 3D save icons on the PS2 card grid, with a drag-to-orbit viewer
- a hex editor for any file on the card
- *New blank card*, so you can start with no card file at all
- PS1 *Repair header* — rebuilds the block-0 signature and slot checksums
- PS1 `.mcx` support, with AES-128-CBC implemented in-page

### PS2VMC Tool

New commands:

| Command | |
| --- | --- |
| `--mc-create, -new` | write a new empty card to the given path |
| `--import, -imp` | import a save in PSU, PSV, CBS, MAX or XPS, detected from the file |
| `--psv-export, -psv` | export a signed PSV save for PS3 |
| `--xps-export, -xps` | export Xploder / SharkPort |
| `--cbs-export, -cbs` | export CodeBreaker |
| `--max-export, -max` | export Action Replay MAX |
| `--icons-png` | export a save's icon textures as PNG |
| `--3d-icons, -3d` | software-rendered 3D icons as PNG, matching the web viewer's framing |

Reading and writing the third-party containers is new in both directions: `.cbs`
(zlib under RC4), `.max` (LZARI) and `.xps` were previously not handled at all.

Container checksums are verified on import — the `.max` header CRC and the
`.xps` trailing checksum — so a damaged file is refused with *the file is
damaged, its checksum does not match* instead of importing a corrupt save.

The `.ico` parser that backs `--icons-png` and `--3d-icons` bounds every read
against the file's length, including the RLE texture decoder, so a malformed
icon cannot read past the end of the save.

**Deprecated.** `--import` replaces `--psu-import`/`-pu` and
`--psv-import`/`-pi`, and `--psu-export` now takes `-psu` rather than `-px`. All
four old spellings still work, so existing scripts are unaffected.

### PS1VMC Tool

New commands:

| Command | |
| --- | --- |
| `--mc-create, -new` | write a new formatted 128 KB card |
| `--mcx-image, -mcx` | export an encrypted PSP `.mcx` card image |
| `--delete, -del` | recoverable delete, the way the console does it |
| `--undelete, -undel` | restore a deleted save |

`--delete`/`--undelete` toggle the directory frame's deleted flag instead of
erasing the save, matching MemcardRex. `--remove` still erases.

### Fixes

- **`setPsvHeader()` out-of-bounds read** — copied `0x20` bytes out of the
  21-byte `saveName` field, leaking 11 bytes of adjacent struct memory into the
  filename field of every exported PS1 `.psv`.
- **PS1 slot numbers were not range-checked** ([#3](https://github.com/bucanero/ps2vmc-tool/issues/3))
  — a slot argument outside 0-14, or one that was not a number at all, indexed
  past the end of the slot array. Parsing now rejects both with a clear message.
- **PS1 raw save names were taken from the wrong part of the path**
  ([#3](https://github.com/bucanero/ps2vmc-tool/issues/3)) — the extension was
  matched after the name had been clamped to the header field's width, so a long
  filename kept a `.raw`/`.ps1` fragment in the save name. The extension is now
  matched against the whole base name, and the path separator is `\` as well as
  `/` only on Windows.
- Error messages go to `stderr` rather than `stdout`.
- Freed the buffer leaked by `--icons-png` on every icon it wrote.

### Build and CI

- **zlib is now required**, for the deflate stream inside `.cbs`. It is the
  same library the wasm build links through Emscripten's `USE_ZLIB`. Debian and
  Ubuntu need `zlib1g-dev`; macOS and the CI images already carry it.
- **Windows x64 and x86 are cross-compiled on Linux with mingw-w64**, replacing
  the MSYS2 jobs. zlib is linked statically, so neither `.exe` needs
  `zlib1.dll` alongside it — the workflow asserts that with `objdump`.
- The CLI smoke test runs in the Linux build, where its output is readable.
- A Pages workflow publishes the two web tools. It boots the assembled bundle
  under Node and reads a real memory card before deploying, so a missing file
  fails the deploy instead of reaching the browser.
