# PS1 Memory Card Manager (web)

A single-page, browser-based version of `ps1vmc-tool`. It opens PlayStation 1 virtual
memory cards, lists and previews the saves, imports/exports individual saves, and writes
the card back out in any of the supported container formats.

Everything happens locally in the page — no server, no upload, no build step, no
dependencies. The whole app is one self-contained `index.html`.

## Running it

**Option 1 — just open the file**

Double-click `web/index.html`, or drag it onto a browser window. That's it.

**Option 2 — serve it locally** (needed only if your browser restricts `file://` pages)

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/web/index.html>.

To share it with others, drop `index.html` on any static host (GitHub Pages, Netlify,
an S3 bucket) — there is no backend to deploy.

## What it does

| CLI command | Web equivalent |
| --- | --- |
| `--mc-info`, `--mc-free` | Block counters shown at the top of an open card |
| `--list` | The save grid + the 15-block strip |
| `--icons <slot>` | *Export ▾ → Icon frames (.png)* — one 16×16 PNG per frame |
| `--extract-save`, `--mcs-export`, `--arx-export`, `--psv-export` | *Export ▾* on any save |
| `--inject-save` | *Import save…*, or drop a save file onto an open card |
| `--remove` | *Remove* on a save |
| `--mc-format` | *Format card* |
| `--raw-image`, `--gme-image`, `--vgs-image`, `--vmp-image` | *Download card ▾* |
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
