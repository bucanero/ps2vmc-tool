/*
 * psv_resign.c - signatures for PS3 .PSV saves and PSP/Vita .VMP memory cards
 *
 * Both formats carry a 20-byte signature produced the same way: a salt is
 * derived from a seed stored in the file, then used as the HMAC-SHA1 key over
 * the whole file with the signature field zeroed. Only the offsets differ:
 *
 *     .psv   seed 0x08, signature 0x1C, PS1 or PS2 derivation per byte 0x3C
 *     .vmp   seed 0x0C, signature 0x20, always the PS1 derivation
 *
 * Based on ps3-psvresigner and MCR2VMP by @dots_tb, as carried in
 * apollo-ps4 by Bucanero:
 *   https://github.com/bucanero/apollo-ps4/blob/main/source/psv_resign.c
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
#include <inttypes.h>

#include "aes.h"
#include "hmac.h"
#include "util.h"
#include "psv_resign.h"

#define PSV_TYPE_PS1    0x01
#define PSV_TYPE_PS2    0x02
#define PSV_SEED_OFFSET 0x08
#define PSV_HASH_OFFSET 0x1C
#define PSV_TYPE_OFFSET 0x3C
#define VMP_SEED_OFFSET 0x0C
#define VMP_HASH_OFFSET 0x20
#define VMP_SIZE        0x20080

static const uint8_t psv_ps2key[0x10] = {
	0xEA, 0x02, 0xCE, 0xEF, 0x5B, 0xB4, 0xD2, 0x99, 0x8F, 0x61, 0x19, 0x10, 0xD7, 0x7F, 0x51, 0xC6
};

static const uint8_t psv_ps1key[0x10] = {
	0xAB, 0x5A, 0xBC, 0x9F, 0xC1, 0xF4, 0x9D, 0xE6, 0xA0, 0x51, 0xDB, 0xAE, 0xFA, 0x51, 0x88, 0x59
};

static const uint8_t psv_iv[0x10] = {
	0xB3, 0x0F, 0xFE, 0xED, 0xB7, 0xDC, 0x5E, 0xB7, 0x13, 0x3D, 0xA6, 0x0D, 0x1B, 0x6B, 0x2C, 0xDC
};

static void XorWithIv(uint8_t *buf, const uint8_t *iv)
{
	for (int i = 0; i < 0x10; i++)
		buf[i] ^= iv[i];
}

/*
 * Derive the 0x40-byte HMAC key from the seed, then sign `input` in place.
 * `dest` points at the signature field inside `input`.
 */
static void generateHash(const uint8_t *input, const uint8_t *salt_seed, uint8_t *dest, size_t sz, uint8_t type)
{
	struct AES_ctx aes_ctx;
	uint8_t salt[0x40];
	uint8_t work_buf[0x14];

	memset(salt, 0, sizeof(salt));

	if (type == PSV_TYPE_PS1) {
		/* one ECB decrypt and one ECB encrypt of the seed's first block */
		memcpy(work_buf, salt_seed, 0x10);
		AES_init_ctx(&aes_ctx, psv_ps1key);
		AES_ECB_decrypt(&aes_ctx, work_buf);
		memcpy(salt, work_buf, 0x10);

		memcpy(work_buf, salt_seed, 0x10);
		AES_init_ctx(&aes_ctx, psv_ps1key);
		AES_ECB_encrypt(&aes_ctx, work_buf);
		memcpy(salt + 0x10, work_buf, 0x10);

		XorWithIv(salt, psv_iv);

		/* the seed's remaining 4 bytes, padded with 0xFF, xored into block 2 */
		memset(work_buf, 0xFF, sizeof(work_buf));
		memcpy(work_buf, salt_seed + 0x10, 0x4);
		XorWithIv(salt + 0x10, work_buf);
	}
	else if (type == PSV_TYPE_PS2) {
		memcpy(salt, salt_seed, 0x14);
		AES_init_ctx_iv(&aes_ctx, psv_ps2key, psv_iv);
		AES_CBC_decrypt_buffer(&aes_ctx, salt, sizeof(salt));
	}
	else {
		fprintf(stderr, "Error: unknown PSV save type %d\n", type);
		return;
	}

	memset(salt + 0x14, 0, sizeof(salt) - 0x14);

	/* The signature is HMAC-SHA1 over the whole file, keyed by the salt, with
	 * the signature field itself zeroed. The salt is one SHA-1 block, so no
	 * key normalisation happens. */
	memset(dest, 0, 0x14);
	hmac_sha1(salt, sizeof(salt), input, sz, dest);
}

int psv_verify(uint8_t *psv, size_t len)
{
	uint8_t stored[0x14], computed[0x14];
	int i, signed_at_all = 0;

	if (len < 0x84 || memcmp(psv, "\0VSP", 4) != 0)
		return PSV_SIG_UNKNOWN;

	if (psv[PSV_TYPE_OFFSET] != PSV_TYPE_PS1 &&
	    psv[PSV_TYPE_OFFSET] != PSV_TYPE_PS2)
		return PSV_SIG_UNKNOWN;

	memcpy(stored, psv + PSV_HASH_OFFSET, sizeof(stored));

	for (i = 0; i < (int)sizeof(stored); i++)
		if (stored[i]) {
			signed_at_all = 1;
			break;
		}

	if (!signed_at_all)
		return PSV_SIG_UNSIGNED;

	/* generateHash() writes into the file's own signature field, which is
	 * also what it has to hash as zeros. Let it, then put the original back
	 * so the caller's buffer comes out exactly as it went in. */
	generateHash(psv, psv + PSV_SEED_OFFSET, psv + PSV_HASH_OFFSET, len,
		     psv[PSV_TYPE_OFFSET]);
	memcpy(computed, psv + PSV_HASH_OFFSET, sizeof(computed));
	memcpy(psv + PSV_HASH_OFFSET, stored, sizeof(stored));

	return memcmp(stored, computed, sizeof(stored)) == 0 ? PSV_SIG_OK
							     : PSV_SIG_BAD;
}

int psv_resign(const char *src_psv)
{
	size_t sz;
	uint8_t *input;

	if (read_buffer(src_psv, &input, &sz) < 0) {
		fprintf(stderr, "Error: can't open PSV file '%s'\n", src_psv);
		return 0;
	}

	if (sz < 0x84 || memcmp(input, "\0VSP", 4) != 0) {
		fprintf(stderr, "Error: '%s' is not a PSV file\n", src_psv);
		free(input);
		return 0;
	}

	generateHash(input, input + PSV_SEED_OFFSET, input + PSV_HASH_OFFSET, sz, input[PSV_TYPE_OFFSET]);

	if (write_buffer(src_psv, input, sz) < 0) {
		fprintf(stderr, "Error: can't write PSV file '%s'\n", src_psv);
		free(input);
		return 0;
	}

	free(input);
	return 1;
}

int vmp_resign(const char *src_vmp)
{
	size_t sz;
	uint8_t *input;

	if (read_buffer(src_vmp, &input, &sz) < 0) {
		fprintf(stderr, "Error: can't open VMP file '%s'\n", src_vmp);
		return 0;
	}

	if (sz != VMP_SIZE || memcmp(input, "\0PMV", 4) != 0) {
		fprintf(stderr, "Error: '%s' is not a VMP file\n", src_vmp);
		free(input);
		return 0;
	}

	/* a VMP always uses the PS1 derivation, whatever the card holds */
	generateHash(input, input + VMP_SEED_OFFSET, input + VMP_HASH_OFFSET, sz, PSV_TYPE_PS1);

	if (write_buffer(src_vmp, input, sz) < 0) {
		fprintf(stderr, "Error: can't write VMP file '%s'\n", src_vmp);
		free(input);
		return 0;
	}

	free(input);
	return 1;
}
