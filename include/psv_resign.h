/*
 * psv_resign.h - signatures for PS3 .PSV saves and PSP/Vita .VMP memory cards
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#ifndef __PSV_RESIGN_H__
#define __PSV_RESIGN_H__

#include <inttypes.h>

/* PSV file header, common to PS1 and PS2 saves (0x40 bytes) */
typedef struct {
	char     magic[4];          /* "\0VSP" */
	uint32_t padding1;
	uint8_t  salt[20];          /* seed the signature key is derived from */
	uint8_t  signature[20];
	uint32_t padding2;
	uint32_t padding3;
	uint32_t headerSize;        /* 0x14 for PS1, 0x2C for PS2 */
	uint32_t saveType;          /* 1 = PS1, 2 = PS2 */
} __attribute__((packed)) psv_header_t;

/* PS2 save descriptor, immediately after the PSV header (0x28 bytes) */
typedef struct {
	uint32_t displaySize;       /* total of every file, shown on the XMB */
	uint32_t sysPos;            /* icon.sys */
	uint32_t sysSize;
	uint32_t icon1Pos;          /* the three icons named by icon.sys */
	uint32_t icon1Size;
	uint32_t icon2Pos;
	uint32_t icon2Size;
	uint32_t icon3Pos;
	uint32_t icon3Size;
	uint32_t numberOfFiles;
} __attribute__((packed)) ps2_header_t;

/* Sign a .PSV save in place. Returns 1 on success, 0 on failure. */
int psv_resign(const char *src_psv);

/* Sign a .VMP memory card image in place. Returns 1 on success, 0 on failure. */
int vmp_resign(const char *src_vmp);

#endif
