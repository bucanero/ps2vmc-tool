/*
 * PS2VMC Tool - PS2 Virtual Memory Card Tool by Bucanero
 *
 * based on
 * ps3mca-tool - PlayStation 3 Memory Card Adaptor Software
 * Copyright (C) 2011 - jimmikaelkael <jimmikaelkael@wanadoo.fr>
 * Copyright (C) 2011 - "someone who wants to stay anonymous"
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <memory.h>
#include <inttypes.h>

#include "mcio.h"
#include "util.h"

#define PROGRAM_NAME    "PS2VMC-TOOL"
#define PROGRAM_VER     "1.0.0"

#define CMD_NONE	0
#define CMD_MCINFO	1
#define CMD_MCFREE	2
#define CMD_MCIMG	3
#define CMD_LIST	4
#define CMD_EXTRACT	5
#define CMD_MCUNFORMAT	6
#define CMD_MCFORMAT	7
#define CMD_INJECT	8
#define CMD_MKDIR	9
#define CMD_RMDIR	10
#define CMD_REMOVE	11
#define CMD_CROSSLINK	12
#define CMD_MCCK	13
#define CMD_MCKELF	14


static void print_usage(int argc, char **argv)
{
	(void)argc;
	printf("Copyright (C) 2023 - by Bucanero\n");
	printf("based on ps3mca-tool by jimmikaelkael et al.\n\n");
	printf("Usage:\n");
	printf("%s <VMC.file> <command> [<arguments>]\n", argv[0]);
	printf("\n");
	printf("Available commands:\n");
	printf("\t --mc-info, -i\n");
	printf("\t --mc-free, -f\n");
	printf("\t --mc-image, -img <output filepath>\n");
	printf("\t --mc-unformat\n");
	printf("\t --mc-format\n");
	printf("\t --list, -ls <mc path>\n");
	printf("\t --extract-file, -x <mc filepath> <output filepath>\n");
	printf("\t --inject-file, -in <input filepath> <mc filepath>\n");
	printf("\t --make-directory, -mkdir <mc path>\n");
	printf("\t --remove-directory, -rmdir <mc path>\n");
	printf("\t --remove, -rm <mc filepath>\n");
	printf("\t --file-crosslink, -cl <real mc filepath> <dummy mc filepath>\n");
	printf("\n");
}

static int cmd_mcinfo(void)
{
	int r;
	int pagesize, blocksize, cardsize, cardflags;

	r = mcio_mcGetInfo(&pagesize, &blocksize, &cardsize, &cardflags);
	if (r < 0)
		return r;

	printf("PS2 Memory Card Information\n");
	printf("Page size:  %d bytes\n", pagesize);
	printf("Block size: %d pages\n", blocksize);
	printf("MC size:    %d MB\n", cardsize / 1024 / 1024);
	if (cardflags & 1)
		printf("MC claims to support ECC\n");
	if (cardflags & 8)
		printf("MC claims to support bad blocks management\n");
	printf("erase byte: 0x%02X\n", (cardflags & 16) ? 0x00 : 0xff);

	return 0;
}

static int cmd_mcfree(void)
{
	int r;
	int cardfree;

	printf("PS2 Memory Card free space\n");
	printf("Calculating free space...\n");

	r = mcio_mcGetAvailableSpace(&cardfree);
	if (r < 0)
		return r;

	printf("Available space: %d KB\n", cardfree / 1024);

	return 0;
}

static int cmd_mcimg(char *output)
{
	int r, i;
	int pagesize, blocksize, cardsize, cardflags;

	r = mcio_mcGetInfo(&pagesize, &blocksize, &cardsize, &cardflags);
	if (r < 0)
		return -1;

	FILE *fh = fopen(output, "wb");
	if (fh == NULL)
		return -2;

	void *buf = malloc(pagesize);
	if (buf == NULL) {
		fclose(fh);
		return -3;
	}

	for (i = 0; i < (cardsize / pagesize); i++) {
		mcio_mcReadPage(i, buf);
		r = fwrite(buf, 1, pagesize, fh);
		if (r != pagesize) {
			free(buf);
			fclose(fh);
			return -4;
		}
	}

	fclose(fh);
	free(buf);

	printf("Exported raw memory card: %s\n", output);

	return 0;
}

static int cmd_mcunformat(void)
{
	int r;

	printf("PS2 Memory Card unformat\n");
	printf("Unformating MC...\n");

	r = mcio_mcUnformat();
	if (r < 0)
		return r;

	printf("Memory card succesfully unformated.\n");

	return 0;
}

static int cmd_mcformat(void)
{
	int r;

	printf("PS2 Memory Card format\n");
	printf("Formating MC...\n");

	r = mcio_mcFormat();
	if (r < 0)
		return r;

	printf("Memory card succesfully formated.\n");

	return 0;
}

static int cmd_list(char *path)
{
	int r, fd;

	fd = mcio_mcDopen(path);
	if (fd >= 0) {
		struct io_dirent dirent;
		printf("---------- Filename ----------  |  Type  |   Size   | Last Modification (UTC)\n");
		do {
			r = mcio_mcDread(fd, &dirent);
			if ((r)) { /* && (strcmp(dirent.name, ".")) && (strcmp(dirent.name, ".."))) { */
				int tabnum = (32/7) - (strlen(dirent.name) / 7);
				printf("%s ", dirent.name);
				int i;
				for (i=0; i<tabnum; i++)
					printf("\t");
				if (!(dirent.stat.mode & sceMcFileAttrSubdir))
					printf("| <file> | ");
				else
					printf("| <dir>  | ");
				printf("%8d | ", dirent.stat.size);
				printf("%02d/%02d/%04d-", dirent.stat.mtime.Month, dirent.stat.mtime.Day, dirent.stat.mtime.Year);
				printf("%02d:%02d:%02d", dirent.stat.mtime.Hour, dirent.stat.mtime.Min, dirent.stat.mtime.Sec);
				printf("\n");
			}
		} while (r);

		mcio_mcDclose(fd);
	}

	return fd;
}

static int cmd_extract(char *filepath, char *output)
{
	int fd, r;

	printf("Reading file: '%s'...\n", filepath);

	fd = mcio_mcOpen(filepath, sceMcFileAttrReadable | sceMcFileAttrFile);
	if (fd < 0)
		return fd;

	int filesize = mcio_mcSeek(fd, 0, SEEK_END);
	mcio_mcSeek(fd, 0, SEEK_SET);
	uint8_t *p = malloc(filesize);
	if (p == NULL)
		return -1000;

	r = mcio_mcRead(fd, p, filesize);
	if (r != filesize) {
		mcio_mcClose(fd);
		free(p);
		return -1001;
	}

	mcio_mcClose(fd);

	FILE *fh = fopen(output, "wb");
	if (fh == NULL) {
		free(p);
		return -1002;
	}

	printf("Writing data to: '%s'...\n", output);

	r = fwrite(p, 1, filesize, fh);
	if (r != filesize) {
		fclose(fh);
		free(p);
		return -1003;
	}

	fclose(fh);

	free(p);

	return fd;
}

static int cmd_inject(char *input, char *filepath)
{
	int fd, r;

	FILE *fh = fopen(input, "rb");
	if (fh == NULL)
		return -1000;

	fseek(fh, 0, SEEK_END);
	int filesize = ftell(fh);
	if (!filesize) {
		fclose(fh);
		return -1001;
	}
	fseek(fh, 0, SEEK_SET);

	printf("Reading file: '%s'...\n", input);

	uint8_t *p = malloc(filesize);
	if (p == NULL) {
		return -1002;
	}

	r = fread(p, 1, filesize, fh);
	if (r != filesize) {
		fclose(fh);
		free(p);
		return -1003;
	}

	fclose(fh);

	printf("Writing data to: '%s'...\n", filepath);

	fd = mcio_mcOpen(filepath, sceMcFileCreateFile | sceMcFileAttrWriteable | sceMcFileAttrFile);
	if (fd < 0) {
		free(p);
		return fd;
	}

	r = mcio_mcWrite(fd, p, filesize);
	if (r != filesize) {
		mcio_mcClose(fd);
		free(p);
		return -1004;
	}

	mcio_mcClose(fd);

	free(p);

	return fd;
}

static int cmd_mkdir(char *path)
{
	printf("Creating directory: '%s'...\n", path);
	return mcio_mcMkDir(path);
}

static int cmd_rmdir(char *path)
{
	printf("Removing directory: '%s'...\n", path);
	return mcio_mcRmDir(path);
}

static int cmd_remove(char *path)
{
	printf("Removing file: '%s'...\n", path);
	return mcio_mcRemove(path);
}

static int cmd_crosslink(char *real_filepath, char *dummy_filepath)
{
	printf("Cross-linking file: '%s' to '%s'...\n", dummy_filepath, real_filepath);
	mcio_mcCreateCrossLinkedFile(real_filepath, dummy_filepath);
	return 0;
}


int main(int argc, char **argv)
{
	int r, cmd = CMD_NONE;
	char **cmd_args = NULL;
	uint8_t *data = NULL;
	size_t dsize;

	printf(PROGRAM_NAME " v" PROGRAM_VER "\n");


	if (argc-- < 3) {
		print_usage(argc, argv);
		return 1;
	}
	else {
		if (!strcmp(argv[2], "--mc-info") || !strcmp(argv[2], "-i")) {
			cmd = CMD_MCINFO;
		}
		else if (!strcmp(argv[2], "--mc-free") || !strcmp(argv[2], "-f")) {
			cmd = CMD_MCFREE;
		}
		else if (!strcmp(argv[2], "--mc-image") || !strcmp(argv[2], "-img")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_MCIMG;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--mc-unformat")) {
			cmd = CMD_MCUNFORMAT;
		}
		else if (!strcmp(argv[2], "--mc-format")) {
			cmd = CMD_MCFORMAT;
		}
		else if (!strcmp(argv[2], "--list") || !strcmp(argv[2], "-ls")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_LIST;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--extract-file") || !strcmp(argv[2], "-x")) {
			if (argc < 4) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_EXTRACT;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--inject-file") || !strcmp(argv[2], "-in")) {
			if (argc < 4) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_INJECT;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--make-directory") || !strcmp(argv[2], "-mkdir")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_MKDIR;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--remove-directory") || !strcmp(argv[2], "-rmdir")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_RMDIR;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--remove") || !strcmp(argv[2], "-rm")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_REMOVE;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--file-crosslink") || !strcmp(argv[2], "-cl")) {
			if (argc < 4) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_CROSSLINK;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--content-key") || !strcmp(argv[2], "-ck")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_MCCK;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--sign-kelf") || !strcmp(argv[2], "-k")) {
			if (argc < 4) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_MCKELF;
			cmd_args = &argv[3];
		}
		else {
			print_usage(argc, argv);
			return 1;
		}
	}

	if (read_buffer(argv[1], &data, &dsize) < 0) {
		printf("Error: failed to open VMC file... (%s)\n", argv[1]);
		return 1;
	}

	r = mcio_init(data);
	/*if (r == sceMcResNoFormat)
		printf("Error: memory card not formated...\n");*/
	if ((r != sceMcResNoFormat) && (r < 0)) {
		printf("Error: no PS2 Memory Card detected... (%d)\n", r);
	}
	else {
		if (cmd == CMD_MCINFO) {
			r = cmd_mcinfo();
			if (r < 0)
				printf("Error: can't get MC infos... (%d)\n", r);
		}
		else if (cmd == CMD_MCFREE) {
			r = cmd_mcfree();
			if (r == sceMcResNoFormat)
				printf("Error: memory card is not formatted!\n");
			else if (r < 0)
				printf("Error: can't get MC free space... (%d)\n", r);
		}
		else if (cmd == CMD_MCIMG) {
			r = cmd_mcimg(cmd_args[0]);
			if (r < 0)
				printf("Error: can't create image file... (%d)\n", r);
		}
		else if (cmd == CMD_MCUNFORMAT) {
			r = cmd_mcunformat();
			if (r < 0)
				printf("Error: can't unformat MC... (%d)\n", r);
		}
		else if (cmd == CMD_MCFORMAT) {
			r = cmd_mcformat();
			if (r < 0)
				printf("Error: can't format MC... (%d)\n", r);
		}
		else if (cmd == CMD_LIST) {
			r = cmd_list(cmd_args[0]);
			if (r == sceMcResNoFormat)
				printf("Error: memory card is not formatted!\n");
			else if (r == sceMcResNoEntry)
				printf("Error: path '%s' not found...\n", cmd_args[0]);
			else if (r == sceMcResNotDir)
				printf("Error: path '%s' is not a directory...\n", cmd_args[0]);
			else if (r < 0)
				printf("Error: can't list directory '%s' (%d)\n", cmd_args[0], r);
		}
		else if (cmd == CMD_EXTRACT) {
			r = cmd_extract(cmd_args[0], cmd_args[1]);
			if (r == sceMcResNoFormat)
				printf("Error: memory card is not formatted!\n");
			else if (r == sceMcResNotFile)
				printf("Error: '%s' is not a file...\n", cmd_args[0]);
			else if (r < 0)
				printf("Error: can't extract file '%s'... (%d)\n", cmd_args[0], r);
		}
		else if (cmd == CMD_INJECT) {
			r = cmd_inject(cmd_args[0], cmd_args[1]);
			if (r == sceMcResNoFormat)
				printf("Error: memory card is not formatted!\n");
			else if (r < 0)
				printf("Error: can't inject file '%s'... (%d)\n", cmd_args[0], r);
		}
		else if (cmd == CMD_MKDIR) {
			r = cmd_mkdir(cmd_args[0]);
			if (r == sceMcResNoFormat)
				printf("Error: memory card is not formatted!\n");
			else if (r < 0)
				printf("Error: can't create directory '%s'... (%d)\n", cmd_args[0], r);
		}
		else if (cmd == CMD_RMDIR) {
			r = cmd_rmdir(cmd_args[0]);
			if (r == sceMcResNoFormat)
				printf("Error: memory card is not formatted!\n");
			else if (r < 0)
				printf("Error: can't remove directory '%s'... (%d)\n", cmd_args[0], r);
		}
		else if (cmd == CMD_REMOVE) {
			r = cmd_remove(cmd_args[0]);
			if (r == sceMcResNoFormat)
				printf("Error: memory card is not formatted!\n");
			else if (r < 0)
				printf("Error: can't remove file '%s'... (%d)\n", cmd_args[0], r);
		}
		else if (cmd == CMD_CROSSLINK) {
			r = cmd_crosslink(cmd_args[0], cmd_args[1]);
			if (r < 0)
				printf("Error: can't crosslink file '%s'... (%d)\n", cmd_args[0], r);
		}
	}

	/* save changes */
	if (cmd > CMD_EXTRACT && r == sceMcResSucceed) {
		write_buffer(argv[1], data, dsize);
		printf("VMC file saved: %s\n", argv[1]);
	}
	free(data);

	if (r < 0)
		return 1;

	return 0;
}
