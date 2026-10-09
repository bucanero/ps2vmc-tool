/*
 * PS2VMC FUSE - mount a PS2 virtual memory card as a filesystem
 *
 * The card image is read once into memory and mcio works on that copy.
 * Mounts are read-only unless --write is given; then every change is saved
 * back by writing a new image beside the old one and renaming it over, so the
 * file on disk is always either the old card or the new one, never half of
 * each. Saves happen when a written file is closed or synced, after each
 * directory or metadata change, and on unmount.
 *
 * mcio keeps all of its state in globals and has only a handful of file
 * handles, so the filesystem runs single-threaded and never holds an mcio
 * handle between requests: every read or write opens, seeks and closes.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#define FUSE_USE_VERSION 31
/* macFUSE swaps in its own stat types unless told otherwise; stick to the
 * portable libfuse3 API so the same code builds on Linux. */
#define FUSE_DARWIN_ENABLE_EXTENSIONS 0

#include <fuse.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>

#include "mcio.h"
#include "util.h"

#define PROGRAM_NAME    "PS2VMC-FUSE"
#define PROGRAM_VER     "2.0.0"

/* Entry names are 32 bytes on the card; keep one for the terminator. */
#define MC_NAME_MAX     31

#ifndef RENAME_NOREPLACE
#define RENAME_NOREPLACE (1 << 0)
#endif
#ifndef RENAME_EXCHANGE
#define RENAME_EXCHANGE  (1 << 1)
#endif
#ifndef ENOATTR
#define ENOATTR ENODATA
#endif

static struct {
	const char *image;
	int write;
	int show_help;
} options;

#define OPTION(t, p) { t, offsetof(typeof(options), p), 1 }
static const struct fuse_opt option_spec[] = {
	OPTION("-w", write),
	OPTION("--write", write),
	OPTION("-h", show_help),
	OPTION("--help", show_help),
	FUSE_OPT_END
};

static char image_path[PATH_MAX];
static uint8_t *image_data;
static size_t image_size;
static int image_dirty;
static time_t ps2_fs_time;

static int mc_errno(int r)
{
	switch (r) {
	case sceMcResNoEntry:		return -ENOENT;
	case sceMcResNotDir:		return -ENOTDIR;
	case sceMcResNotFile:		return -EISDIR;
	case sceMcResDeniedPermit:	return -EACCES;
	case sceMcResNotEmpty:		return -ENOTEMPTY;
	case sceMcResFullDevice:	return -ENOSPC;
	case sceMcResUpLimitHandle:	return -EMFILE;
	default:			return -EIO;
	}
}

/* Write the card to a temporary file beside the image, then rename it over:
 * a crash or a full disk leaves the previous image untouched. */
static int save_image(void)
{
	char tmp[PATH_MAX + 16];
	struct stat st;
	size_t done = 0;
	ssize_t n;
	int fd;

	if (!image_dirty)
		return 0;

	snprintf(tmp, sizeof(tmp), "%s.XXXXXX", image_path);
	fd = mkstemp(tmp);
	if (fd < 0)
		goto fail;

	if (stat(image_path, &st) == 0)
		fchmod(fd, st.st_mode & 07777);

	while (done < image_size) {
		n = write(fd, image_data + done, image_size - done);
		if (n < 0) {
			if (errno == EINTR)
				continue;
			goto fail_fd;
		}
		done += n;
	}

	if (fsync(fd) < 0)
		goto fail_fd;
	if (close(fd) < 0) {
		fd = -1;
		goto fail_fd;
	}
	if (rename(tmp, image_path) < 0) {
		fd = -1;
		goto fail_fd;
	}

	image_dirty = 0;
	return 0;

fail_fd: {
		int e = errno;
		if (fd >= 0)
			close(fd);
		unlink(tmp);
		errno = e;
	}
fail:
	fprintf(stderr, "Error: failed to save VMC file %s: %s\n", image_path, strerror(errno));
	return -EIO;
}

/* The rest of this tool reads and writes card timestamps as UTC. */
static time_t mc_time(const struct sceMcStDateTime *t)
{
	struct tm tm;

	if (t->Year == 0 || t->Month == 0 || t->Day == 0)
		return ps2_fs_time;

	memset(&tm, 0, sizeof(tm));
	tm.tm_sec = t->Sec;
	tm.tm_min = t->Min;
	tm.tm_hour = t->Hour;
	tm.tm_mday = t->Day;
	tm.tm_mon = t->Month - 1;
	tm.tm_year = t->Year - 1900;

	return timegm(&tm);
}

static void set_mc_time(struct sceMcStDateTime *t, time_t when)
{
	struct tm tm;

	gmtime_r(&when, &tm);
	t->Resv2 = 0;
	t->Sec = tm.tm_sec;
	t->Min = tm.tm_min;
	t->Hour = tm.tm_hour;
	t->Day = tm.tm_mday;
	t->Month = tm.tm_mon + 1;
	t->Year = tm.tm_year + 1900;
}

static void fill_stat(struct stat *st, const struct io_stat *s)
{
	mode_t perm = 0;

	memset(st, 0, sizeof(*st));

	if (s->mode & sceMcFileAttrReadable)
		perm |= 0444;
	if ((s->mode & sceMcFileAttrWriteable) && options.write)
		perm |= 0200;

	if (s->mode & sceMcFileAttrSubdir) {
		/* Save folders must stay searchable whatever their bits say. */
		st->st_mode = S_IFDIR | perm | 0555;
		st->st_nlink = 2;
	} else {
		/* PS2 files carry the executable bit as a matter of course; showing
		 * it would make every save file look like a program. */
		st->st_mode = S_IFREG | perm;
		st->st_nlink = 1;
		st->st_size = s->size;
		st->st_blocks = (s->size + 511) / 512;
	}

	st->st_uid = getuid();
	st->st_gid = getgid();
	st->st_ctime = mc_time(&s->ctime);
	st->st_mtime = mc_time(&s->mtime);
	st->st_atime = st->st_mtime;
#ifdef __APPLE__
	st->st_birthtime = st->st_ctime;
#endif
}

static const char *base_name(const char *path)
{
	const char *p = strrchr(path, '/');
	return p ? p + 1 : path;
}

/* Check a name about to be created on the card. */
static int check_new_name(const char *path)
{
	static const char *const junk[] = {
		".DS_Store", ".Trashes", ".fseventsd", ".Spotlight-V100",
		".TemporaryItems", ".metadata_never_index", NULL
	};
	const char *name = base_name(path);
	int i;

	if (strlen(name) > MC_NAME_MAX)
		return -ENAMETOOLONG;

	/* macOS bookkeeping would fill a card a few MB in size, and means
	 * nothing to a PS2: refuse it rather than store it. */
	if (!strncmp(name, "._", 2))
		return -EACCES;
	for (i = 0; junk[i]; i++)
		if (!strcmp(name, junk[i]))
			return -EACCES;

	return 0;
}

static int stat_entry(const char *path, struct io_dirent *dirent)
{
	int r = mcio_mcStat(path, dirent);
	return (r < 0) ? mc_errno(r) : 0;
}

/* Write len bytes at off, zero-filling any gap past the current end first:
 * mcio would otherwise leave whatever the new clusters held in the hole. */
static int write_at(const char *path, const void *buf, size_t len, off_t off, int32_t cur_size)
{
	static const uint8_t zeros[1024];
	int fd, r = 0;

	if (off + (off_t)len > INT32_MAX)
		return -EFBIG;

	fd = mcio_mcOpen(path, sceMcFileAttrWriteable | sceMcFileAttrFile);
	if (fd < 0)
		return mc_errno(fd);

	if (off > cur_size) {
		mcio_mcSeek(fd, cur_size, SEEK_SET);
		while (cur_size < off) {
			int n = (off - cur_size > (off_t)sizeof(zeros)) ? (int)sizeof(zeros) : (int)(off - cur_size);
			r = mcio_mcWrite(fd, (void *)zeros, n);
			if (r < 0)
				goto out;
			cur_size += n;
		}
	}

	if (len) {
		mcio_mcSeek(fd, (int)off, SEEK_SET);
		r = mcio_mcWrite(fd, (void *)buf, (int)len);
	}

out:
	mcio_mcClose(fd);
	return (r < 0) ? mc_errno(r) : (int)len;
}

static void *ps2_init(struct fuse_conn_info *conn, struct fuse_config *cfg)
{
	(void) conn;

	if (options.write) {
		/* Everything goes through this mount, but mcio also touches entries
		 * the kernel does not know about (parent times), so keep it short. */
		cfg->entry_timeout = 1;
		cfg->attr_timeout = 1;
		cfg->negative_timeout = 0;
	} else {
		/* The card cannot change under us, so the kernel may cache freely. */
		cfg->kernel_cache = 1;
		cfg->entry_timeout = 3600;
		cfg->attr_timeout = 3600;
		cfg->negative_timeout = 3600;
	}

	return NULL;
}

static void ps2_destroy(void *private_data)
{
	(void) private_data;

	save_image();
}

static int ps2_getattr(const char *path, struct stat *st, struct fuse_file_info *fi)
{
	struct io_dirent dirent;
	int r;

	(void) fi;

	if (strcmp(path, "/") == 0) {
		memset(st, 0, sizeof(*st));
		st->st_mode = S_IFDIR | (options.write ? 0755 : 0555);
		st->st_nlink = 2;
		st->st_uid = getuid();
		st->st_gid = getgid();
		st->st_mtime = st->st_ctime = st->st_atime = ps2_fs_time;
		return 0;
	}

	r = stat_entry(path, &dirent);
	if (r < 0)
		return r;

	fill_stat(st, &dirent.stat);
	return 0;
}

static int ps2_readdir(const char *path, void *buf, fuse_fill_dir_t filler,
		       off_t offset, struct fuse_file_info *fi,
		       enum fuse_readdir_flags flags)
{
	struct io_dirent dirent;
	struct stat st;
	int fd, r;

	(void) offset;
	(void) fi;
	(void) flags;

	fd = mcio_mcDopen(path);
	if (fd < 0)
		return mc_errno(fd);

	filler(buf, ".", NULL, 0, 0);
	filler(buf, "..", NULL, 0, 0);

	while ((r = mcio_mcDread(fd, &dirent)) > 0) {
		if (!strcmp(dirent.name, ".") || !strcmp(dirent.name, ".."))
			continue;

		fill_stat(&st, &dirent.stat);
		if (filler(buf, dirent.name, &st, 0, 0))
			break;
	}

	mcio_mcDclose(fd);
	return (r < 0) ? mc_errno(r) : 0;
}

static int ps2_open(const char *path, struct fuse_file_info *fi)
{
	struct io_dirent dirent;
	int r;

	if ((fi->flags & O_ACCMODE) != O_RDONLY) {
		if (!options.write)
			return -EROFS;
	}

	r = stat_entry(path, &dirent);
	if (r < 0)
		return r;
	if (dirent.stat.mode & sceMcFileAttrSubdir)
		return -EISDIR;
	if ((fi->flags & O_ACCMODE) != O_RDONLY && !(dirent.stat.mode & sceMcFileAttrWriteable))
		return -EACCES;

	fi->keep_cache = !options.write;
	return 0;
}

static int ps2_read(const char *path, char *buf, size_t size, off_t offset,
		    struct fuse_file_info *fi)
{
	int fd, r;

	(void) fi;

	fd = mcio_mcOpen(path, sceMcFileAttrReadable | sceMcFileAttrFile);
	if (fd < 0)
		return mc_errno(fd);

	r = mcio_mcSeek(fd, (int)offset, SEEK_SET);
	if (r >= 0)
		r = mcio_mcRead(fd, buf, (int)size);

	mcio_mcClose(fd);
	return (r < 0) ? mc_errno(r) : r;
}

static int ps2_write(const char *path, const char *buf, size_t size, off_t offset,
		     struct fuse_file_info *fi)
{
	struct io_dirent dirent;
	int r;

	(void) fi;

	if (!options.write)
		return -EROFS;

	r = stat_entry(path, &dirent);
	if (r < 0)
		return r;

	image_dirty = 1;
	return write_at(path, buf, size, offset, dirent.stat.size);
}

static int ps2_create(const char *path, mode_t mode, struct fuse_file_info *fi)
{
	struct io_dirent dirent;
	char dummy = 0;
	int fd, r;

	(void) mode;
	(void) fi;

	if (!options.write)
		return -EROFS;

	r = check_new_name(path);
	if (r < 0)
		return r;
	if (mcio_mcStat(path, &dirent) == 0)
		return -EEXIST;

	image_dirty = 1;
	fd = mcio_mcOpen(path, sceMcFileCreateFile | sceMcFileAttrWriteable | sceMcFileAttrFile);
	if (fd < 0)
		return mc_errno(fd);

	/* An empty write still closes the entry properly, setting the "closed"
	 * attribute a PS2 expects on every finished file. */
	r = mcio_mcWrite(fd, &dummy, 0);
	mcio_mcClose(fd);

	return (r < 0) ? mc_errno(r) : 0;
}

static int ps2_truncate(const char *path, off_t size, struct fuse_file_info *fi)
{
	struct io_dirent dirent;
	uint8_t *keep = NULL;
	char dummy = 0;
	int fd, r;

	(void) fi;

	if (!options.write)
		return -EROFS;
	if (size < 0)
		return -EINVAL;
	if (size > INT32_MAX)
		return -EFBIG;

	r = stat_entry(path, &dirent);
	if (r < 0)
		return r;
	if (dirent.stat.mode & sceMcFileAttrSubdir)
		return -EISDIR;
	if (!(dirent.stat.mode & sceMcFileAttrWriteable))
		return -EACCES;
	if ((uint32_t)size == dirent.stat.size)
		return 0;

	image_dirty = 1;

	if ((uint32_t)size > dirent.stat.size) {
		r = write_at(path, NULL, 0, size, dirent.stat.size);
		return (r < 0) ? r : save_image();
	}

	/* mcio cannot shorten a file: keep the head, recreate the entry (which
	 * frees the old clusters), write the head back, and restore the
	 * attributes and creation time the recreated entry lost. */
	if (size > 0) {
		keep = malloc(size);
		if (keep == NULL)
			return -ENOMEM;

		fd = mcio_mcOpen(path, sceMcFileAttrReadable | sceMcFileAttrFile);
		if (fd < 0) {
			free(keep);
			return mc_errno(fd);
		}
		r = mcio_mcRead(fd, keep, (int)size);
		mcio_mcClose(fd);
		if (r != size) {
			free(keep);
			return (r < 0) ? mc_errno(r) : -EIO;
		}
	}

	fd = mcio_mcOpen(path, sceMcFileCreateFile | sceMcFileAttrWriteable | sceMcFileAttrFile);
	if (fd < 0) {
		free(keep);
		return mc_errno(fd);
	}
	r = mcio_mcWrite(fd, keep ? (void *)keep : (void *)&dummy, (int)size);
	mcio_mcClose(fd);
	free(keep);
	if (r < 0)
		return mc_errno(r);

	set_mc_time(&dirent.stat.mtime, time(NULL));
	r = mcio_mcSetStat(path, &dirent);
	if (r < 0)
		return mc_errno(r);

	return save_image();
}

static int ps2_mkdir(const char *path, mode_t mode)
{
	struct io_dirent dirent;
	int r;

	(void) mode;

	if (!options.write)
		return -EROFS;

	r = check_new_name(path);
	if (r < 0)
		return r;
	if (mcio_mcStat(path, &dirent) == 0)
		return -EEXIST;

	image_dirty = 1;
	r = mcio_mcMkDir(path);
	if (r < 0)
		return mc_errno(r);

	return save_image();
}

static int ps2_unlink(const char *path)
{
	struct io_dirent dirent;
	int r;

	if (!options.write)
		return -EROFS;

	r = stat_entry(path, &dirent);
	if (r < 0)
		return r;
	if (dirent.stat.mode & sceMcFileAttrSubdir)
		return -EISDIR;

	image_dirty = 1;
	r = mcio_mcRemove(path);
	if (r < 0)
		return mc_errno(r);

	return save_image();
}

static int ps2_rmdir(const char *path)
{
	struct io_dirent dirent;
	int r;

	if (!options.write)
		return -EROFS;
	if (strcmp(path, "/") == 0)
		return -EBUSY;

	r = stat_entry(path, &dirent);
	if (r < 0)
		return r;
	if (!(dirent.stat.mode & sceMcFileAttrSubdir))
		return -ENOTDIR;

	image_dirty = 1;
	r = mcio_mcRmDir(path);
	if (r < 0)
		return mc_errno(r);

	return save_image();
}

static int ps2_rename(const char *from, const char *to, unsigned int flags)
{
	struct io_dirent src, dst;
	size_t dirlen;
	int r;

	if (!options.write)
		return -EROFS;
	if (flags & RENAME_EXCHANGE)
		return -EINVAL;
	if (strcmp(from, to) == 0)
		return 0;

	/* An entry can only be renamed in place; moving it to another folder
	 * would mean relinking it, so let the caller fall back to copying. */
	dirlen = base_name(from) - from;
	if (dirlen != (size_t)(base_name(to) - to) || strncmp(from, to, dirlen))
		return -EXDEV;

	r = check_new_name(to);
	if (r < 0)
		return r;

	r = stat_entry(from, &src);
	if (r < 0)
		return r;

	image_dirty = 1;

	if (mcio_mcStat(to, &dst) == 0) {
		if (flags & RENAME_NOREPLACE)
			return -EEXIST;

		if (dst.stat.mode & sceMcFileAttrSubdir) {
			if (!(src.stat.mode & sceMcFileAttrSubdir))
				return -EISDIR;
			r = mcio_mcRmDir(to);
		} else {
			if (src.stat.mode & sceMcFileAttrSubdir)
				return -ENOTDIR;
			r = mcio_mcRemove(to);
		}
		if (r < 0)
			return mc_errno(r);
	}

	r = mcio_mcRename(from, base_name(to));
	if (r < 0)
		return mc_errno(r);

	return save_image();
}

static int ps2_chmod(const char *path, mode_t mode, struct fuse_file_info *fi)
{
	struct io_dirent dirent;
	int r;

	(void) fi;

	if (!options.write)
		return -EROFS;
	if (strcmp(path, "/") == 0)
		return 0;

	r = stat_entry(path, &dirent);
	if (r < 0)
		return r;

	/* Only read and write map onto card attributes. The executable bit is
	 * left as it is, so that 'cp -p' cannot strip it from save files. */
	dirent.stat.mode &= ~(sceMcFileAttrReadable | sceMcFileAttrWriteable);
	if (mode & S_IRUSR)
		dirent.stat.mode |= sceMcFileAttrReadable;
	if (mode & S_IWUSR)
		dirent.stat.mode |= sceMcFileAttrWriteable;

	image_dirty = 1;
	r = mcio_mcSetStat(path, &dirent);
	if (r < 0)
		return mc_errno(r);

	return save_image();
}

static int ps2_chown(const char *path, uid_t uid, gid_t gid, struct fuse_file_info *fi)
{
	(void) path;
	(void) uid;
	(void) gid;
	(void) fi;

	/* Cards have no owners; accept quietly so 'cp -p' does not complain. */
	return options.write ? 0 : -EROFS;
}

static int ps2_utimens(const char *path, const struct timespec tv[2], struct fuse_file_info *fi)
{
	struct io_dirent dirent;
	int r;

	(void) fi;

	if (!options.write)
		return -EROFS;
	if (strcmp(path, "/") == 0)
		return 0;

	r = stat_entry(path, &dirent);
	if (r < 0)
		return r;

	/* The card keeps creation and modification times; there is no access
	 * time to set. */
	if (tv == NULL || tv[1].tv_nsec == UTIME_NOW)
		set_mc_time(&dirent.stat.mtime, time(NULL));
	else if (tv[1].tv_nsec != UTIME_OMIT)
		set_mc_time(&dirent.stat.mtime, tv[1].tv_sec);
	else
		return 0;

	image_dirty = 1;
	r = mcio_mcSetStat(path, &dirent);
	if (r < 0)
		return mc_errno(r);

	return save_image();
}

static int ps2_flush(const char *path, struct fuse_file_info *fi)
{
	(void) path;
	(void) fi;

	return save_image();
}

static int ps2_fsync(const char *path, int datasync, struct fuse_file_info *fi)
{
	(void) path;
	(void) datasync;
	(void) fi;

	return save_image();
}

/* FSKit asks before every lookup and listing, and treats "not implemented"
 * as a refusal, so answer it. */
static int ps2_access(const char *path, int mask)
{
	struct io_dirent dirent;
	int r;

	if (strcmp(path, "/") == 0)
		return ((mask & W_OK) && !options.write) ? -EROFS : 0;

	r = stat_entry(path, &dirent);
	if (r < 0)
		return r;

	if (mask & W_OK) {
		if (!options.write)
			return -EROFS;
		if (!(dirent.stat.mode & sceMcFileAttrWriteable))
			return -EACCES;
	}

	return 0;
}

/* Card entries carry no extended attributes. */
static int ps2_getxattr(const char *path, const char *name, char *value, size_t size)
{
	(void) path;
	(void) name;
	(void) value;
	(void) size;

	return -ENOATTR;
}

static int ps2_listxattr(const char *path, char *list, size_t size)
{
	(void) path;
	(void) list;
	(void) size;

	return 0;
}

/* The card has nowhere to keep extended attributes. Accept and drop them:
 * FSKit hands ENOTSUP back as EPERM, so refusing makes 'cp' and Finder warn
 * about every file they copy in. */
static int ps2_setxattr(const char *path, const char *name, const char *value, size_t size, int flags)
{
	(void) path;
	(void) name;
	(void) value;
	(void) size;
	(void) flags;

	return options.write ? 0 : -EROFS;
}

static int ps2_removexattr(const char *path, const char *name)
{
	(void) path;
	(void) name;

	return options.write ? -ENOATTR : -EROFS;
}

/* Nothing on a card can be a device node or a link. */
static int ps2_mknod(const char *path, mode_t mode, dev_t dev)
{
	(void) path;
	(void) mode;
	(void) dev;

	return options.write ? -EPERM : -EROFS;
}

static int ps2_link(const char *from, const char *to)
{
	(void) from;
	(void) to;

	return options.write ? -EPERM : -EROFS;
}

static int ps2_statfs(const char *path, struct statvfs *sv)
{
	int pagesize, blocksize, cardsize, cardflags, cardfree;

	(void) path;

	if (mcio_mcGetInfo(&pagesize, &blocksize, &cardsize, &cardflags) < 0)
		return -EIO;
	if (mcio_mcGetAvailableSpace(&cardfree) < 0 || cardfree < 0)
		cardfree = 0;

	memset(sv, 0, sizeof(*sv));
	sv->f_bsize = 1024;	/* one card cluster */
	sv->f_frsize = 1024;
	sv->f_blocks = cardsize / 1024;
	sv->f_bfree = cardfree / 1024;
	sv->f_bavail = sv->f_bfree;
	sv->f_namemax = MC_NAME_MAX;
	sv->f_flag = options.write ? 0 : ST_RDONLY;

	return 0;
}

static const struct fuse_operations ps2_oper = {
	.init		= ps2_init,
	.destroy	= ps2_destroy,
	.getattr	= ps2_getattr,
	.readdir	= ps2_readdir,
	.open		= ps2_open,
	.read		= ps2_read,
	.write		= ps2_write,
	.create		= ps2_create,
	.truncate	= ps2_truncate,
	.mkdir		= ps2_mkdir,
	.unlink		= ps2_unlink,
	.rmdir		= ps2_rmdir,
	.rename		= ps2_rename,
	.chmod		= ps2_chmod,
	.chown		= ps2_chown,
	.utimens	= ps2_utimens,
	.flush		= ps2_flush,
	.fsync		= ps2_fsync,
	.statfs		= ps2_statfs,
	.access		= ps2_access,
	.getxattr	= ps2_getxattr,
	.listxattr	= ps2_listxattr,
	.setxattr	= ps2_setxattr,
	.removexattr	= ps2_removexattr,
	.mknod		= ps2_mknod,
	.symlink	= ps2_link,
	.link		= ps2_link,
};

static void print_usage(const char *progname)
{
	printf("\n" PROGRAM_NAME " v" PROGRAM_VER "\n");
	printf("Mount a PS2 virtual memory card as a filesystem.\n\n");
	printf("Usage:\n%s <VMC filepath> <mountpoint> [options]\n\n", progname);
	printf("    -w, --write    allow changes, saved back to the VMC file (default: read-only)\n\n");
	printf("Unmount with 'umount <mountpoint>' (macOS) or 'fusermount3 -u <mountpoint>' (Linux).\n\n");
}

static int opt_proc(void *data, const char *arg, int key, struct fuse_args *outargs)
{
	(void) data;
	(void) outargs;

	/* The first bare argument is the card image; the next is the mountpoint,
	 * which is left for FUSE to pick up. */
	if (key == FUSE_OPT_KEY_NONOPT && options.image == NULL) {
		options.image = strdup(arg);
		return 0;
	}

	return 1;
}

int main(int argc, char *argv[])
{
	struct fuse_args args = FUSE_ARGS_INIT(argc, argv);
	char optbuf[PATH_MAX + 64];
	const char *base;
	int r;

	if (fuse_opt_parse(&args, &options, option_spec, opt_proc) == -1)
		return 1;

	if (options.show_help || options.image == NULL) {
		print_usage(argv[0]);
		if (options.show_help) {
			fuse_opt_add_arg(&args, "--help");
			args.argv[0][0] = '\0';
			fuse_main(args.argc, args.argv, &ps2_oper, NULL);
		}
		fuse_opt_free_args(&args);
		return options.show_help ? 0 : 1;
	}

	/* FUSE changes directory once mounted; keep a path that still works. */
	if (realpath(options.image, image_path) == NULL ||
	    read_buffer(image_path, &image_data, &image_size) < 0) {
		fprintf(stderr, "Error: failed to open VMC file... (%s)\n", options.image);
		return 1;
	}

	if (options.write && access(image_path, W_OK) < 0) {
		fprintf(stderr, "Error: VMC file is not writable... (%s)\n", image_path);
		return 1;
	}

	r = mcio_init(image_data, image_size);
	if (r < 0) {
		fprintf(stderr, "Error: no formatted PS2 Memory Card detected... (%d)\n", r);
		free(image_data);
		return 1;
	}

	ps2_fs_time = time(NULL);
	base = base_name(image_path);

	/* mcio is not reentrant: serve one request at a time. */
	fuse_opt_add_arg(&args, "-s");
	snprintf(optbuf, sizeof(optbuf), "-o%sfsname=ps2vmc:%s,subtype=ps2vmc",
		 options.write ? "" : "ro,", base);
	fuse_opt_add_arg(&args, optbuf);
#ifdef __APPLE__
	/* Keep Finder from asking for ._ files and extended attributes. */
	snprintf(optbuf, sizeof(optbuf), "-ovolname=%s,noappledouble,noapplexattr", base);
	fuse_opt_add_arg(&args, optbuf);
#endif

	r = fuse_main(args.argc, args.argv, &ps2_oper, NULL);

	fuse_opt_free_args(&args);
	free(image_data);
	return r;
}
