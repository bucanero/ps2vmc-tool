# PS2VMC Tool

[![Downloads](https://img.shields.io/github/downloads/bucanero/ps2vmc-tool/total.svg?maxAge=3600)](https://github.com/bucanero/ps2vmc-tool/releases)
[![License](https://img.shields.io/github/license/bucanero/ps2vmc-tool.svg?maxAge=2592000)](https://github.com/bucanero/ps2vmc-tool/blob/main/LICENSE)
[![macOS Linux binaries](https://github.com/bucanero/ps2vmc-tool/actions/workflows/build.yml/badge.svg)](https://github.com/bucanero/ps2vmc-tool/actions/workflows/build.yml)
[![Windows binaries](https://github.com/bucanero/ps2vmc-tool/actions/workflows/build-win.yml/badge.svg)](https://github.com/bucanero/ps2vmc-tool/actions/workflows/build-win.yml)
[![Twitter](https://img.shields.io/twitter/follow/dparrino?label=Follow)](https://twitter.com/dparrino)

PS2VMC Tool is a command-line application for managing PS2 virtual memory cards directly from the PC.

## Usage

```
PS2VMC-TOOL v1.1.2
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
	 --list, -ls <mc path>
	 --extract-file, -x <mc filepath> <output filepath>
	 --inject-file, -in <input filepath> <mc filepath>
	 --make-directory, -mkdir <mc path>
	 --remove-directory, -rmdir <mc path>
	 --remove, -rm <mc filepath>
	 --file-crosslink, -cl <real mc filepath> <dummy mc filepath>
	 --psv-import, -pi <PSV filepath>
	 --psu-import, -pu <PSU filepath>
	 --psu-export, -px <mc path> <output filepath>
```

---

# PS1VMC Tool

PS1VMC Tool is a command-line application for managing PS1 virtual memory cards directly from the PC.

## Usage

```
PS1VMC-TOOL v1.0.0
Copyright (C) 2024 - by Bucanero
based on MemcardRex by ShendoXT

Usage:
./ps1vmc-tool <VMC filepath> <command> [<arguments>]

Available commands:
	 --mc-info, -i
	 --mc-free, -f
	 --mc-format
	 --list, -ls
	 --remove, -rm <slot #>
	 --icons <slot #>
	 --raw-image, -raw <output filepath>
	 --gme-image, -gme <output filepath>
	 --vgs-image, -vgs <output filepath>
	 --vmp-image, -vmp <output filepath>
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
