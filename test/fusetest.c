/*
 * Drives ps2fuse.c's handlers directly, without a kernel mount, against a
 * copy of samples/ps2card.vmc: make fuse-test
 */
#define main ps2fuse_main
#include "ps2fuse.c"
#undef main

static int fails = 0;
#define CHECK(cond, ...) do { if (!(cond)) { fails++; printf("FAIL %s:%d: ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } else { printf("ok   %s\n", #cond); } } while (0)

static struct fuse_file_info fi;

static off_t fsize(const char *p) { struct stat st; return ps2_getattr(p, &st, NULL) ? -1 : st.st_size; }
static int exists(const char *p) { struct stat st; return ps2_getattr(p, &st, NULL) == 0; }
static mode_t fmode(const char *p) { struct stat st; ps2_getattr(p, &st, NULL); return st.st_mode; }

static int put(const char *p, const uint8_t *buf, size_t len, size_t chunk)
{
	int r = ps2_create(p, 0644, &fi);
	if (r) return r;
	for (size_t off = 0; off < len; off += chunk) {
		size_t n = (len - off < chunk) ? len - off : chunk;
		r = ps2_write(p, (const char *)buf + off, n, off, &fi);
		if (r != (int)n) return r < 0 ? r : -EIO;
	}
	return ps2_flush(p, &fi);
}

static int get(const char *p, uint8_t *buf, size_t len)
{
	return ps2_read(p, (char *)buf, len, 0, &fi);
}

static int load(const char *path)
{
	free(image_data);
	if (realpath(path, image_path) == NULL || read_buffer(image_path, &image_data, &image_size) < 0)
		return -1;
	return mcio_init(image_data, image_size);
}

static int free_kb(void) { struct statvfs sv; ps2_statfs("/", &sv); return (int)sv.f_bfree; }

int main(int argc, char **argv)
{
	uint8_t a[6000], b[6000];
	int i, r, free0;

	(void) argc;
	options.write = 1;
	CHECK(load(argv[1]) == 0, "load");
	free0 = free_kb();
	printf("free at start: %d KB\n", free0);

	for (i = 0; i < 6000; i++) a[i] = (uint8_t)(i * 7 + 3);

	/* create, write in pieces, read back */
	CHECK(ps2_mkdir("/TESTDIR", 0755) == 0, "mkdir");
	CHECK(ps2_mkdir("/TESTDIR", 0755) == -EEXIST, "mkdir again");
	CHECK(put("/TESTDIR/a.bin", a, 3000, 700) == 0, "put a");
	CHECK(fsize("/TESTDIR/a.bin") == 3000, "size %lld", (long long)fsize("/TESTDIR/a.bin"));
	memset(b, 0xAA, sizeof(b));
	CHECK(get("/TESTDIR/a.bin", b, 6000) == 3000 && !memcmp(a, b, 3000), "read a");

	/* overwrite in the middle */
	CHECK(ps2_write("/TESTDIR/a.bin", "XYZ", 3, 1000, &fi) == 3, "overwrite");
	get("/TESTDIR/a.bin", b, 6000);
	CHECK(!memcmp(b + 1000, "XYZ", 3) && !memcmp(a, b, 1000) && !memcmp(a + 1003, b + 1003, 1997), "overwrite content");
	memcpy(a + 1000, "XYZ", 3);

	/* write past the end leaves zeros in the gap */
	CHECK(ps2_write("/TESTDIR/a.bin", (char *)a, 100, 5000, &fi) == 100, "gap write");
	CHECK(fsize("/TESTDIR/a.bin") == 5100, "gap size %lld", (long long)fsize("/TESTDIR/a.bin"));
	get("/TESTDIR/a.bin", b, 6000);
	{ int z = 1; for (i = 3000; i < 5000; i++) if (b[i]) z = 0; CHECK(z && !memcmp(b + 5000, a, 100), "gap zero-filled"); }

	/* truncate down, to zero, and up */
	CHECK(ps2_truncate("/TESTDIR/a.bin", 1500, NULL) == 0, "truncate 1500");
	CHECK(fsize("/TESTDIR/a.bin") == 1500, "size 1500");
	memset(b, 0xAA, sizeof(b));
	CHECK(get("/TESTDIR/a.bin", b, 6000) == 1500 && !memcmp(a, b, 1500), "content after shrink");
	CHECK(ps2_truncate("/TESTDIR/a.bin", 0, NULL) == 0 && fsize("/TESTDIR/a.bin") == 0, "truncate 0");
	CHECK(ps2_truncate("/TESTDIR/a.bin", 2048, NULL) == 0 && fsize("/TESTDIR/a.bin") == 2048, "truncate grow");
	get("/TESTDIR/a.bin", b, 6000);
	{ int z = 1; for (i = 0; i < 2048; i++) if (b[i]) z = 0; CHECK(z, "grown file is zeros"); }

	/* empty file gets the closed attribute */
	CHECK(ps2_create("/TESTDIR/empty", 0644, &fi) == 0, "create empty");
	{ struct io_dirent d; mcio_mcStat("/TESTDIR/empty", &d); CHECK(d.stat.mode & sceMcFileAttrClosed, "empty closed, mode %04x", d.stat.mode); }
	{ struct io_dirent d; mcio_mcStat("/TESTDIR/a.bin", &d); CHECK(d.stat.mode & sceMcFileAttrClosed, "a.bin closed, mode %04x", d.stat.mode); }

	/* rename: in place, over a file, across folders, folder itself */
	CHECK(ps2_rename("/TESTDIR/a.bin", "/TESTDIR/b.bin", 0) == 0, "rename");
	CHECK(!exists("/TESTDIR/a.bin") && fsize("/TESTDIR/b.bin") == 2048, "renamed");
	CHECK(put("/TESTDIR/c.bin", a, 500, 500) == 0, "put c");
	CHECK(ps2_rename("/TESTDIR/c.bin", "/TESTDIR/b.bin", RENAME_NOREPLACE) == -EEXIST, "noreplace");
	CHECK(ps2_rename("/TESTDIR/c.bin", "/TESTDIR/b.bin", 0) == 0, "rename over");
	CHECK(!exists("/TESTDIR/c.bin") && fsize("/TESTDIR/b.bin") == 500, "replaced");
	CHECK(ps2_rename("/TESTDIR/b.bin", "/b.bin", 0) == -EXDEV, "cross-dir EXDEV");
	CHECK(ps2_rename("/TESTDIR/b.bin", "/TESTDIR/0123456789012345678901234567890123", 0) == -ENAMETOOLONG, "long name");
	CHECK(ps2_rename("/TESTDIR", "/TESTDIR2", 0) == 0, "rename dir");
	CHECK(!exists("/TESTDIR") && fsize("/TESTDIR2/b.bin") == 500, "dir renamed, contents reachable");
	{ uint8_t d[600]; CHECK(get("/TESTDIR2/b.bin", d, 600) == 500 && !memcmp(a, d, 500), "content after dir rename"); }

	/* names */
	CHECK(ps2_create("/TESTDIR2/._b.bin", 0644, &fi) == -EACCES, "appledouble refused");
	CHECK(ps2_create("/TESTDIR2/.DS_Store", 0644, &fi) == -EACCES, "DS_Store refused");
	CHECK(ps2_mkdir("/0123456789012345678901234567890123", 0755) == -ENAMETOOLONG, "long dir name");
	CHECK(ps2_mkdir("/0123456789012345678901234567890", 0755) == 0, "31-char name");
	CHECK(exists("/0123456789012345678901234567890"), "31-char exists");

	/* chmod and utimens */
	CHECK(ps2_chmod("/TESTDIR2/b.bin", 0444, NULL) == 0 && !(fmode("/TESTDIR2/b.bin") & 0200), "chmod -w");
	CHECK(ps2_open("/TESTDIR2/b.bin", &(struct fuse_file_info){ .flags = O_WRONLY }) == -EACCES, "open ro file for write");
	CHECK(ps2_chmod("/TESTDIR2/b.bin", 0644, NULL) == 0 && (fmode("/TESTDIR2/b.bin") & 0200), "chmod +w");
	{ struct io_dirent d; mcio_mcStat("/TESTDIR2/b.bin", &d); CHECK(d.stat.mode & sceMcFileAttrExecutable, "x kept"); }
	{
		struct timespec tv[2] = { { 0, UTIME_OMIT }, { 1188691200, 0 } }; /* 2007-09-02 00:00:00 UTC */
		struct stat st;
		CHECK(ps2_utimens("/TESTDIR2/b.bin", tv, NULL) == 0, "utimens");
		ps2_getattr("/TESTDIR2/b.bin", &st, NULL);
		CHECK(st.st_mtime == 1188691200, "mtime %ld", (long)st.st_mtime);
		/* stored as the card keeps it: Japan time, nine hours ahead */
		struct io_dirent d;
		mcio_mcStat("/TESTDIR2/b.bin", &d);
		CHECK(d.stat.mtime.Year == 2007 && d.stat.mtime.Month == 9 && d.stat.mtime.Day == 2 &&
		      d.stat.mtime.Hour == 9 && d.stat.mtime.Min == 0, "raw mtime %04d-%02d-%02d %02d:%02d",
		      d.stat.mtime.Year, d.stat.mtime.Month, d.stat.mtime.Day, d.stat.mtime.Hour, d.stat.mtime.Min);
	}
	/* a file just written reads back as now, not nine hours off */
	{
		struct stat st;
		CHECK(put("/TESTDIR2/now.bin", a, 10, 10) == 0, "put now");
		ps2_getattr("/TESTDIR2/now.bin", &st, NULL);
		CHECK(labs((long)(st.st_mtime - time(NULL))) < 5, "new file mtime off by %ld s", (long)(st.st_mtime - time(NULL)));
		ps2_unlink("/TESTDIR2/now.bin");
	}

	/* unlink and rmdir */
	CHECK(ps2_rmdir("/TESTDIR2") == -ENOTEMPTY, "rmdir non-empty");
	CHECK(ps2_unlink("/TESTDIR2") == -EISDIR, "unlink dir");
	CHECK(ps2_rmdir("/TESTDIR2/b.bin") == -ENOTDIR, "rmdir file");
	CHECK(ps2_unlink("/TESTDIR2/b.bin") == 0 && ps2_unlink("/TESTDIR2/empty") == 0, "unlink");
	CHECK(ps2_rmdir("/TESTDIR2") == 0 && !exists("/TESTDIR2"), "rmdir");
	CHECK(ps2_rmdir("/0123456789012345678901234567890") == 0, "rmdir 31");

	/* fill the card, then give it all back */
	{
		static uint8_t big[64 * 1024];
		char p[64];
		int n = 0;
		free0 = free_kb();
		CHECK(ps2_mkdir("/FILL", 0755) == 0, "mkdir fill");
		for (;;) {
			snprintf(p, sizeof(p), "/FILL/f%03d", n);
			r = put(p, big, sizeof(big), 4096);
			if (r) break;
			n++;
		}
		printf("filled %d x 64 KB, then %d (%s)\n", n, r, strerror(-r));
		CHECK(r == -ENOSPC, "full card reports ENOSPC");
		CHECK(free_kb() < 64, "free %d KB", free_kb());
		ps2_unlink(p);
		while (n--) { snprintf(p, sizeof(p), "/FILL/f%03d", n); ps2_unlink(p); }
		CHECK(ps2_rmdir("/FILL") == 0, "rmdir fill");
		CHECK(free_kb() == free0, "free back to %d, is %d", free0, free_kb());
	}

	/* copy a save folder the way cp would: read each file through the
	 * mount, write it into a new folder in 4 KB pieces, compare */
	{
		const char *names[] = { "icon.sys", "BESLES-50325", "PAYNE.ICO", "invsave.inv", NULL };
		static uint8_t src[256 * 1024], dst[256 * 1024];
		char from[64], to[64];
		CHECK(ps2_mkdir("/COPY-50325", 0755) == 0, "mkdir copy");
		for (i = 0; names[i]; i++) {
			snprintf(from, sizeof(from), "/BESLES-50325/%s", names[i]);
			snprintf(to, sizeof(to), "/COPY-50325/%s", names[i]);
			r = get(from, src, sizeof(src));
			CHECK(r > 0 && put(to, src, r, 4096) == 0, "copy %s", names[i]);
			CHECK(get(to, dst, sizeof(dst)) == r && !memcmp(src, dst, r), "compare %s", names[i]);
		}
	}

	CHECK(ps2_fsync("/", 0, &fi) == 0 && image_dirty == 0, "saved");

	/* everything above survives a fresh load from disk */
	CHECK(load(argv[1]) == 0, "reload");
	CHECK(!exists("/TESTDIR2") && !exists("/FILL"), "removed dirs stay removed");
	CHECK(fsize("/COPY-50325/invsave.inv") == 143640, "copy present after reload");

	printf("\n%s: %d failure(s)\n", fails ? "FAILED" : "PASSED", fails);
	return fails != 0;
}
