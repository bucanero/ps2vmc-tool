/*
 * HMAC-SHA1 (RFC 2104)
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

#include <string.h>

#include "sha1.h"
#include "hmac.h"

#define SHA1_BLOCK_SIZE 64

void hmac_sha1(const uint8_t *key, size_t keylen,
               const uint8_t *data, size_t len,
               uint8_t digest[HMAC_SHA1_DIGEST_SIZE])
{
	SHA1_CTX ctx;
	uint8_t k[SHA1_BLOCK_SIZE];
	uint8_t pad[SHA1_BLOCK_SIZE];
	uint8_t inner[HMAC_SHA1_DIGEST_SIZE];
	size_t i;

	/* normalise the key to exactly one block */
	memset(k, 0, sizeof(k));
	if (keylen > SHA1_BLOCK_SIZE) {
		SHA1Init(&ctx);
		SHA1Update(&ctx, key, keylen);
		SHA1Final(k, &ctx);
	}
	else {
		memcpy(k, key, keylen);
	}

	/* inner: SHA1((K ^ ipad) || data) */
	for (i = 0; i < SHA1_BLOCK_SIZE; i++)
		pad[i] = k[i] ^ 0x36;

	SHA1Init(&ctx);
	SHA1Update(&ctx, pad, sizeof(pad));
	SHA1Update(&ctx, data, len);
	SHA1Final(inner, &ctx);

	/* outer: SHA1((K ^ opad) || inner) */
	for (i = 0; i < SHA1_BLOCK_SIZE; i++)
		pad[i] = k[i] ^ 0x5C;

	SHA1Init(&ctx);
	SHA1Update(&ctx, pad, sizeof(pad));
	SHA1Update(&ctx, inner, sizeof(inner));
	SHA1Final(digest, &ctx);

	memset(k, 0, sizeof(k));
	memset(pad, 0, sizeof(pad));
}
