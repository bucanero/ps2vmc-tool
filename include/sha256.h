/*
 * SHA-256 in C
 *
 * Implemented from FIPS PUB 180-4 for PS1VMC Tool, to sign .mcx memory card
 * images without pulling in a full crypto library.
 *
 * Test vectors (FIPS PUB 180-2):
 *   ""     E3B0C442 98FC1C14 9AFBF4C8 996FB924 27AE41E4 649B934C A495991B 7852B855
 *   "abc"  BA7816BF 8F01CFEA 414140DE 5DAE2223 B00361A3 96177A9C B410FF61 F20015AD
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#ifndef SHA256_H
#define SHA256_H

#include <stdint.h>
#include <stddef.h>

#define SHA256_DIGEST_SIZE 32
#define SHA256_BLOCK_SIZE  64

typedef struct
{
    uint32_t state[8];
    uint64_t bitcount;
    uint8_t  buffer[SHA256_BLOCK_SIZE];
    size_t   buflen;
} SHA256_CTX;

void SHA256Init(SHA256_CTX *ctx);
void SHA256Update(SHA256_CTX *ctx, const uint8_t *data, size_t len);
void SHA256Final(uint8_t digest[SHA256_DIGEST_SIZE], SHA256_CTX *ctx);

/* One-shot helper: digest `len` bytes of `data`. */
void SHA256(const uint8_t *data, size_t len, uint8_t digest[SHA256_DIGEST_SIZE]);

#endif
