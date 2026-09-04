/*
 * ps2save.c - readers for third-party PS2 save containers
 *
 * See include/ps2save.h. Format details follow psv-save-converter by Bucanero:
 *   https://github.com/bucanero/psv-save-converter
 *
 * The readers here are deliberately stricter than the reference: every field
 * is bounds-checked against the buffer before it is read, because these files
 * arrive from the internet and a truncated one must be rejected rather than
 * walked off the end.
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

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "ps2save.h"
#include "lzari.h"
#include "miniz.h"

#define CBS_MAGIC       "CFU\0"
#define MAX_MAGIC       "Ps2PowerSave"
#define XPS_MAGIC       "SharkPortSave\0\0\0"
#define PSU_ENTRY_SIZE  512

/* Attributes the PS2 browser expects; the MAX container stores none itself. */
#define ATTR_DIR        0x8427
#define ATTR_FILE       0x8497

/* A save that claims more than this is not a save. */
#define SANE_FILE_SIZE  (16 * 1024 * 1024)

typedef struct {
	char magic[4];
	uint32_t unk1;
	uint32_t dataOffset;
	uint32_t decompressedSize;
	uint32_t compressedSize;
	char name[32];
	struct sceMcStDateTime created;
	struct sceMcStDateTime modified;
	uint32_t unk2;
	uint32_t mode;
	char unk3[16];
	char title[72];
	char description[132];
} __attribute__((packed)) cbs_header_t;

typedef struct {
	struct sceMcStDateTime created;
	struct sceMcStDateTime modified;
	uint32_t length;
	uint32_t mode;
	char unk1[8];
	char name[32];
} __attribute__((packed)) cbs_entry_t;

typedef struct {
	char magic[12];
	uint32_t crc;
	char dirName[32];
	char iconSysName[32];
	uint32_t compressedSize;
	uint32_t numFiles;
	/* Also the first word of the LZARI stream, so the stream starts four
	 * bytes before the end of this struct. */
	uint32_t decompressedSize;
} __attribute__((packed)) max_header_t;

typedef struct {
	uint32_t length;
	char name[32];
} __attribute__((packed)) max_entry_t;

typedef struct {
	uint16_t entry_sz;
	char name[64];
	uint32_t length;
	uint32_t start;
	uint32_t end;
	uint32_t mode;
	struct sceMcStDateTime created;
	struct sceMcStDateTime modified;
	char unk1[4];
	char padding[12];
	char title_ascii[64];
	char title_sjis[64];
	char unk2[8];
} __attribute__((packed)) xps_entry_t;

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

/* Copy a fixed-width, possibly unterminated container name into a C string. */
static void copy_name(char *dst, size_t dstsz, const char *src, size_t srcsz)
{
	size_t n = srcsz < dstsz - 1 ? srcsz : dstsz - 1;

	memcpy(dst, src, n);
	dst[n] = '\0';
}

/* XPS stores the attribute word byte-swapped. */
static uint16_t mode_swap(uint32_t m)
{
	return (uint16_t)(((m & 0x00FF) << 8) | ((m & 0xFF00) >> 8));
}

static void now_datetime(struct sceMcStDateTime *dt)
{
	time_t t = time(NULL);
	struct tm *tm = gmtime(&t);

	memset(dt, 0, sizeof(*dt));
	if (!tm)
		return;

	dt->Sec = tm->tm_sec;
	dt->Min = tm->tm_min;
	dt->Hour = tm->tm_hour;
	dt->Day = tm->tm_mday;
	dt->Month = tm->tm_mon + 1;
	dt->Year = tm->tm_year + 1900;
}

static int alloc_files(ps2save_t *s, int count)
{
	if (count <= 0 || count > PS2SAVE_MAX_FILES)
		return PS2SAVE_ERR_FORMAT;

	s->files = calloc(count, sizeof(ps2save_file_t));
	if (!s->files)
		return PS2SAVE_ERR_MEMORY;

	s->file_count = count;
	return 0;
}

static int take_data(ps2save_file_t *f, const uint8_t *src, uint32_t size)
{
	f->data = malloc(size ? size : 1);
	if (!f->data)
		return PS2SAVE_ERR_MEMORY;

	memcpy(f->data, src, size);
	f->size = size;
	return 0;
}

void ps2save_free(ps2save_t *save)
{
	if (!save)
		return;

	for (int i = 0; i < save->file_count; i++)
		free(save->files[i].data);

	free(save->files);
	memset(save, 0, sizeof(*save));
}

/* ------------------------------------------------------------------ */
/* detection                                                          */
/* ------------------------------------------------------------------ */

int ps2save_detect(const uint8_t *buf, size_t len)
{
	if (!buf)
		return PS2SAVE_UNKNOWN;

	if (len >= 4 && memcmp(buf, "\0VSP", 4) == 0)
		return PS2SAVE_PSV;

	if (len >= sizeof(cbs_header_t) && memcmp(buf, CBS_MAGIC, 4) == 0)
		return PS2SAVE_CBS;

	if (len >= sizeof(max_header_t) && memcmp(buf, MAX_MAGIC, 12) == 0)
		return PS2SAVE_MAX;

	if (len >= 0x15 && memcmp(buf + 4, XPS_MAGIC, 16) == 0)
		return PS2SAVE_XPS;

	/* A PSU has no magic: it opens with a 512-byte directory entry whose
	 * mode marks a subdirectory, and the whole file is a multiple of 512. */
	if (len >= PSU_ENTRY_SIZE * 3 && len % PSU_ENTRY_SIZE == 0) {
		uint16_t mode = (uint16_t)(buf[0] | (buf[1] << 8));

		if (mode & sceMcFileAttrSubdir)
			return PS2SAVE_PSU;
	}

	return PS2SAVE_UNKNOWN;
}

const char *ps2save_format_name(int fmt)
{
	switch (fmt) {
	case PS2SAVE_PSU: return "PSU";
	case PS2SAVE_PSV: return "PSV";
	case PS2SAVE_CBS: return "CodeBreaker";
	case PS2SAVE_MAX: return "Action Replay MAX";
	case PS2SAVE_XPS: return "Xploder/SharkPort";
	default:          return "unknown";
	}
}

/* ------------------------------------------------------------------ */
/* CodeBreaker (.cbs)                                                 */
/* ------------------------------------------------------------------ */

/*
 * The body is an RC4 keystream started from a fixed permutation rather than
 * from a key schedule, so there is no key to derive - the table *is* the
 * state. Taken from mymc's ps2save.py.
 */
static const uint8_t cbs_key[256] = {
	0x5f, 0x1f, 0x85, 0x6f, 0x31, 0xaa, 0x3b, 0x18, 0x21, 0xb9, 0xce, 0x1c, 0x07, 0x4c, 0x9c, 0xb4,
	0x81, 0xb8, 0xef, 0x98, 0x59, 0xae, 0xf9, 0x26, 0xe3, 0x80, 0xa3, 0x29, 0x2d, 0x73, 0x51, 0x62,
	0x7c, 0x64, 0x46, 0xf4, 0x34, 0x1a, 0xf6, 0xe1, 0xba, 0x3a, 0x0d, 0x82, 0x79, 0x0a, 0x5c, 0x16,
	0x71, 0x49, 0x8e, 0xac, 0x8c, 0x9f, 0x35, 0x19, 0x45, 0x94, 0x3f, 0x56, 0x0c, 0x91, 0x00, 0x0b,
	0xd7, 0xb0, 0xdd, 0x39, 0x66, 0xa1, 0x76, 0x52, 0x13, 0x57, 0xf3, 0xbb, 0x4e, 0xe5, 0xdc, 0xf0,
	0x65, 0x84, 0xb2, 0xd6, 0xdf, 0x15, 0x3c, 0x63, 0x1d, 0x89, 0x14, 0xbd, 0xd2, 0x36, 0xfe, 0xb1,
	0xca, 0x8b, 0xa4, 0xc6, 0x9e, 0x67, 0x47, 0x37, 0x42, 0x6d, 0x6a, 0x03, 0x92, 0x70, 0x05, 0x7d,
	0x96, 0x2f, 0x40, 0x90, 0xc4, 0xf1, 0x3e, 0x3d, 0x01, 0xf7, 0x68, 0x1e, 0xc3, 0xfc, 0x72, 0xb5,
	0x54, 0xcf, 0xe7, 0x41, 0xe4, 0x4d, 0x83, 0x55, 0x12, 0x22, 0x09, 0x78, 0xfa, 0xde, 0xa7, 0x06,
	0x08, 0x23, 0xbf, 0x0f, 0xcc, 0xc1, 0x97, 0x61, 0xc5, 0x4a, 0xe6, 0xa0, 0x11, 0xc2, 0xea, 0x74,
	0x02, 0x87, 0xd5, 0xd1, 0x9d, 0xb7, 0x7e, 0x38, 0x60, 0x53, 0x95, 0x8d, 0x25, 0x77, 0x10, 0x5e,
	0x9b, 0x7f, 0xd8, 0x6e, 0xda, 0xa2, 0x2e, 0x20, 0x4f, 0xcd, 0x8f, 0xcb, 0xbe, 0x5a, 0xe0, 0xed,
	0x2c, 0x9a, 0xd4, 0xe2, 0xaf, 0xd0, 0xa9, 0xe8, 0xad, 0x7a, 0xbc, 0xa8, 0xf2, 0xee, 0xeb, 0xf5,
	0xa6, 0x99, 0x28, 0x24, 0x6c, 0x2b, 0x75, 0x5d, 0xf8, 0xd3, 0x86, 0x17, 0xfb, 0xc0, 0x7b, 0xb3,
	0x58, 0xdb, 0xc7, 0x4b, 0xff, 0x04, 0x50, 0xe9, 0x88, 0x69, 0xc9, 0x2a, 0xab, 0xfd, 0x5b, 0x1b,
	0x8a, 0xd9, 0xec, 0x27, 0x44, 0x0e, 0x33, 0xc8, 0x6b, 0x93, 0x32, 0x48, 0xb6, 0x30, 0x43, 0xa5
};

static void cbs_crypt(uint8_t *buf, size_t len)
{
	uint8_t s[256];
	uint8_t j = 0, k = 0, tmp;

	memcpy(s, cbs_key, sizeof(s));

	for (size_t i = 0; i < len; i++) {
		j += 1;
		k += s[j];

		tmp = s[j];
		s[j] = s[k];
		s[k] = tmp;

		buf[i] ^= s[(uint8_t)(s[j] + s[k])];
	}
}

static int parse_cbs(const uint8_t *buf, size_t len, ps2save_t *out)
{
	cbs_header_t header;
	uint8_t *body = NULL, *plain = NULL;
	size_t body_len, plain_len = 0, off;
	int count = 0, i, r;

	if (len <= sizeof(cbs_header_t))
		return PS2SAVE_ERR_TRUNCATED;

	memcpy(&header, buf, sizeof(header));
	body_len = len - sizeof(cbs_header_t);

	/* The stream is decrypted in place, so work on a copy of the input. */
	body = malloc(body_len);
	if (!body)
		return PS2SAVE_ERR_MEMORY;

	memcpy(body, buf + sizeof(cbs_header_t), body_len);
	cbs_crypt(body, body_len);

	/* Some writers put a wrong compressedSize in the header, so the whole
	 * remainder is handed to the inflater rather than header.compressedSize. */
	plain = tinfl_decompress_mem_to_heap(body, body_len, &plain_len,
	                                     TINFL_FLAG_PARSE_ZLIB_HEADER);
	free(body);

	if (!plain)
		return PS2SAVE_ERR_DECOMPRESS;

	/* Two passes: count the entries, then read them. */
	for (off = 0; off + sizeof(cbs_entry_t) <= plain_len; ) {
		cbs_entry_t e;

		memcpy(&e, plain + off, sizeof(e));
		off += sizeof(e);

		if (e.length > SANE_FILE_SIZE || off + e.length > plain_len)
			break;

		off += e.length;
		count++;
	}

	r = alloc_files(out, count);
	if (r < 0) {
		free(plain);
		return r;
	}

	for (i = 0, off = 0; i < count; i++) {
		cbs_entry_t e;

		memcpy(&e, plain + off, sizeof(e));
		off += sizeof(e);

		copy_name(out->files[i].name, sizeof(out->files[i].name), e.name, sizeof(e.name));
		out->files[i].mode = (uint16_t)e.mode;
		out->files[i].created = e.created;
		out->files[i].modified = e.modified;

		r = take_data(&out->files[i], plain + off, e.length);
		if (r < 0) {
			free(plain);
			ps2save_free(out);
			return r;
		}
		off += e.length;
	}

	free(plain);

	copy_name(out->dirname, sizeof(out->dirname), header.name, sizeof(header.name));
	out->mode = (uint16_t)header.mode;
	out->created = header.created;
	out->modified = header.modified;

	return 0;
}

/* ------------------------------------------------------------------ */
/* Action Replay MAX (.max)                                           */
/* ------------------------------------------------------------------ */

/* Entries sit on a 16-byte grid offset by the 8 bytes before the first one. */
static size_t max_advance(size_t off, uint32_t length)
{
	size_t end = off + length + 8;

	return ((end + 15) / 16) * 16 - 8;
}

static int parse_max(const uint8_t *buf, size_t len, ps2save_t *out)
{
	max_header_t header;
	uint8_t *plain;
	size_t stream_off, off, plain_len;
	uint32_t avail;
	int i, r, got;

	if (len <= sizeof(max_header_t))
		return PS2SAVE_ERR_TRUNCATED;

	memcpy(&header, buf, sizeof(header));

	if (!header.numFiles || header.numFiles > PS2SAVE_MAX_FILES ||
	    !header.decompressedSize || header.decompressedSize > SANE_FILE_SIZE ||
	    !header.compressedSize || header.dirName[0] == '\0')
		return PS2SAVE_ERR_FORMAT;

	/* decompressedSize doubles as the first word of the stream. */
	stream_off = sizeof(max_header_t) - 4;

	/* Everything after the header is handed to the decoder, deliberately not
	 * header.compressedSize: real files under-report it. One AR MAX save here
	 * claims 17529 for a 17533-byte stream, and trusting that starves the
	 * decoder of its last bytes - it then returns 168 bytes short and the
	 * final file in the save is cut off. The stream carries its own length in
	 * its first word, so extra input cannot overrun anything. */
	avail = (uint32_t)(len - stream_off);

	/* calloc, not malloc: a short stream leaves the tail untouched, and it
	 * must read as zeros rather than as whatever was on the heap. */
	plain = calloc(1, header.decompressedSize);
	if (!plain)
		return PS2SAVE_ERR_MEMORY;

	/* unlzari() stops when the input runs out and reports how much it wrote,
	 * so a truncated file decompresses "successfully" to a short buffer.
	 * Entries are bounded by what came out, never by the header's claim. */
	got = unlzari((unsigned char *)buf + stream_off, (int)avail,
	              plain, (int)header.decompressedSize);
	if (got <= 0) {
		free(plain);
		return PS2SAVE_ERR_DECOMPRESS;
	}

	plain_len = (size_t)got < header.decompressedSize
	          ? (size_t)got : header.decompressedSize;

	r = alloc_files(out, (int)header.numFiles);
	if (r < 0) {
		free(plain);
		return r;
	}

	for (i = 0, off = 0; i < out->file_count; i++) {
		max_entry_t e;

		if (off + sizeof(e) > plain_len) {
			free(plain);
			ps2save_free(out);
			return PS2SAVE_ERR_TRUNCATED;
		}

		memcpy(&e, plain + off, sizeof(e));
		off += sizeof(e);

		if (e.length > SANE_FILE_SIZE || off + e.length > plain_len) {
			free(plain);
			ps2save_free(out);
			return PS2SAVE_ERR_TRUNCATED;
		}

		copy_name(out->files[i].name, sizeof(out->files[i].name), e.name, sizeof(e.name));
		out->files[i].mode = ATTR_FILE;

		r = take_data(&out->files[i], plain + off, e.length);
		if (r < 0) {
			free(plain);
			ps2save_free(out);
			return r;
		}

		off = max_advance(off, e.length);
	}

	free(plain);

	copy_name(out->dirname, sizeof(out->dirname), header.dirName, sizeof(header.dirName));
	out->mode = ATTR_DIR;

	/* The container carries no timestamps - the reference takes them from the
	 * file on disk, which a buffer does not have. Stamp them like a save the
	 * card just wrote. */
	now_datetime(&out->created);
	out->modified = out->created;
	for (i = 0; i < out->file_count; i++) {
		out->files[i].created = out->created;
		out->files[i].modified = out->created;
	}

	return 0;
}

/* ------------------------------------------------------------------ */
/* Xploder / SharkPort (.xps)                                         */
/* ------------------------------------------------------------------ */

static int parse_xps(const uint8_t *buf, size_t len, ps2save_t *out)
{
	xps_entry_t entry;
	size_t off = 0x15;
	int i, r, count;

	if (len < 0x15 || memcmp(buf + 4, XPS_MAGIC, 16) != 0)
		return PS2SAVE_ERR_FORMAT;

	/* Two variable-length text blocks, then two words, then the entries.
	 * The reference reads these into a 100-byte stack buffer without
	 * checking the length; here they are skipped, not read. */
	for (i = 0; i < 2; i++) {
		uint32_t n;

		if (off + 4 > len)
			return PS2SAVE_ERR_TRUNCATED;
		memcpy(&n, buf + off, 4);
		off += 4;

		if (n > len || off + n > len)
			return PS2SAVE_ERR_TRUNCATED;
		off += n;
	}

	if (off + 8 > len)
		return PS2SAVE_ERR_TRUNCATED;
	off += 8;

	if (off + sizeof(entry) > len)
		return PS2SAVE_ERR_TRUNCATED;
	memcpy(&entry, buf + off, sizeof(entry));
	off += sizeof(entry);

	/* The directory entry counts "." and ".." among its children. */
	if (entry.length < 2)
		return PS2SAVE_ERR_FORMAT;
	count = (int)entry.length - 2;

	r = alloc_files(out, count);
	if (r < 0)
		return r;

	copy_name(out->dirname, sizeof(out->dirname), entry.name, sizeof(out->dirname) - 1);
	out->mode = mode_swap(entry.mode);
	out->created = entry.created;
	out->modified = entry.modified;

	for (i = 0; i < count; i++) {
		if (off + sizeof(entry) > len) {
			ps2save_free(out);
			return PS2SAVE_ERR_TRUNCATED;
		}
		memcpy(&entry, buf + off, sizeof(entry));
		off += sizeof(entry);

		if (entry.length > SANE_FILE_SIZE || off + entry.length > len) {
			ps2save_free(out);
			return PS2SAVE_ERR_TRUNCATED;
		}

		copy_name(out->files[i].name, sizeof(out->files[i].name),
		          entry.name, sizeof(out->files[i].name) - 1);
		out->files[i].mode = mode_swap(entry.mode);
		out->files[i].created = entry.created;
		out->files[i].modified = entry.modified;

		r = take_data(&out->files[i], buf + off, entry.length);
		if (r < 0) {
			ps2save_free(out);
			return r;
		}
		off += entry.length;
	}

	return 0;
}

/* ------------------------------------------------------------------ */
/* public entry points                                                */
/* ------------------------------------------------------------------ */

int ps2save_parse(const uint8_t *buf, size_t len, ps2save_t *out)
{
	int r;

	if (!buf || !out)
		return PS2SAVE_ERR_FORMAT;

	memset(out, 0, sizeof(*out));

	switch (ps2save_detect(buf, len)) {
	case PS2SAVE_CBS: r = parse_cbs(buf, len, out); break;
	case PS2SAVE_MAX: r = parse_max(buf, len, out); break;
	case PS2SAVE_XPS: r = parse_xps(buf, len, out); break;
	default:          return PS2SAVE_ERR_FORMAT;
	}

	if (r == 0 && (out->dirname[0] == '\0' || out->file_count == 0)) {
		ps2save_free(out);
		return PS2SAVE_ERR_FORMAT;
	}

	if (r < 0)
		memset(out, 0, sizeof(*out));

	return r;
}

int ps2save_write(const ps2save_t *save)
{
	struct io_dirent dirent;
	char filepath[288];
	int i, fd, r;

	if (!save || save->dirname[0] == '\0')
		return PS2SAVE_ERR_FORMAT;

	r = mcio_mcMkDir(save->dirname);
	if (r < 0)
		return r;
	mcio_mcClose(r);

	for (i = 0; i < save->file_count; i++) {
		const ps2save_file_t *f = &save->files[i];

		if (f->name[0] == '\0')
			continue;

		snprintf(filepath, sizeof(filepath), "%s/%s", save->dirname, f->name);

		fd = mcio_mcOpen(filepath, sceMcFileCreateFile | sceMcFileAttrWriteable |
		                           sceMcFileAttrFile);
		if (fd < 0)
			return fd;

		r = f->size ? mcio_mcWrite(fd, f->data, f->size) : 0;
		mcio_mcClose(fd);

		if (r != (int)f->size)
			return PS2SAVE_ERR_TRUNCATED;

		if (mcio_mcStat(filepath, &dirent) == sceMcResSucceed) {
			dirent.stat.ctime = f->created;
			dirent.stat.mtime = f->modified;
			if (f->mode)
				dirent.stat.mode = f->mode;
			mcio_mcSetStat(filepath, &dirent);
		}
	}

	if (mcio_mcStat(save->dirname, &dirent) == sceMcResSucceed) {
		dirent.stat.ctime = save->created;
		dirent.stat.mtime = save->modified;
		if (save->mode)
			dirent.stat.mode = save->mode;
		mcio_mcSetStat(save->dirname, &dirent);
	}

	return 0;
}
