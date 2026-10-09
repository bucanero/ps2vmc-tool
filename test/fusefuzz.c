/*
 * Random operations through ps2fuse.c's handlers, checked against an
 * in-memory model after every step and again after reloading from disk:
 *     fusefuzz <card copy> <steps> <seed>
 */
#define main ps2fuse_main
#include "ps2fuse.c"
#undef main

#define NF 10
#define MAXSZ 40000
static uint8_t model[NF][MAXSZ];
static int msize[NF];          /* -1: does not exist */
static int mdir[NF];           /* 0: /FZA  1: /FZB */
static char mname[NF][32];
static struct fuse_file_info fi;

static void path(int i, char *p) { snprintf(p, 64, "/FZ%c/%.31s", 'A' + mdir[i], mname[i]); }

static int load(const char *f)
{
	free(image_data);
	if (realpath(f, image_path) == NULL || read_buffer(image_path, &image_data, &image_size) < 0) return -1;
	return mcio_init(image_data, image_size);
}

static int verify(const char *when, int step)
{
	static uint8_t buf[MAXSZ + 100];
	char p[64];
	struct stat st;
	for (int i = 0; i < NF; i++) {
		path(i, p);
		int r = ps2_getattr(p, &st, NULL);
		if (msize[i] < 0) {
			if (r != -ENOENT) { printf("%s step %d: %s should not exist (%d)\n", when, step, p, r); return 1; }
			continue;
		}
		if (r || st.st_size != msize[i]) { printf("%s step %d: %s size %lld want %d (%d)\n", when, step, p, (long long)st.st_size, msize[i], r); return 1; }
		r = ps2_read(p, (char *)buf, sizeof(buf), 0, &fi);
		if (r != msize[i] || memcmp(buf, model[i], msize[i])) { printf("%s step %d: %s content mismatch (read %d)\n", when, step, p, r); return 1; }
	}
	return 0;
}

int main(int argc, char **argv)
{
	if (argc != 4) { printf("usage: %s <card copy> <steps> <seed>\n", argv[0]); return 2; }
	int steps = atoi(argv[2]), seed = atoi(argv[3]);
	char p[64], q[64];
	static uint8_t data[MAXSZ];
	int free0, r;

	srand(seed);
	options.write = 1;
	if (load(argv[1])) { printf("load failed\n"); return 2; }
	ps2_mkdir("/FZA", 0755);
	ps2_mkdir("/FZB", 0755);
	{ struct statvfs sv; ps2_statfs("/", &sv); free0 = sv.f_bfree; }

	for (int i = 0; i < NF; i++) { msize[i] = -1; mdir[i] = i & 1; snprintf(mname[i], 32, "file%02d.bin", i); }

	for (int s = 0; s < steps; s++) {
		int i = rand() % NF, op = rand() % 7;
		path(i, p);
		if (msize[i] < 0) op = 0;
		switch (op) {
		case 0: /* create (or recreate) and write whole */
			if (msize[i] >= 0) { ps2_unlink(p); msize[i] = -1; }
			{ int n = rand() % MAXSZ; for (int k = 0; k < n; k++) data[k] = rand();
			  if ((r = ps2_create(p, 0644, &fi))) { printf("create %s: %d\n", p, r); return 1; }
			  msize[i] = 0;
			  for (int off = 0; off < n; off += 4096) { int c = n - off < 4096 ? n - off : 4096;
			    if ((r = ps2_write(p, (char *)data + off, c, off, &fi)) != c) { printf("write %s: %d\n", p, r); return 1; } }
			  memcpy(model[i], data, n); msize[i] = n; ps2_flush(p, &fi); }
			break;
		case 1: case 2: /* random write inside or past the end */
			{ int off = rand() % (MAXSZ - 1), n = 1 + rand() % (MAXSZ - off); if (n > 9000) n = 9000;
			  for (int k = 0; k < n; k++) data[k] = rand();
			  if ((r = ps2_write(p, (char *)data, n, off, &fi)) != n) { printf("step %d write %s %d@%d: %d\n", s, p, n, off, r); return 1; }
			  if (off > msize[i]) memset(model[i] + msize[i], 0, off - msize[i]);
			  memcpy(model[i] + off, data, n); if (off + n > msize[i]) msize[i] = off + n; }
			break;
		case 3: /* truncate */
			{ int n = rand() % MAXSZ;
			  if ((r = ps2_truncate(p, n, NULL))) { printf("step %d truncate %s %d: %d\n", s, p, n, r); return 1; }
			  if (n > msize[i]) memset(model[i] + msize[i], 0, n - msize[i]);
			  msize[i] = n; }
			break;
		case 4: /* rename in place, sometimes over another file in the same folder */
			{ int j = rand() % NF;
			  if (j != i && mdir[j] == mdir[i]) {
				path(j, q);
				if ((r = ps2_rename(p, q, 0))) { printf("step %d rename %s -> %s: %d\n", s, p, q, r); return 1; }
				memcpy(model[j], model[i], msize[i]); msize[j] = msize[i]; msize[i] = -1;
			  } else {
				char nn[32]; snprintf(nn, 32, "r%d-%02d.bin", s, i);
				snprintf(q, 64, "/FZ%c/%s", 'A' + mdir[i], nn);
				if ((r = ps2_rename(p, q, 0))) { printf("step %d rename %s -> %s: %d\n", s, p, q, r); return 1; }
				strcpy(mname[i], nn);
			  } }
			break;
		case 5: /* delete */
			if ((r = ps2_unlink(p))) { printf("step %d unlink %s: %d\n", s, p, r); return 1; }
			msize[i] = -1;
			break;
		case 6: /* save to disk and reload, as a remount would */
			ps2_fsync(p, 0, &fi);
			if (load(argv[1])) { printf("reload failed\n"); return 1; }
			break;
		}
		if (verify("live", s)) return 1;
	}

	ps2_fsync("/", 0, &fi);
	if (load(argv[1]) || verify("reloaded", steps)) return 1;

	for (int i = 0; i < NF; i++) if (msize[i] >= 0) { path(i, p); ps2_unlink(p); }
	ps2_rmdir("/FZA"); ps2_rmdir("/FZB");
	ps2_fsync("/", 0, &fi);
	{ struct statvfs sv; ps2_statfs("/", &sv);
	  printf("seed %d: %d steps OK, free %d KB before, %d KB after cleanup (+ folder slots)\n", seed, steps, free0, (int)sv.f_bfree); }
	return 0;
}
