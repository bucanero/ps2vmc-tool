/*
 * web_api.c - WebAssembly bridge for PS2VMC Tool
 *
 * Exposes the mcio virtual memory card filesystem (src/mcio.c) to JavaScript,
 * plus the PSU/PSV container handling and card image dumping that normally
 * lives in src/main.c. The whole card is a single buffer in the wasm heap;
 * mcio writes into it directly, so "saving" is just handing the buffer back.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <inttypes.h>
#include <stddef.h>
#include <emscripten.h>

#include "mcio.h"
#include "util.h"
#include "ps2save.h"
#include "ps2blank.h"

#define PSV_MAGIC       0x50535600
#define KEEP            EMSCRIPTEN_KEEPALIVE

/* ------------------------------------------------------------------ */
/* growable output buffer                                             */
/* ------------------------------------------------------------------ */

typedef struct {
	uint8_t *p;
	size_t len, cap;
} buf_t;

static int buf_grow(buf_t *b, size_t need)
{
	if (b->len + need <= b->cap)
		return 1;

	size_t cap = b->cap ? b->cap : 4096;
	while (cap < b->len + need)
		cap *= 2;

	uint8_t *np = realloc(b->p, cap);
	if (!np)
		return 0;

	b->p = np;
	b->cap = cap;
	return 1;
}

static int buf_put(buf_t *b, const void *data, size_t n)
{
	if (!buf_grow(b, n))
		return 0;
	memcpy(b->p + b->len, data, n);
	b->len += n;
	return 1;
}

static int buf_fill(buf_t *b, uint8_t v, size_t n)
{
	if (!buf_grow(b, n))
		return 0;
	memset(b->p + b->len, v, n);
	b->len += n;
	return 1;
}

/* ------------------------------------------------------------------ */
/* a new card                                                         */
/* ------------------------------------------------------------------ */

/* Build an empty card; caller frees. Raw, without ECC spare bytes. */
KEEP uint8_t *vmc_blank_card(int *out_len)
{
	uint8_t *card;
	size_t len;

	if (ps2blank_create(&card, &len) < 0) {
		*out_len = -1000;
		return NULL;
	}

	*out_len = (int)len;
	return card;
}

/* ------------------------------------------------------------------ */
/* card lifecycle                                                     */
/* ------------------------------------------------------------------ */

static uint8_t *g_vmc = NULL;
static int g_vmc_size = 0;

/* Allocate the card buffer; JS copies the file bytes into the returned pointer. */
KEEP uint8_t *vmc_alloc(int size)
{
	free(g_vmc);
	g_vmc = calloc(1, size);
	g_vmc_size = g_vmc ? size : 0;
	return g_vmc;
}

KEEP uint8_t *vmc_data_ptr(void) { return g_vmc; }
KEEP int vmc_data_size(void)     { return g_vmc_size; }

/* Hand the buffer to mcio and probe it. 0 = ok, negative = sceMcRes* error. */
KEEP int vmc_open(void)
{
	if (!g_vmc)
		return -1;
	return mcio_init(g_vmc, g_vmc_size);
}

/* Free a buffer returned by one of the vmc_*_export / vmc_file_read calls. */
KEEP void vmc_free(void *p) { free(p); }

/* ------------------------------------------------------------------ */
/* info                                                               */
/* ------------------------------------------------------------------ */

KEEP int vmc_info(int *pagesize, int *blocksize, int *cardsize, int *cardflags)
{
	return mcio_mcGetInfo(pagesize, blocksize, cardsize, cardflags);
}

KEEP int vmc_free_space(int *cardfree)
{
	return mcio_mcGetAvailableSpace(cardfree);
}

KEEP int vmc_format(void)   { return mcio_mcFormat(); }
KEEP int vmc_unformat(void) { return mcio_mcUnformat(); }

/* ------------------------------------------------------------------ */
/* directory + file operations (thin wrappers, so the linker keeps them) */
/* ------------------------------------------------------------------ */

KEEP int vmc_dopen(const char *path)              { return mcio_mcDopen(path); }
KEEP int vmc_dread(int fd, struct io_dirent *d)   { return mcio_mcDread(fd, d); }
KEEP int vmc_dclose(int fd)                       { return mcio_mcDclose(fd); }
KEEP int vmc_stat(const char *p, struct io_dirent *d) { return mcio_mcStat(p, d); }
KEEP int vmc_mkdir(const char *p)                 { return mcio_mcMkDir(p); }
KEEP int vmc_rmdir(const char *p)                 { return mcio_mcRmDir(p); }
KEEP int vmc_remove(const char *p)                { return mcio_mcRemove(p); }

KEEP int vmc_crosslink(const char *real, const char *dummy)
{
	return mcio_mcCreateCrossLinkedFile(real, dummy);
}

/* Read a whole file out of the card. Returns a malloc'd buffer (free with
 * vmc_free) and writes its length to *out_len; NULL on failure, with the
 * mcio error code in *out_len. */
KEEP uint8_t *vmc_file_read(const char *path, int *out_len)
{
	int fd, r, size;
	uint8_t *p;

	fd = mcio_mcOpen(path, sceMcFileAttrReadable | sceMcFileAttrFile);
	if (fd < 0) {
		*out_len = fd;
		return NULL;
	}

	size = mcio_mcSeek(fd, 0, SEEK_END);
	mcio_mcSeek(fd, 0, SEEK_SET);

	if (size < 0) {
		mcio_mcClose(fd);
		*out_len = size;
		return NULL;
	}

	p = malloc(size ? size : 1);
	if (!p) {
		mcio_mcClose(fd);
		*out_len = -1000;
		return NULL;
	}

	r = size ? mcio_mcRead(fd, p, size) : 0;
	mcio_mcClose(fd);

	if (r != size) {
		free(p);
		*out_len = -1001;
		return NULL;
	}

	*out_len = size;
	return p;
}

/* Create/overwrite a file on the card with the given bytes. */
KEEP int vmc_file_write(const char *path, uint8_t *data, int size)
{
	int fd, r;

	fd = mcio_mcOpen(path, sceMcFileCreateFile | sceMcFileAttrWriteable | sceMcFileAttrFile);
	if (fd < 0)
		return fd;

	r = mcio_mcWrite(fd, data, size);
	mcio_mcClose(fd);

	if (r != size)
		return -1004;

	return 0;
}

/* ------------------------------------------------------------------ */
/* card images                                                        */
/* ------------------------------------------------------------------ */

/* Raw image: page data only, ECC stripped (mirrors --mc-image). */
KEEP uint8_t *vmc_image_raw(int *out_len)
{
	int r, i, pagesize, blocksize, cardsize, cardflags;
	buf_t b = { 0 };
	void *page;

	r = mcio_mcGetInfo(&pagesize, &blocksize, &cardsize, &cardflags);
	if (r < 0) {
		*out_len = r;
		return NULL;
	}

	page = malloc(pagesize);
	if (!page) {
		*out_len = -1000;
		return NULL;
	}

	for (i = 0; i < (cardsize / pagesize); i++) {
		mcio_mcReadPage(i, page, NULL);
		if (!buf_put(&b, page, pagesize)) {
			free(page);
			free(b.p);
			*out_len = -1000;
			return NULL;
		}
	}

	free(page);
	*out_len = (int)b.len;
	return b.p;
}

/* ECC image: page data followed by its 16-byte spare (mirrors --ecc-image). */
KEEP uint8_t *vmc_image_ecc(int *out_len)
{
	int r, i, pagesize, blocksize, cardsize, cardflags;
	buf_t b = { 0 };
	void *page, *ecc;

	r = mcio_mcGetInfo(&pagesize, &blocksize, &cardsize, &cardflags);
	if (r < 0) {
		*out_len = r;
		return NULL;
	}

	page = malloc(pagesize);
	ecc = malloc(pagesize >> 5);
	if (!page || !ecc) {
		free(page);
		free(ecc);
		*out_len = -1000;
		return NULL;
	}

	for (i = 0; i < (cardsize / pagesize); i++) {
		mcio_mcReadPage(i, page, ecc);
		if (!buf_put(&b, page, pagesize) || !buf_put(&b, ecc, pagesize >> 5)) {
			free(page);
			free(ecc);
			free(b.p);
			*out_len = -1000;
			return NULL;
		}
	}

	free(page);
	free(ecc);
	*out_len = (int)b.len;
	return b.p;
}

/* ------------------------------------------------------------------ */
/* PSU export  (port of cmd_export in src/main.c)                     */
/* ------------------------------------------------------------------ */

KEEP uint8_t *vmc_psu_export(const char *path, int *out_len)
{
	int r, fd, dd, foundfile;
	struct io_dirent dirent;
	struct MCFsEntry entry;
	char filepath[256];
	buf_t b = { 0 };

	dd = mcio_mcDopen(path);
	if (dd < 0) {
		*out_len = dd;
		return NULL;
	}

	/* main directory entry */
	r = mcio_mcStat(path, &dirent);
	if (r < 0) {
		mcio_mcDclose(dd);
		*out_len = r;
		return NULL;
	}

	memset(&entry, 0, sizeof(entry));
	memcpy(&entry.created, &dirent.stat.ctime, sizeof(struct sceMcStDateTime));
	memcpy(&entry.modified, &dirent.stat.mtime, sizeof(struct sceMcStDateTime));
	memcpy(entry.name, dirent.name, sizeof(entry.name));
	entry.mode = dirent.stat.mode;
	entry.length = dirent.stat.size;
	if (!buf_put(&b, &entry, sizeof(entry)))
		goto oom;

	/* "." and ".." */
	memset(entry.name, 0, sizeof(entry.name));
	strncpy(entry.name, ".", sizeof(entry.name));
	entry.length = 0;
	if (!buf_put(&b, &entry, sizeof(entry)))
		goto oom;

	strncpy(entry.name, "..", sizeof(entry.name));
	if (!buf_put(&b, &entry, sizeof(entry)))
		goto oom;

	do {
		r = mcio_mcDread(dd, &dirent);
		foundfile = r;

		if (r && strcmp(dirent.name, ".") && strcmp(dirent.name, "..")) {
			uint8_t *p;
			int pad;

			snprintf(filepath, sizeof(filepath), "%s/%s", path, dirent.name);
			mcio_mcStat(filepath, &dirent);

			memset(&entry, 0, sizeof(entry));
			memcpy(&entry.created, &dirent.stat.ctime, sizeof(struct sceMcStDateTime));
			memcpy(&entry.modified, &dirent.stat.mtime, sizeof(struct sceMcStDateTime));
			memcpy(entry.name, dirent.name, sizeof(entry.name));
			entry.mode = dirent.stat.mode;
			entry.length = dirent.stat.size;
			if (!buf_put(&b, &entry, sizeof(entry)))
				goto oom;

			fd = mcio_mcOpen(filepath, sceMcFileAttrReadable | sceMcFileAttrFile);
			if (fd < 0) {
				mcio_mcDclose(dd);
				free(b.p);
				*out_len = fd;
				return NULL;
			}

			p = malloc(dirent.stat.size ? dirent.stat.size : 1);
			if (!p) {
				mcio_mcClose(fd);
				mcio_mcDclose(dd);
				free(b.p);
				*out_len = -1000;
				return NULL;
			}

			r = dirent.stat.size ? mcio_mcRead(fd, p, dirent.stat.size) : 0;
			mcio_mcClose(fd);

			if (r != (int)dirent.stat.size) {
				free(p);
				mcio_mcDclose(dd);
				free(b.p);
				*out_len = -1001;
				return NULL;
			}

			if (!buf_put(&b, p, dirent.stat.size)) {
				free(p);
				goto oom;
			}
			free(p);

			pad = (1024 - (dirent.stat.size % 1024)) % 1024;
			if (!buf_fill(&b, 0xFF, pad))
				goto oom;
		}
	} while (foundfile);

	mcio_mcDclose(dd);

	*out_len = (int)b.len;
	return b.p;

	/* A failed grow would otherwise be silent: the buffer keeps whatever it had
	 * and the caller writes out a truncated .psu that looks perfectly valid. */
oom:
	mcio_mcDclose(dd);
	free(b.p);
	*out_len = -1000;
	return NULL;
}

/* ------------------------------------------------------------------ */
/* PSU import  (port of cmd_psu_import in src/main.c)                 */
/* ------------------------------------------------------------------ */

KEEP int vmc_psu_import(uint8_t *data, int size)
{
	int fd, r, i;
	size_t pos = 0;
	char filepath[256];
	struct io_dirent entry;
	struct MCFsEntry psu_entry, file_entry;

	if (!size || (size % 512))
		return -1000;

	memcpy(&psu_entry, data, sizeof(struct MCFsEntry));
	pos += sizeof(struct MCFsEntry);

	/* skip "." and ".." */
	pos += sizeof(struct MCFsEntry) * 2;

	r = mcio_mcMkDir(psu_entry.name);
	if (r >= 0)
		mcio_mcClose(r);

	for (i = psu_entry.length; i > 2; i--) {
		uint8_t *p;

		if (pos + sizeof(struct MCFsEntry) > (size_t)size)
			return -1003;

		memcpy(&file_entry, data + pos, sizeof(struct MCFsEntry));
		pos += sizeof(struct MCFsEntry);

		if (pos + file_entry.length > (size_t)size)
			return -1003;

		snprintf(filepath, sizeof(filepath), "%s/%s", psu_entry.name, file_entry.name);

		fd = mcio_mcOpen(filepath, sceMcFileCreateFile | sceMcFileAttrWriteable | sceMcFileAttrFile);
		if (fd < 0)
			return fd;

		p = malloc(file_entry.length ? file_entry.length : 1);
		if (!p) {
			mcio_mcClose(fd);
			return -1002;
		}
		memcpy(p, data + pos, file_entry.length);
		pos += file_entry.length;

		r = mcio_mcWrite(fd, p, file_entry.length);
		free(p);

		if (r != (int)file_entry.length) {
			mcio_mcClose(fd);
			return -1004;
		}
		mcio_mcClose(fd);

		mcio_mcStat(filepath, &entry);
		memcpy(&entry.stat.ctime, &file_entry.created, sizeof(struct sceMcStDateTime));
		memcpy(&entry.stat.mtime, &file_entry.modified, sizeof(struct sceMcStDateTime));
		entry.stat.mode = file_entry.mode;
		mcio_mcSetStat(filepath, &entry);

		r = 1024 - (file_entry.length % 1024);
		if (r < 1024)
			pos += r;
	}

	mcio_mcStat(psu_entry.name, &entry);
	memcpy(&entry.stat.ctime, &psu_entry.created, sizeof(struct sceMcStDateTime));
	memcpy(&entry.stat.mtime, &psu_entry.modified, sizeof(struct sceMcStDateTime));
	entry.stat.mode = psu_entry.mode;
	mcio_mcSetStat(psu_entry.name, &entry);

	return 0;
}

/* ------------------------------------------------------------------ */
/* XPS export                                                         */
/* ------------------------------------------------------------------ */

/* Serialise a save as an Xploder/SharkPort .xps; caller frees the buffer. */
KEEP uint8_t *vmc_xps_export(const char *path, int *out_len)
{
	ps2save_t save;
	uint8_t *buf;
	size_t len;
	int r;

	r = ps2save_read_card(path, &save);
	if (r < 0) {
		*out_len = r;
		return NULL;
	}

	r = ps2save_build_xps(&save, &buf, &len);
	ps2save_free(&save);

	if (r < 0) {
		*out_len = r;
		return NULL;
	}

	*out_len = (int)len;
	return buf;
}

/* ------------------------------------------------------------------ */
/* Third-party containers: .cbs / .max / .xps                         */
/* ------------------------------------------------------------------ */

/* What container is this? One of the ps2save_format values. */
KEEP int vmc_save_detect(uint8_t *p, int size)
{
	if (size < 0)
		return PS2SAVE_UNKNOWN;

	return ps2save_detect(p, (size_t)size);
}

/* The directory a container would create, or "" if it cannot be read. */
KEEP const char *vmc_save_dirname(uint8_t *p, int size)
{
	static char name[33];
	ps2save_t save;

	name[0] = '\0';

	if (size > 0 && ps2save_parse(p, (size_t)size, &save) == 0) {
		snprintf(name, sizeof(name), "%s", save.dirname);
		ps2save_free(&save);
	}

	return name;
}

/* Import a .cbs/.max/.xps save. The format is detected from the data. */
KEEP int vmc_save_import(uint8_t *p, int size)
{
	ps2save_t save;
	int r;

	if (size <= 0)
		return PS2SAVE_ERR_TRUNCATED;

	r = ps2save_parse(p, (size_t)size, &save);
	if (r < 0)
		return r;

	r = ps2save_write(&save);
	ps2save_free(&save);

	return r;
}

/* ------------------------------------------------------------------ */
/* PSV import  (port of cmd_import in src/main.c)                     */
/* ------------------------------------------------------------------ */

KEEP int vmc_psv_import(uint8_t *p, int size)
{
	int fd, r, filesize, i;
	char filepath[256];
	struct io_dirent entry;
	ps2_MainDirInfo_t *ps2md;
	ps2_FileInfo_t *ps2fi;

	if (size < 0x68 + (int)sizeof(ps2_MainDirInfo_t))
		return -1001;

	if ((int)read_le_uint32(p) != PSV_MAGIC)
		return -1000;

	if (p[0x3C] != 0x02)
		return -1004;   /* not a PS2 save */

	ps2md = (ps2_MainDirInfo_t *)&p[0x68];
	ps2fi = (ps2_FileInfo_t *)&ps2md[1];

	r = mcio_mcMkDir(ps2md->filename);
	if (r >= 0)
		mcio_mcClose(r);

	for (i = read_le_uint32((uint8_t *)&ps2md->numberOfFilesInDir); i > 2; i--, ps2fi++) {
		uint32_t offset;

		filesize = read_le_uint32((uint8_t *)&ps2fi->filesize);
		offset = read_le_uint32((uint8_t *)&ps2fi->positionInFile);

		if (offset + (uint32_t)filesize > (uint32_t)size)
			return -1003;

		snprintf(filepath, sizeof(filepath), "%s/%s", ps2md->filename, ps2fi->filename);

		fd = mcio_mcOpen(filepath, sceMcFileCreateFile | sceMcFileAttrWriteable | sceMcFileAttrFile);
		if (fd < 0)
			return fd;

		r = mcio_mcWrite(fd, &p[offset], filesize);
		if (r != filesize) {
			mcio_mcClose(fd);
			return -1004;
		}
		mcio_mcClose(fd);

		mcio_mcStat(filepath, &entry);
		memcpy(&entry.stat.ctime, &ps2fi->create, sizeof(struct sceMcStDateTime));
		memcpy(&entry.stat.mtime, &ps2fi->modified, sizeof(struct sceMcStDateTime));
		entry.stat.mode = read_le_uint32((uint8_t *)&ps2fi->attribute);
		mcio_mcSetStat(filepath, &entry);
	}

	mcio_mcStat(ps2md->filename, &entry);
	memcpy(&entry.stat.ctime, &ps2md->create, sizeof(struct sceMcStDateTime));
	memcpy(&entry.stat.mtime, &ps2md->modified, sizeof(struct sceMcStDateTime));
	entry.stat.mode = read_le_uint32((uint8_t *)&ps2md->attribute);
	mcio_mcSetStat(ps2md->filename, &entry);

	return 0;
}

/* ------------------------------------------------------------------ */
/* struct layout, exported so the JS side can never drift from the C  */
/* ------------------------------------------------------------------ */

KEEP int vmc_sizeof_dirent(void)  { return (int)sizeof(struct io_dirent); }
KEEP int vmc_sizeof_fsentry(void) { return (int)sizeof(struct MCFsEntry); }
KEEP int vmc_offsetof_name(void)  { return (int)offsetof(struct io_dirent, name); }
