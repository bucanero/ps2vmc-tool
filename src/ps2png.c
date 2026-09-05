/*
 * ps2png.c - minimal PNG writer
 *
 * See include/ps2png.h. Rows are filtered with the heuristic the PNG spec
 * suggests - try all five, keep the one whose bytes sum smallest read as
 * signed - which is worth about 13% over writing every row unfiltered.
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

#include <zlib.h>

#include "ps2png.h"

#define BPP  4          /* RGBA8, the only format written here */

static int put_u32be(FILE *f, uint32_t v)
{
	uint8_t b[4] = { (uint8_t)(v >> 24), (uint8_t)(v >> 16),
			 (uint8_t)(v >> 8), (uint8_t)v };

	return fwrite(b, 1, 4, f) == 4 ? 0 : -1;
}

/* length, type, data, then a crc32 over the type and the data. */
static int put_chunk(FILE *f, const char *type, const uint8_t *data, size_t len)
{
	uLong crc;

	if (put_u32be(f, (uint32_t)len) < 0)
		return -1;
	if (fwrite(type, 1, 4, f) != 4)
		return -1;
	if (len && fwrite(data, 1, len, f) != len)
		return -1;

	crc = crc32(0, (const Bytef *)type, 4);
	if (len)
		crc = crc32(crc, data, (uInt)len);

	return put_u32be(f, (uint32_t)crc);
}

static uint8_t paeth(uint8_t a, uint8_t b, uint8_t c)
{
	int p = (int)a + b - c;
	int pa = abs(p - a), pb = abs(p - b), pc = abs(p - c);

	if (pa <= pb && pa <= pc)
		return a;
	return pb <= pc ? b : c;
}

/* How expensive a filtered row looks to the compressor. */
static unsigned long row_score(const uint8_t *row, size_t n)
{
	unsigned long sum = 0;
	size_t i;

	for (i = 0; i < n; i++)
		sum += row[i] < 128 ? row[i] : (unsigned)(256 - row[i]);

	return sum;
}

int png_write_rgba(FILE *f, const uint8_t *rgba, int w, int h)
{
	static const uint8_t sig[8] = { 137, 'P', 'N', 'G', '\r', '\n', 26, '\n' };
	uint8_t ihdr[13];
	uint8_t *raw = NULL, *cand = NULL, *comp = NULL;
	const uint8_t *prev;
	size_t stride, rawlen, y, x;
	uLongf complen;
	int rc = -1, t, best;

	if (!f || !rgba || w <= 0 || h <= 0)
		return -1;

	stride = (size_t)w * BPP;
	rawlen = (stride + 1) * (size_t)h;

	raw = malloc(rawlen);
	cand = malloc(stride * 5);
	if (!raw || !cand)
		goto done;

	prev = NULL;
	for (y = 0; y < (size_t)h; y++) {
		const uint8_t *row = rgba + y * stride;
		unsigned long bestscore = 0;

		for (t = 0; t < 5; t++) {
			uint8_t *o = cand + (size_t)t * stride;
			unsigned long sc;

			for (x = 0; x < stride; x++) {
				uint8_t a = x >= BPP ? row[x - BPP] : 0;
				uint8_t b = prev ? prev[x] : 0;
				uint8_t c = (prev && x >= BPP) ? prev[x - BPP] : 0;

				switch (t) {
				case 0: o[x] = row[x]; break;
				case 1: o[x] = (uint8_t)(row[x] - a); break;
				case 2: o[x] = (uint8_t)(row[x] - b); break;
				case 3: o[x] = (uint8_t)(row[x] - (((unsigned)a + b) >> 1)); break;
				default: o[x] = (uint8_t)(row[x] - paeth(a, b, c)); break;
				}
			}

			sc = row_score(o, stride);
			if (t == 0 || sc < bestscore) {
				bestscore = sc;
				best = t;
			}
		}

		raw[y * (stride + 1)] = (uint8_t)best;
		memcpy(&raw[y * (stride + 1) + 1], cand + (size_t)best * stride, stride);
		prev = row;
	}

	complen = compressBound((uLong)rawlen);
	comp = malloc(complen);
	if (!comp)
		goto done;

	if (compress2(comp, &complen, raw, (uLong)rawlen, Z_BEST_COMPRESSION) != Z_OK)
		goto done;

	ihdr[0] = (uint8_t)((uint32_t)w >> 24); ihdr[1] = (uint8_t)((uint32_t)w >> 16);
	ihdr[2] = (uint8_t)((uint32_t)w >> 8);  ihdr[3] = (uint8_t)w;
	ihdr[4] = (uint8_t)((uint32_t)h >> 24); ihdr[5] = (uint8_t)((uint32_t)h >> 16);
	ihdr[6] = (uint8_t)((uint32_t)h >> 8);  ihdr[7] = (uint8_t)h;
	ihdr[8] = 8;      /* bit depth */
	ihdr[9] = 6;      /* colour type: truecolour with alpha */
	ihdr[10] = 0;     /* deflate */
	ihdr[11] = 0;     /* adaptive filtering */
	ihdr[12] = 0;     /* no interlace */

	if (fwrite(sig, 1, sizeof(sig), f) != sizeof(sig))
		goto done;
	if (put_chunk(f, "IHDR", ihdr, sizeof(ihdr)) < 0)
		goto done;
	if (put_chunk(f, "IDAT", comp, complen) < 0)
		goto done;
	if (put_chunk(f, "IEND", NULL, 0) < 0)
		goto done;

	rc = 0;

done:
	free(raw);
	free(cand);
	free(comp);
	return rc;
}
