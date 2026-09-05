/*
 * ps2blank.h - build an empty PS2 memory card image
 *
 * mcio can only format an image that is already a card: Card_Format() probes
 * every block with a flash-like erase and verify cycle that a plain buffer
 * never passes. So a new card is written directly, the way mymc does it:
 *   https://github.com/ps2dev/mymc
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

#ifndef PS2BLANK_H
#define PS2BLANK_H

#include <stdint.h>
#include <stddef.h>

/* The standard PS2 card, and the only size this builds. */
#define PS2BLANK_SIZE (8 * 1024 * 1024)

/*
 * Build an empty formatted card, without ECC spare bytes. The caller owns the
 * returned buffer and must free() it; `len` is set to its size. Returns 0, or
 * a negative value if the allocation failed.
 *
 * The result is a raw image; mcio_mcImageEcc() (or --ecc-image) turns it into
 * the 528-byte-page form that real cards and emulators use.
 */
int ps2blank_create(uint8_t **out, size_t *len);

#endif
