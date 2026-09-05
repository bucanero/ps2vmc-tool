# PS2VMC Tool

[![Downloads](https://img.shields.io/github/downloads/bucanero/ps2vmc-tool/total.svg?maxAge=3600)](https://github.com/bucanero/ps2vmc-tool/releases)
[![License](https://img.shields.io/github/license/bucanero/ps2vmc-tool.svg?maxAge=2592000)](https://github.com/bucanero/ps2vmc-tool/blob/main/LICENSE)
[![macOS Linux binaries](https://github.com/bucanero/ps2vmc-tool/actions/workflows/build.yml/badge.svg)](https://github.com/bucanero/ps2vmc-tool/actions/workflows/build.yml)
[![Windows binaries](https://github.com/bucanero/ps2vmc-tool/actions/workflows/build-win.yml/badge.svg)](https://github.com/bucanero/ps2vmc-tool/actions/workflows/build-win.yml)
[![Twitter](https://img.shields.io/twitter/follow/dparrino?label=Follow)](https://twitter.com/dparrino)

PS2VMC Tool is a command-line application for managing PS2 virtual memory cards directly from the PC.

## Usage

```
PS2VMC-TOOL v1.3.0
Copyright (C) 2023 - by Bucanero
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
```

---

# PS1VMC Tool

PS1VMC Tool is a command-line application for managing PS1 virtual memory cards directly from the PC.

## Usage

```
PS1VMC-TOOL v1.1.0
Copyright (C) 2024 - by Bucanero
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

## Building the source code

```
make
```

This builds both tools. `make ps1` and `make ps2` build just one. The two
programs are independent and link only what they use — the PS1 tool contains
no PS2 filesystem code, and the PS2 tool contains no PS1 card code — sharing
only `util.c`, `aes.c` and the signing files.

The one external dependency is **zlib**, and only the PS2 tool needs it: a
CodeBreaker `.cbs` body is a deflate stream, read on import and written on
export. It comes with the SDK on macOS, with `zlib1g-dev` on Debian and Ubuntu,
and as `mingw-w64-<arch>-zlib` under MSYS2. The Windows binaries are not built
under MSYS2 though: both are cross-compiled on Linux with mingw-w64, where
`libz-mingw-w64-dev` covers the 32- and 64-bit targets alike. To force the
static archive, as those builds do so the released `.exe` needs no `zlib1.dll`:

```
make PS2_LIBS=-l:libz.a
```

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
