/*
 * ps2blank.c - build an empty PS2 memory card image
 *
 * See include/ps2blank.h for why a card is built rather than formatted.
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
 */

#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "ps2blank.h"
#include "mcio.h"
#include "util.h"

#define PAGE_SIZE          512
#define CLUSTER_SIZE       1024
#define PAGES_PER_CLUSTER  2
#define PAGES_PER_BLOCK    16
#define CLUSTERS_PER_BLOCK (PAGES_PER_BLOCK / PAGES_PER_CLUSTER)

#define CLUSTERS           (PS2BLANK_SIZE / CLUSTER_SIZE)          /* 8192 */
#define BLOCKS             (CLUSTERS / CLUSTERS_PER_BLOCK)         /* 1024 */

/* The first indirect-FAT cluster, then the FAT, then the allocatable area.
 * These match what mcio's own format lays down on an 8 MB card. */
#define IFC0               16
#define FAT_CLUSTERS       ((CLUSTERS * 4) / CLUSTER_SIZE)         /* 32 */
#define ALLOC_OFFSET       (IFC0 + 1 + FAT_CLUSTERS)               /* 49 */
#define ALLOC_END          (CLUSTERS - ALLOC_OFFSET - 2 * CLUSTERS_PER_BLOCK)

#define FAT_FREE           0x7FFFFFFF   /* unallocated */
#define FAT_END            0xFFFFFFFF   /* allocated, end of chain */

/* Directory attributes, as mcio writes them for "." and "..". */
#define DIR_SELF           0x8427
#define DIR_PARENT         0xA426

static const char BLANK_MAGIC[]   = "Sony PS2 Memory Card Format ";
static const char BLANK_VERSION[] = "1.2.0.0";

static void put_now(uint8_t *p)
{
	time_t t = time(NULL);
	struct tm *tm = gmtime(&t);

	memset(p, 0, 8);
	if (!tm)
		return;

	p[1] = (uint8_t)tm->tm_sec;
	p[2] = (uint8_t)tm->tm_min;
	p[3] = (uint8_t)tm->tm_hour;
	p[4] = (uint8_t)tm->tm_mday;
	p[5] = (uint8_t)(tm->tm_mon + 1);
	append_le_uint16(&p[6], (uint16_t)(tm->tm_year + 1900));
}

/* One 512-byte directory entry. */
static void put_dirent(uint8_t *p, uint16_t mode, uint32_t length, const char *name)
{
	memset(p, 0, PAGE_SIZE);

	append_le_uint16(&p[0], mode);
	append_le_uint32(&p[4], length);
	put_now(&p[8]);
	append_le_uint32(&p[16], 0);        /* cluster */
	append_le_uint32(&p[20], 0);        /* dir_entry */
	put_now(&p[24]);
	strncpy((char *)&p[64], name, 31);
}

int ps2blank_create(uint8_t **out, size_t *len)
{
	uint8_t *card;
	uint32_t i;

	if (!out || !len)
		return -1;

	/* 0xFF is the erased state: these cards do not set CF_ERASE_ZEROES. */
	card = malloc(PS2BLANK_SIZE);
	if (!card)
		return -1;
	memset(card, 0xFF, PS2BLANK_SIZE);

	/* ---- superblock ---- */
	memset(card, 0, 384);
	memcpy(card, BLANK_MAGIC, strlen(BLANK_MAGIC));
	memcpy(&card[28], BLANK_VERSION, strlen(BLANK_VERSION));

	append_le_uint16(&card[40], PAGE_SIZE);
	append_le_uint16(&card[42], PAGES_PER_CLUSTER);
	append_le_uint16(&card[44], PAGES_PER_BLOCK);
	append_le_uint16(&card[46], 0xff00);
	append_le_uint32(&card[48], CLUSTERS);
	append_le_uint32(&card[52], ALLOC_OFFSET);
	append_le_uint32(&card[56], ALLOC_END);
	append_le_uint32(&card[60], 0);              /* root directory cluster */
	append_le_uint32(&card[64], BLOCKS - 1);     /* backup_block1 */
	append_le_uint32(&card[68], BLOCKS - 2);     /* backup_block2 */
	append_le_uint32(&card[80], IFC0);           /* ifc_list[0] */

	for (i = 0; i < 32; i++)
		append_le_uint32(&card[208 + 4 * i], 0xFFFFFFFF);  /* bad_block_list */

	card[336] = 2;                               /* cardtype: PS2 */
	card[337] = 0x2b;                            /* cardflags */

	/* ---- indirect FAT: where the FAT clusters live ---- */
	for (i = 0; i < FAT_CLUSTERS; i++)
		append_le_uint32(&card[IFC0 * CLUSTER_SIZE + 4 * i], IFC0 + 1 + i);

	/* ---- FAT: cluster 0 holds the root directory, the rest is free ---- */
	for (i = 0; i < CLUSTERS; i++)
		append_le_uint32(&card[(IFC0 + 1) * CLUSTER_SIZE + 4 * i],
				 i == 0 ? FAT_END : FAT_FREE);

	/* ---- root directory ---- */
	put_dirent(&card[ALLOC_OFFSET * CLUSTER_SIZE], DIR_SELF, 2, ".");
	put_dirent(&card[ALLOC_OFFSET * CLUSTER_SIZE + PAGE_SIZE], DIR_PARENT, 0, "..");

	*out = card;
	*len = PS2BLANK_SIZE;
	return 0;
}
