# PS1 Memory Card Manager (web)

A single-page, browser-based version of `ps1vmc-tool`. It opens PlayStation 1 virtual
memory cards, lists and previews the saves, imports/exports individual saves, and writes
the card back out in any of the supported container formats.

Everything happens locally in the page — no server, no upload, no build step, no
dependencies. The whole app is one self-contained `index.html`.

## Running it

**Option 1 — just open the file**

Double-click `web-ps1/index.html`, or drag it onto a browser window. That's it.

**Option 2 — serve it locally** (needed only if your browser restricts `file://` pages)

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/web-ps1/index.html>.

To share it with others, drop `index.html` on any static host (GitHub Pages, Netlify,
an S3 bucket) — there is no backend to deploy.

## What it does

| CLI command | Web equivalent |
| --- | --- |
| `--mc-info`, `--mc-free` | Block counters shown at the top of an open card |
| `--list` | The save grid + the 15-block strip |
| `--icons <slot>` | *Export ▾ → Icon frames (.png)* — one 16×16 PNG per frame |
| `--extract-save`, `--mcs-export`, `--arx-export`, `--psv-export` | *Export ▾* on any save |
| *(improves on the CLI)* | `.psv` exports are signed, and carry a correct `dataSize` |
| `--inject-save` | *Import save…*, or drop a save file onto an open card |
| `--mc-create` | *New blank card* — a formatted 128 KB card |
| `--remove` | *Remove* on a save |
| `--mc-format` | *Format card* |
| `--raw-image`, `--gme-image`, `--vgs-image`, `--vmp-image` | *Download card ▾* |
| `--mcx-image` | *Download card ▾ → .mcx* |
| *(not in the CLI)* | *Delete / Undelete* — toggles the deleted flag instead of erasing |
| *(not in the CLI)* | *Repair header* — rebuilds the block-0 signature and slot checksums |
| *(not in the CLI)* | *Hex* — edit the save's raw bytes in place |

### Card formats read and written

`RAW`/`.mcr`/`.mcd`/`.bin`/`.srm` · `.gme` (DexDrive) · `.vgs` (VGS/Connectix) ·
`.vmp` (PSP) · `.mcx` (encrypted — AES-128-CBC is implemented in-page)

### Save formats read and written

`.mcs` · `.psv` (PS3/Vita) · raw `.ps1`/`.psx`/`.raw` (`SC` magic) · Action Replay / GameShark

Save titles are decoded from Shift-JIS and normalised the same way MemcardRex does, and
icons are rendered from the save's 16-colour palette and animated when a save has more
than one frame.

## Hex editor

*Hex* on any save opens a byte editor over that save's data — the same bytes
`--extract-save` would write out, which is the whole run of 8 KB blocks, not
just the first one. Click a byte, type two hex digits and it commits and moves
to the next one; Enter commits, Escape cancels, Tab commits and advances.
Changed bytes stay highlighted until you press *Save changes*.

Either column is editable. The hex side takes two digits per byte; the ASCII
side takes characters, so plain text can simply be typed — or pasted, filling
consecutive bytes — without converting anything by hand. A character that
needs more than one byte (CJK, emoji) is dropped rather than mangled, since one
cell is one byte, and a run is clamped at the end of the file so a paste can
never change its length.

Edits are written straight back into the blocks the save already occupies, so
the length is fixed and the block chain never moves. Everything derived from
the data is recomputed afterwards, so editing the title bytes updates the title
in the grid and editing the icon bytes updates the icon.

The editor is shared with the PS2 page. Because this page is deliberately one
self-contained file, the module is inlined here rather than loaded as a script;
`node web-ps2/test/hexedit.js` fails if the copy drifts from
`web-ps2/hexedit.js`.

## Signing

A PS3 `.psv` carries a 20-byte SHA-1 signature at offset `0x1C`, keyed by a
salt derived from the seed at `0x08`. The signature is plain HMAC-SHA1 keyed by
that salt — it is exactly one SHA-1 block, so RFC 2104 needs no key
normalisation. `ps1vmc-tool`'s `--psv-export` never filled it in, so its files
were rejected as corrupt. Both this page and the CLI now sign them,
using the algorithm from
[psv-save-converter](https://github.com/bucanero/psv-save-converter): the seed
is run through AES-128 (ECB for PS1, CBC for PS2) to derive a 0x40-byte key,
which is then used in an HMAC-SHA1 over the whole file with the signature field
zeroed.

The header stores the save size **twice**, and both copies matter: `0x40` is
the size the PS3 shows on the XMB, and `0x5C` is the length it actually copies
onto the virtual memory card. `ps1vmc-tool` hardcoded `0x5C` to 8192, so any
save longer than one block was truncated and would not load on console. Fixed
in `src/ps1card.c`; see
[memcardrex#54](https://github.com/ShendoXT/memcardrex/pull/54), where the same
bug was found and fixed in MemcardRex.

Output is byte-identical to psv-save-converter for every save on the sample
cards, and `node web-ps2/test/psv.js` also compares it against the CLI's own
`--psv-export` byte for byte outside the signature field, on single and
multi-block saves alike.

### VMP and MCX card images

`.vmp` (PSP/Vita) images carry the *same* signature a PSV does, just at
different offsets — seed at `0x0C`, signature at `0x20`, always the PS1 key
derivation, over the whole 0x20080-byte image. `.mcx` images instead hold a
SHA-256 of everything before `0x20080`, written at `0x20080`, after which the
whole image is AES-CBC encrypted.

`ps1vmc-tool` used to write neither: its `.vmp` left the signature field zeroed
and its `.mcx` filled the digest with `0xFF`. Both are now signed, in the page
and in the CLI, following
[apollo-ps4](https://github.com/bucanero/apollo-ps4/blob/main/source/psv_resign.c).
The two produce byte-identical files, which the test suite checks.

### Where the code lives

`web-ps2/cryptoutil.js` holds the AES-128 (ECB and CBC, both directions),
SHA-1, SHA-256 and HMAC-SHA1 used by everything above — one implementation rather than a
copy per page. `web-ps2/psv.js` builds on it for the PSV and VMP signatures;
MCX signing sits with the MCX writer in the card code.

Both modules are inlined into this page, the same arrangement as the hex
editor, and `node web-ps2/test/psv.js` fails if any inlined copy drifts from
its source.

## Notes

- Editing a card only changes the copy held in the page. Nothing is written until you
  use **Download card** — the file on disk is never touched.
- The tab warns before closing if the open card has unsaved changes.
- The port was verified against the C tool: `.mcs`, `.psv`, raw and Action Replay exports
  are all byte-identical, icon pixels match `--icons` output exactly, and every container
  format written here re-opens cleanly in `ps1vmc-tool`.
- Writing this port turned up an out-of-bounds read in the CLI's `.psv` export:
  `setPsvHeader()` copied 0x20 bytes out of the 21-byte `saveName` field, leaking 11 bytes
  of adjacent struct memory into the header's filename field. Fixed in `src/ps1card.c`.

## Credits

Ported from [ps1vmc-tool](https://github.com/bucanero/ps2vmc-tool) by Bucanero, itself
based on [MemcardRex](https://github.com/ShendoXT/memcardrex) by ShendoXT. GPLv3, same as
the rest of this repository.
