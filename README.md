# PS2VMC Tool

[![Downloads](https://img.shields.io/github/downloads/bucanero/ps2vmc-tool/total.svg?maxAge=3600)](https://github.com/bucanero/ps2vmc-tool/releases)
[![License](https://img.shields.io/github/license/bucanero/ps2vmc-tool.svg?maxAge=2592000)](https://github.com/bucanero/ps2vmc-tool/blob/main/LICENSE)
[![macOS Linux binaries](https://github.com/bucanero/ps2vmc-tool/actions/workflows/build.yml/badge.svg)](https://github.com/bucanero/ps2vmc-tool/actions/workflows/build.yml)
[![Windows binaries](https://github.com/bucanero/ps2vmc-tool/actions/workflows/build-win.yml/badge.svg)](https://github.com/bucanero/ps2vmc-tool/actions/workflows/build-win.yml)
[![Web tools](https://github.com/bucanero/ps2vmc-tool/actions/workflows/pages.yml/badge.svg)](https://github.com/bucanero/ps2vmc-tool/actions/workflows/pages.yml)
[![Twitter](https://img.shields.io/twitter/follow/dparrino?label=Follow)](https://twitter.com/dparrino)

PS2VMC Tool is a command-line application for managing PS2 virtual memory cards directly from the PC.

Both memory card tools also run in the browser, with nothing to install and nothing uploaded &mdash; the card is read and written locally, and never leaves your machine:

- **[PS2 Memory Card Manager](https://bucanero.github.io/ps2vmc-tool/)**
- **[PS1 Memory Card Manager](https://bucanero.github.io/ps2vmc-tool/ps1/)**

For Sega Dreamcast VMU memory cards, see [DCVMU Tool](https://github.com/bucanero/dcvmu-tool).

## Usage

```
PS2VMC-TOOL v2.0.0
Copyright (C) 2023-2026 - by Bucanero
based on ps3mca-tool by jimmikaelkael et al.

Usage:
./ps2vmc-tool <VMC filepath> <command> [<arguments>]

Available commands:
	 --mc-info, -i
	 --mc-free, -f
	 --mc-image, -img <output filepath>
	 --ecc-image, -ecc <output filepath>
	 --mc-format
	 --mc-create, -new  (write a new empty card to <VMC filepath>)
	 --list, -ls <mc path>
	 --icons-png <mc path>
	 --3d-icons, -3d <mc path>  (software-rendered 3D icons)
	 --extract-file, -x <mc filepath> <output filepath>
	 --inject-file, -in <input filepath> <mc filepath>
	 --make-directory, -mkdir <mc path>
	 --remove-directory, -rmdir <mc path>
	 --remove, -rm <mc filepath>
	 --file-crosslink, -cl <real mc filepath> <dummy mc filepath>
	 --import, -imp <save filepath>  (PSU, PSV, CBS, MAX or XPS)
	 --psu-export, -psu <mc path> <output filepath>
	 --psv-export, -psv <mc path> <output filepath>
	 --xps-export, -xps <mc path> <output filepath>
	 --cbs-export, -cbs <mc path> <output filepath>
	 --max-export, -max <mc path> <output filepath>
```

## Mounting a card

`ps2vmc-fuse` mounts a PS2 card image as a folder, so saves can be browsed,
copied, renamed and deleted with Finder, `cp` or any other program:

```
./ps2vmc-fuse card.vmc ~/ps2card -o backend=fskit
./ps2vmc-fuse card.vmc ~/ps2card -o backend=fskit --write
```

Mounts are read-only unless `--write` (`-w`) is given. A read-only mount reads
the image once and never writes it back, so nothing done through it can change
the card file. With `--write`, changes are saved to the card file when a
written file is closed, after each folder or attribute change, and on unmount.
Each save writes a complete new image beside the old one and renames it over,
so the file is never left half-written. Unmount with `umount ~/ps2card` on
macOS or `fusermount3 -u ~/ps2card` on Linux.

A few things follow from the card format:

- Names are limited to 31 characters, and are case-sensitive.
- Renaming works within a folder. Moving between folders is refused with
  `EXDEV`, so `mv` copies and deletes instead.
- macOS bookkeeping files (`._*`, `.DS_Store`, `.Trashes` and the like) are
  refused, so they do not fill the card.
- Only the read and write permission bits map onto the card. File owners and
  extended attributes are not stored.
- A folder never shrinks: deleting entries frees their space, but the slots
  stay in the folder, as on a PS2.

It is built separately, see [Building the source code](#building-the-source-code).

On macOS it needs [macFUSE](https://macfuse.github.io/) 5 or later. With
`-o backend=fskit` it runs as a user-space FSKit extension, which must first be
turned on under System Settings → General → Login Items & Extensions → File
System Extensions. If the macFUSE toggle there will not switch on, set the
list's view to "By Category" and try again. Without that option macFUSE uses
its kernel extension, which needs separate approval and a reboot.

An app that macOS has not given access to removable or network volumes gets
"Operation not permitted" when listing the mount, even though the mount itself
works. Grant it under Privacy & Security → Files & Folders.

---

# PS1VMC Tool

PS1VMC Tool is a command-line application for managing PS1 virtual memory cards directly from the PC.

## Usage

```
PS1VMC-TOOL v2.0.0
Copyright (C) 2024-2026 - by Bucanero
based on MemcardRex by ShendoXT

Usage:
./ps1vmc-tool <VMC filepath> <command> [<arguments>]

Available commands:
	 --mc-info, -i
	 --mc-free, -f
	 --mc-format
	 --mc-create, -new  (write a new empty card to <MC filepath>)
	 --list, -ls
	 --remove, -rm <slot #>
	 --delete, -del <slot #>  (recoverable, as the console does)
	 --undelete, -undel <slot #>
	 --icons <slot #>
	 --raw-image, -raw <output filepath>
	 --gme-image, -gme <output filepath>
	 --vgs-image, -vgs <output filepath>
	 --vmp-image, -vmp <output filepath>
	 --mcx-image, -mcx <output filepath>
	 --inject-save, -in <.MCS/.PSV/.PSX/.RAW/.PS1 input filepath>
	 --extract-save, -x <slot #> <RAW output filepath>
	 --arx-export, -arx <slot #> <ActionReplay output filepath>
	 --mcs-export, -mcs <slot #> <MCS output filepath>
	 --psv-export, -psv <slot #>
```

### Extracting PS1 saves: prefer .MCS

`--mcs-export` is the one to use. An `.mcs` is the save's 128-byte directory
frame followed by its data, so the name, product code, region and identifier
travel *with* the file. `.psv` and the Action Replay format carry their headers
too.

`--extract-save` writes the data blocks and nothing else. A raw save has no
header, so importing one has to rebuild it, and the only thing left to rebuild
it from is the file name — the importer copies 20 characters of the name into
the directory frame, which is exactly the region, product code and identifier.
That works while the file still carries the 20-character name it was extracted
under, and stops working the moment anyone renames it.

So raw is only for the cases that need bare blocks, not for keeping saves.

## Building the source code

```
make
```

This builds both tools. `make ps1` and `make ps2` build just one. The two
programs are independent and link only what they use — the PS1 tool contains
no PS2 filesystem code, and the PS2 tool contains no PS1 card code — sharing
only `util.c`, `aes.c` and the signing files.

The one external dependency is **zlib**. Both tools use it to write their PNGs,
and the PS2 tool also needs it for CodeBreaker `.cbs` bodies, which are deflate
streams read on import and written on export. It comes with the SDK on macOS,
with `zlib1g-dev` on Debian and Ubuntu, and as `mingw-w64-<arch>-zlib` under
MSYS2. The Windows binaries are not built under MSYS2 though: both are
cross-compiled on Linux with mingw-w64, where `libz-mingw-w64-dev` covers the
32- and 64-bit targets alike. To force the static archive, as those builds do so
the released `.exe` needs no `zlib1.dll`:

```
make ZLIB=-l:libz.a
```

The FUSE mount is not part of `make`, since it needs libfuse3 as well. Build it
with:

```
make fuse
```

This needs `pkg-config` and libfuse3: macFUSE on macOS, `libfuse3-dev` on
Debian and Ubuntu. `make fuse-test` exercises the filesystem without mounting
anything, on scratch copies of `samples/ps2card.vmc`: a scripted pass over
every operation, then random operations checked against an in-memory model.

### Save signing

`.psv` saves and `.vmp` memory card images carry an HMAC-SHA1 signature, and
`.mcx` images a SHA-256 digest; without them a PS3, PSP or Vita rejects the
file. These are produced by `src/psv_resign.c`, based on ps3-psvresigner and
MCR2VMP by [@dots_tb](https://github.com/dots-tb).

The signature itself is plain HMAC-SHA1 (`src/hmac.c`, RFC 2104) keyed by the
derived salt: the salt is 0x40 bytes, exactly one SHA-1 block, so no key
normalisation applies. The original code spelled the pads out by hand — 0x36,
then xor 0x6A to reach the 0x5C outer pad — which obscured that.

## Credits

- PS1VMC Tool - Based on [MemcardRex](https://github.com/ShendoXT/memcardrex) by [ShendoXT](https://github.com/ShendoXT)
- PS2VMC Tool - Based on ps3mca-tool by [jimmikaelkael](https://github.com/jimmikaelkael)

```
 * ps3mca-tool - PlayStation 3 Memory Card Adaptor Software
 * Copyright (C) 2011 - jimmikaelkael <jimmikaelkael@wanadoo.fr>
 * Copyright (C) 2011 - "someone who wants to stay anonymous"
```

## License

This software is licensed under GNU GPLv3, please review the [LICENSE](https://github.com/bucanero/ps2vmc-tool/blob/main/LICENSE)
file for further details. No warranty provided.
