/*
 * HMAC-SHA1 (RFC 2104)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#ifndef HMAC_H
#define HMAC_H

#include <stdint.h>
#include <stddef.h>

#define HMAC_SHA1_DIGEST_SIZE 20

/*
 * Compute HMAC-SHA1 of `data` under `key`.
 *
 * The key may be any length: longer than the 64-byte SHA-1 block it is
 * hashed first, shorter it is zero padded, per RFC 2104.
 */
void hmac_sha1(const uint8_t *key, size_t keylen,
               const uint8_t *data, size_t len,
               uint8_t digest[HMAC_SHA1_DIGEST_SIZE]);

#endif
