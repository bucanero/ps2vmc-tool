/*
 * SHA-256 in C
 *
 * Implemented from FIPS PUB 180-4 for PS1VMC Tool, to sign .mcx memory card
 * images without pulling in a full crypto library.
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

#include "sha256.h"

#define ROR(x, n)   (((x) >> (n)) | ((x) << (32 - (n))))
#define CH(x, y, z)  (((x) & (y)) ^ (~(x) & (z)))
#define MAJ(x, y, z) (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define BSIG0(x)     (ROR(x,  2) ^ ROR(x, 13) ^ ROR(x, 22))
#define BSIG1(x)     (ROR(x,  6) ^ ROR(x, 11) ^ ROR(x, 25))
#define SSIG0(x)     (ROR(x,  7) ^ ROR(x, 18) ^ ((x) >> 3))
#define SSIG1(x)     (ROR(x, 17) ^ ROR(x, 19) ^ ((x) >> 10))

/* first 32 bits of the fractional parts of the cube roots of the first 64 primes */
static const uint32_t K[64] = {
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
};

static void SHA256Transform(uint32_t state[8], const uint8_t block[SHA256_BLOCK_SIZE])
{
	uint32_t w[64];
	uint32_t a, b, c, d, e, f, g, h, t1, t2;
	int i;

	for (i = 0; i < 16; i++)
		w[i] = ((uint32_t)block[i * 4] << 24) | ((uint32_t)block[i * 4 + 1] << 16) |
		       ((uint32_t)block[i * 4 + 2] << 8) | ((uint32_t)block[i * 4 + 3]);

	for (i = 16; i < 64; i++)
		w[i] = SSIG1(w[i - 2]) + w[i - 7] + SSIG0(w[i - 15]) + w[i - 16];

	a = state[0]; b = state[1]; c = state[2]; d = state[3];
	e = state[4]; f = state[5]; g = state[6]; h = state[7];

	for (i = 0; i < 64; i++) {
		t1 = h + BSIG1(e) + CH(e, f, g) + K[i] + w[i];
		t2 = BSIG0(a) + MAJ(a, b, c);
		h = g; g = f; f = e; e = d + t1;
		d = c; c = b; b = a; a = t1 + t2;
	}

	state[0] += a; state[1] += b; state[2] += c; state[3] += d;
	state[4] += e; state[5] += f; state[6] += g; state[7] += h;
}

void SHA256Init(SHA256_CTX *ctx)
{
	/* first 32 bits of the fractional parts of the square roots of the first 8 primes */
	ctx->state[0] = 0x6a09e667;
	ctx->state[1] = 0xbb67ae85;
	ctx->state[2] = 0x3c6ef372;
	ctx->state[3] = 0xa54ff53a;
	ctx->state[4] = 0x510e527f;
	ctx->state[5] = 0x9b05688c;
	ctx->state[6] = 0x1f83d9ab;
	ctx->state[7] = 0x5be0cd19;
	ctx->bitcount = 0;
	ctx->buflen = 0;
}

void SHA256Update(SHA256_CTX *ctx, const uint8_t *data, size_t len)
{
	size_t i = 0;

	ctx->bitcount += (uint64_t)len * 8;

	/* top up a partial block first */
	if (ctx->buflen) {
		size_t need = SHA256_BLOCK_SIZE - ctx->buflen;

		if (len < need) {
			memcpy(ctx->buffer + ctx->buflen, data, len);
			ctx->buflen += len;
			return;
		}

		memcpy(ctx->buffer + ctx->buflen, data, need);
		SHA256Transform(ctx->state, ctx->buffer);
		ctx->buflen = 0;
		i = need;
	}

	for (; i + SHA256_BLOCK_SIZE <= len; i += SHA256_BLOCK_SIZE)
		SHA256Transform(ctx->state, data + i);

	if (i < len) {
		ctx->buflen = len - i;
		memcpy(ctx->buffer, data + i, ctx->buflen);
	}
}

void SHA256Final(uint8_t digest[SHA256_DIGEST_SIZE], SHA256_CTX *ctx)
{
	uint64_t bits = ctx->bitcount;
	uint8_t pad = 0x80;
	uint8_t zero = 0x00;
	uint8_t length[8];
	int i;

	for (i = 0; i < 8; i++)
		length[i] = (uint8_t)(bits >> (56 - i * 8));

	SHA256Update(ctx, &pad, 1);
	ctx->bitcount = bits;                     /* padding is not part of the length */

	while (ctx->buflen != SHA256_BLOCK_SIZE - 8) {
		SHA256Update(ctx, &zero, 1);
		ctx->bitcount = bits;
	}

	SHA256Update(ctx, length, 8);

	for (i = 0; i < 8; i++) {
		digest[i * 4]     = (uint8_t)(ctx->state[i] >> 24);
		digest[i * 4 + 1] = (uint8_t)(ctx->state[i] >> 16);
		digest[i * 4 + 2] = (uint8_t)(ctx->state[i] >> 8);
		digest[i * 4 + 3] = (uint8_t)(ctx->state[i]);
	}

	memset(ctx, 0, sizeof(*ctx));
}

void SHA256(const uint8_t *data, size_t len, uint8_t digest[SHA256_DIGEST_SIZE])
{
	SHA256_CTX ctx;

	SHA256Init(&ctx);
	SHA256Update(&ctx, data, len);
	SHA256Final(digest, &ctx);
}
