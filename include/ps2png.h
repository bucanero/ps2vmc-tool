/*
 * ps2png.h - minimal PNG writer
 *
 * Replaces the vendored svpng.h, which wrote its IDAT as stored (uncompressed)
 * deflate blocks: a 256x256 icon render came to 264 KB. zlib is linked anyway,
 * so the same image compresses to about 34 KB.
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

#ifndef PS2PNG_H
#define PS2PNG_H

#include <stdio.h>
#include <stdint.h>

/*
 * Write `w` x `h` RGBA pixels as a PNG. Returns 0, or negative on an
 * allocation failure or a short write. The caller owns the FILE.
 */
int png_write_rgba(FILE *f, const uint8_t *rgba, int w, int h);

#endif
