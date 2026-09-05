#ifndef LIBRARIES_LZARI_H
#define LIBRARIES_LZARI_H

// Compress in to out using LZARI. Returns final compressed size.
int lzari(unsigned char *in, int insz, unsigned char *out, int outsz);
// Decompress in to out using LZARI. Returns final decompressed size.
int unlzari(unsigned char *in, int insz, unsigned char *out, int outsz);

#endif
