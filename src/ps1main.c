/*
 * PS1VMC Tool - PS1 Virtual Memory Card Tool by Bucanero
 *
 * based on MemcardRex - by ShendoXT
 * https://github.com/ShendoXT/memcardrex
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

#include "ps1card.h"
#include "util.h"
#include "svpng.h"

#define PROGRAM_NAME    "PS1VMC-TOOL"
#define PROGRAM_VER     "1.0.0"

#define PSV_MAGIC       0x50535600

enum ps1vmc_cmd {
	CMD_NONE = 0,
	CMD_MCINFO,
	CMD_MCFREE,
	CMD_RAW_IMG,
	CMD_GME_IMG,
	CMD_VGS_IMG,
	CMD_VMP_IMG,
	CMD_MCX_IMG,
	CMD_LIST,
	CMD_AR_EXPORT,
	CMD_MCS_EXPORT,
	CMD_RAW_EXPORT,
	CMD_PSV_EXPORT,
	CMD_ICONS,
	CMD_MCFORMAT,
	CMD_INJECT,
	CMD_REMOVE,
};


static void print_usage(int argc, char **argv)
{
	(void)argc;
	printf("Copyright (C) 2024 - by Bucanero\n");
	printf("based on MemcardRex by ShendoXT\n\n");
	printf("Usage:\n");
	printf("%s <VMC filepath> <command> [<arguments>]\n", argv[0]);
	printf("\n");
	printf("Available commands:\n");
	printf("\t --mc-info, -i\n");
	printf("\t --mc-free, -f\n");
	printf("\t --mc-format\n");
	printf("\t --list, -ls\n");
	printf("\t --remove, -rm <slot #>\n");
	printf("\t --icons <slot #>\n");
	printf("\t --raw-image, -raw <output filepath>\n");
	printf("\t --gme-image, -gme <output filepath>\n");
	printf("\t --vgs-image, -vgs <output filepath>\n");
	printf("\t --vmp-image, -vmp <output filepath>\n");
	printf("\t --inject-save, -in <.MCS/.PSV/.PSX/.RAW/.PS1 input filepath>\n");
	printf("\t --extract-save, -x <slot #> <RAW output filepath>\n");
	printf("\t --arx-export, -arx <slot #> <ActionReplay output filepath>\n");
	printf("\t --mcs-export, -mcs <slot #> <MCS output filepath>\n");
	printf("\t --psv-export, -psv <slot #>\n");
	printf("\n");
}

static int cmd_icons(const char* slot)
{
	uint8_t *icon;
	char filename[256];
	int id = strtol(slot, NULL, 10);
	ps1mcData_t *mcdata = getMemoryCardData();

	if (!mcdata)
		return -1;

	for (int i = 0; i < 3; i++)
	{
		icon = getIconRGBA(id, i);
		if (!icon)
			continue;

		snprintf(filename, sizeof(filename), "%s_icon%d.png", mcdata[id].saveProdCode, i);
		printf("Exporting '%s' icon %d: %s ...\n", mcdata[id].saveName, i, filename);

		FILE* fp = fopen(filename, "wb");
		svpng(fp, 16, 16, icon, 1);
		fclose(fp);
		free(icon);
	}

	return 0;
}

static int cmd_mcinfo(void)
{
	int free = 0, corrupt = 0, used = 0;
	ps1mcData_t *mcdata = getMemoryCardData();

	if (!mcdata)
		return -1;

	for (int i = 0; i < PS1CARD_MAX_SLOTS; i++)
	{
		switch (mcdata[i].saveType)
		{
		case PS1BLOCK_FORMATTED:
			free++;
			break;

		case PS1BLOCK_CORRUPTED:
			corrupt++;
			break;

		default:
			used++;
			break;
		}
	}

	printf("PS1 Memory Card Information\n");
	printf("Data slots: %d\n", PS1CARD_MAX_SLOTS);
	printf("Block size: %d bytes\n", PS1CARD_BLOCK_SIZE);
	printf("MC size   : %d KB\n", PS1CARD_SIZE / 1024);
	printf("Blocks    : Used %d | Free %d | Corrupt %d\n", used, free, corrupt);

	return 0;
}

static int cmd_mcfree(void)
{
	int cardfree = 0;
	ps1mcData_t *mcdata = getMemoryCardData();

	if (!mcdata)
		return -1;

	printf("PS1 Memory Card free space\n");
	printf("Calculating free space...\n");

	for (int i = 0; i < PS1CARD_MAX_SLOTS; i++)
		if (mcdata[i].saveType == PS1BLOCK_FORMATTED)
			cardfree++;

	printf("Available space: %d Blocks\n", cardfree);
	return 0;
}

static int cmd_mcimg(const char *output, int type)
{
	if (!saveMemoryCard(output, type, 0))
		return -1;

	printf("Exported PS1 memory card: %s\n", output);
	return 0;
}

static int cmd_mcformat(void)
{
	printf("PS1 Memory Card format\n");
	printf("Formating MC...\n");

	formatMemoryCard();

	printf("Memory card succesfully formated.\n");
	return 0;
}

static int cmd_list(void)
{
	ps1mcData_t* mcdata = getMemoryCardData();

	if (!mcdata)
		return -1;

	printf("Slot | ---------- Filename ----------- |  Type  |   Size   | Prod. Code | Region\n");
    for (int i = 0; i < PS1CARD_MAX_SLOTS; i++)
	{
		if (mcdata[i].saveType == PS1BLOCK_FORMATTED)
			continue;

		printf(" %2d  | %-32s| %s | ", i, mcdata[i].saveName, (mcdata[i].saveType == PS1BLOCK_INITIAL) ? "<save>" : "<link>");
		printf("%8d | ", mcdata[i].saveSize);
		printf("%-10s | %c%c", mcdata[i].saveProdCode, mcdata[i].saveRegion & 0xFF, mcdata[i].saveRegion >> 8);
		printf("\n");
	}

	return 0;
}

static int cmd_inject(const char *input)
{
	int r;

	if (!openSingleSave(input, &r))
		return r;

	printf("Save '%s' (%d blocks) imported to memory card.\n", input, r);
	return 0;
}

static int cmd_export(const char *slot, const char* filename, int type)
{
	int id = strtol(slot, NULL, 10);
	ps1mcData_t* mcdata = getMemoryCardData();

	if (!mcdata || mcdata[id].saveType != PS1BLOCK_INITIAL)
		return -1000;

	printf("Exporting save slot %d: '%s'...\n", id, mcdata[id].saveName);

	if (!saveSingleSave(filename, id, type))
		return -1001;

	printf("Save exported to: '%s'\n", filename);
	return 0;
}

static int cmd_psv_export(const char *slot)
{
	char tmp[4], filename[256];
	int id = strtol(slot, NULL, 10);
	ps1mcData_t* mcdata = getMemoryCardData();

	if (!mcdata || mcdata[id].saveType != PS1BLOCK_INITIAL)
		return -1000;

	printf("Exporting save slot %d: '%s'...\n", id, mcdata[id].saveName);

	snprintf(filename, sizeof(filename), "%c%c%s", mcdata[id].saveRegion & 0xFF, mcdata[id].saveRegion >> 8, mcdata[id].saveProdCode);
	for(int i = 0; mcdata[id].saveIdentifier[i]; i++)
	{
		snprintf(tmp, sizeof(tmp), "%02X", mcdata[id].saveIdentifier[i]);
		strcat(filename, tmp);
	}
	strcat(filename, ".PSV");

	if (!saveSingleSave(filename, id, PS1SAVE_PSV))
		return -1001;

	printf("Save exported to: '%s'\n", filename);
	return 0;
}

static int cmd_remove(const char *slot)
{
	int id = strtol(slot, NULL, 10);
	ps1mcData_t* mcdata = getMemoryCardData();

	if (!mcdata || mcdata[id].saveType != PS1BLOCK_INITIAL)
		return -1000;

	printf("Removing file: '%s'...\n", mcdata[id].saveName);
	formatSave(id);

	return 0;
}


int main(int argc, char **argv)
{
	int r, cmd = CMD_NONE;
	char **cmd_args = NULL;

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
		else if (!strcmp(argv[2], "--list") || !strcmp(argv[2], "-ls")) {
			cmd = CMD_LIST;
		}
		else if (!strcmp(argv[2], "--raw-image") || !strcmp(argv[2], "-raw")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_RAW_IMG;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--gme-image") || !strcmp(argv[2], "-gme")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_GME_IMG;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--vgs-image") || !strcmp(argv[2], "-vgs")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_VGS_IMG;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--vmp-image") || !strcmp(argv[2], "-vmp")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_VMP_IMG;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--mc-format")) {
			cmd = CMD_MCFORMAT;
		}
		else if (!strcmp(argv[2], "--extract-file") || !strcmp(argv[2], "-x")) {
			if (argc < 4) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_RAW_EXPORT;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--inject-file") || !strcmp(argv[2], "-in")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_INJECT;
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
		else if (!strcmp(argv[2], "--icons")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_ICONS;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--arx-export") || !strcmp(argv[2], "-arx")) {
			if (argc < 4) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_AR_EXPORT;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--mcs-export") || !strcmp(argv[2], "-mcs")) {
			if (argc < 4) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_MCS_EXPORT;
			cmd_args = &argv[3];
		}
		else if (!strcmp(argv[2], "--psv-export") || !strcmp(argv[2], "-psv")) {
			if (argc < 3) {
				print_usage(argc, argv);
				return 1;
			}
			cmd = CMD_PSV_EXPORT;
			cmd_args = &argv[3];
		}
		else {
			print_usage(argc, argv);
			return 1;
		}
	}

	r = openMemoryCard(argv[1], 0);

	if (!r) {
		fprintf(stderr, "Error: no PS1 Memory Card detected... (%s)\n", argv[1]);
	}
	else {
		if (cmd == CMD_MCINFO) {
			r = cmd_mcinfo();
			if (r < 0)
				fprintf(stderr, "Error: can't get MC infos... (%d)\n", r);
		}
		else if (cmd == CMD_MCFREE) {
			r = cmd_mcfree();
			if (r == 99999)
				fprintf(stderr, "Error: memory card is not formatted!\n");
			else if (r < 0)
				fprintf(stderr, "Error: can't get MC free space... (%d)\n", r);
		}
		else if (cmd == CMD_RAW_IMG || cmd == CMD_GME_IMG || cmd == CMD_VGS_IMG || cmd == CMD_VMP_IMG) {
			r = cmd_mcimg(cmd_args[0], cmd - 2);
			if (r < 0)
				fprintf(stderr, "Error: can't create image file... (%d)\n", r);
		}
		else if (cmd == CMD_PSV_EXPORT) {
			r = cmd_psv_export(cmd_args[0]);
			if (r < 0)
				fprintf(stderr, "Error: can't export save to PSV... (%d)\n", r);
		}
		else if (cmd == CMD_MCFORMAT) {
			r = cmd_mcformat();
			if (r < 0)
				fprintf(stderr, "Error: can't format MC... (%d)\n", r);
		}
		else if (cmd == CMD_LIST) {
			r = cmd_list();
			if (r == 99999)
				fprintf(stderr, "Error: memory card is not formatted!\n");
			else if (r == 99999)
				fprintf(stderr, "Error: path '%s' not found...\n", cmd_args[0]);
			else if (r < 0)
				fprintf(stderr, "Error: can't list directory '%s' (%d)\n", cmd_args[0], r);
		}
		else if (cmd == CMD_INJECT) {
			r = cmd_inject(cmd_args[0]);
			if (r == 99999)
				fprintf(stderr, "Error: memory card is not formatted!\n");
			else if (r != 0)
				fprintf(stderr, "Error: can't inject file '%s'... (%d)\n", cmd_args[0], r);
		}
		else if (cmd == CMD_ICONS) {
			r = cmd_icons(cmd_args[0]);
			if (r == 99999)
				fprintf(stderr, "Error: memory card is not formatted!\n");
			else if (r < 0)
				fprintf(stderr, "Error: can't remove file '%s'... (%d)\n", cmd_args[0], r);
		}
		else if (cmd == CMD_REMOVE) {
			r = cmd_remove(cmd_args[0]);
			if (r == 99999)
				fprintf(stderr, "Error: memory card is not formatted!\n");
			else if (r < 0)
				fprintf(stderr, "Error: can't remove file '%s'... (%d)\n", cmd_args[0], r);
		}
		else if (cmd == CMD_AR_EXPORT || cmd == CMD_MCS_EXPORT || cmd == CMD_RAW_EXPORT) {
			r = cmd_export(cmd_args[0], cmd_args[1], cmd - 8);
			if (r == 99999)
				fprintf(stderr, "Error: memory card is not formatted!\n");
			else if (r < 0)
				fprintf(stderr, "Error: can't export file '%s'... (%d)\n", cmd_args[0], r);
		}
	}

	/* save changes */
	if (cmd > CMD_ICONS && r == 0) {
		saveMemoryCard(argv[1], PS1CARD_NULL, 0);
		printf("VMC file saved: %s\n", argv[1]);
	}

	if (r < 0)
		return 1;

	return 0;
}
