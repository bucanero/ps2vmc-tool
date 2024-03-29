# PS2VMC Tool

This project aim to create a PC command line tool to manage their PS2 virtual memory cards directly from the PC.

## Usage

```
PS2VMC-TOOL v1.1.0
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
	 --psu-export, -px <mc path> <output filepath>
```

## Building the source code

```
make
```

## Credits

Based on ps3mca-tool by [jimmikaelkael](https://github.com/jimmikaelkael)

```
 * ps3mca-tool - PlayStation 3 Memory Card Adaptor Software
 * Copyright (C) 2011 - jimmikaelkael <jimmikaelkael@wanadoo.fr>
 * Copyright (C) 2011 - "someone who wants to stay anonymous"
```

## License

This software is licensed under GNU GPLv3, please review the [LICENSE](https://github.com/bucanero/ps2vmc-tool/blob/main/LICENSE)
file for further details. No warranty provided.
