/*
 * ps2save.h - readers for third-party PS2 save containers
 *
 * CodeBreaker (.cbs), Action Replay MAX (.max) and Xploder/SharkPort (.xps)
 * all hold the same thing: one save directory and the files inside it. Each
 * reader turns its container into a ps2save_t, and ps2save_write() puts that
 * on the mounted card, so the format-specific code stays in one place and the
 * CLI and the WebAssembly build share it.
 *
 * Format details follow psv-save-converter by Bucanero, which in turn credits
 * CheatDevicePS2 and PSV-Exporter:
 *   https://github.com/bucanero/psv-save-converter
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

#ifndef PS2SAVE_H
#define PS2SAVE_H

#include <stdint.h>
#include <stddef.h>

#include "mcio.h"

enum ps2save_format {
	PS2SAVE_UNKNOWN = 0,
	PS2SAVE_PSU,            /* handled by the existing PSU importer */
	PS2SAVE_PSV,            /* handled by the existing PSV importer */
	PS2SAVE_CBS,
	PS2SAVE_MAX,
	PS2SAVE_XPS
};

/* Kept in the -10xx range so they cannot collide with mcio's own codes. */
#define PS2SAVE_ERR_MEMORY      -1000
#define PS2SAVE_ERR_FORMAT      -1010
#define PS2SAVE_ERR_TRUNCATED   -1011
#define PS2SAVE_ERR_DECOMPRESS  -1012
#define PS2SAVE_ERR_EXISTS      -1013

/* A save is at most a directory of files; no container nests deeper. */
#define PS2SAVE_MAX_FILES       512

typedef struct {
	char name[33];                     /* always NUL terminated */
	uint32_t size;
	uint16_t mode;
	struct sceMcStDateTime created;
	struct sceMcStDateTime modified;
	uint8_t *data;                     /* owned; size bytes */
} ps2save_file_t;

typedef struct {
	char dirname[33];                  /* always NUL terminated */
	uint16_t mode;
	struct sceMcStDateTime created;
	struct sceMcStDateTime modified;
	int file_count;
	ps2save_file_t *files;             /* owned */
} ps2save_t;

/* Identify a container from its first bytes. Never reads past `len`. */
int ps2save_detect(const uint8_t *buf, size_t len);

/* Human-readable name for a ps2save_format, for messages. */
const char *ps2save_format_name(int fmt);

/*
 * Read a .cbs/.max/.xps container into `out`. Returns 0, or a negative
 * PS2SAVE_ERR_*. On failure `out` is left zeroed and owns nothing. On success
 * the caller must ps2save_free() it.
 */
int ps2save_parse(const uint8_t *buf, size_t len, ps2save_t *out);

/* Create the directory and its files on the mounted card. Returns 0 or <0. */
int ps2save_write(const ps2save_t *save);

/*
 * Read a save directory off the mounted card into `out`. Returns 0 or a
 * negative mcio/PS2SAVE_ERR_* code. On success the caller must ps2save_free().
 */
int ps2save_read_card(const char *path, ps2save_t *out);

/*
 * Serialise a save as an Xploder/SharkPort .xps or a CodeBreaker .cbs. `*out`
 * is malloc'd and owned by the caller. Returns 0 or a negative PS2SAVE_ERR_*.
 *
 * There is no .max writer: its header under-reports both its sizes, so a file
 * we produced would be as awkward to read back as the ones in the wild.
 */
int ps2save_build_xps(const ps2save_t *save, uint8_t **out, size_t *out_len);
int ps2save_build_cbs(const ps2save_t *save, uint8_t **out, size_t *out_len);

void ps2save_free(ps2save_t *save);

#endif
