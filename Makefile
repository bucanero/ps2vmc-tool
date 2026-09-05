#
# PS1VMC Tool / PS2VMC Tool
#
# Two independent programs that share a handful of support files. Each links
# only what it actually uses: the PS1 tool carries no PS2 filesystem, and the
# PS2 tool carries no PS1 card code.
#

# GCC on Windows appends .exe, so name the targets accordingly or make would
# relink on every invocation.
ifeq ($(OS),Windows_NT)
EXE	=	.exe
endif

PS1TOOL	=	ps1vmc-tool$(EXE)
PS2TOOL	=	ps2vmc-tool$(EXE)

CC	=	gcc
# tiny-AES compiles ECB out unless asked for it, and the PSV/VMP salt
# derivation needs it.
CFLAGS	=	-g -O3 -W -I./include -I. -D_GNU_SOURCE -DECB=1

# zlib: .cbs bodies are deflate-compressed both ways, and both tools write
# their PNGs through it. Override to force the static archive, as the Windows
# builds do so the released .exe needs no zlib1.dll:
#     make ZLIB=-l:libz.a
ZLIB ?=	-lz

# libm. The icon renderer calls sqrtf/tanf/floorf/ceilf/fminf/fmaxf; macOS
# folds those into libc but Linux keeps them separate, so the link fails there
# without this. Which of them survive as real symbols depends on the compiler
# and the optimisation level - at -O0 six of them do - so this is not something
# inlining can be trusted to hide. Kept apart from ZLIB because the Windows
# builds override that one.
MATH ?=	-lm

# Shared: byte helpers, AES, and the PSV/VMP signature (HMAC-SHA1 over SHA-1)
COMMON_SRC =	src/util.c src/aes.c src/sha1.c src/hmac.c src/psv_resign.c src/ps2png.c

# PS1 only: the card format, plus SHA-256 for .mcx images
PS1_SRC	=	src/ps1main.c src/ps1card.c src/sha256.c $(COMMON_SRC)

# PS2 only: the mcio filesystem, the 3D icon decoder, and the readers for
# third-party save containers (LZARI for .max; .cbs uses zlib, see ZLIB)
PS2_SRC	=	src/main.c src/mcio.c src/ps2icon.c src/ps2render.c src/ps2save.c src/ps2blank.c \
		src/lzari.c $(COMMON_SRC)

PS1_OBJ	=	$(PS1_SRC:.c=.o)
PS2_OBJ	=	$(PS2_SRC:.c=.o)
OBJS	=	$(sort $(PS1_OBJ) $(PS2_OBJ))
DEPS	=	$(OBJS:.o=.d)

all: $(PS1TOOL) $(PS2TOOL)

ps1: $(PS1TOOL)
ps2: $(PS2TOOL)

$(PS1TOOL): $(PS1_OBJ)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS) $(ZLIB) $(MATH)

$(PS2TOOL): $(PS2_OBJ)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS) $(ZLIB) $(MATH)

# -MMD -MP records which headers each object used, so editing a header
# rebuilds whatever depends on it instead of leaving a stale object behind.
%.o: %.c Makefile
	$(CC) $(CFLAGS) -MMD -MP -c -o $@ $<

-include $(DEPS)

clean:
	-rm -f $(OBJS) $(DEPS) $(PS1TOOL) $(PS2TOOL)

.PHONY: all ps1 ps2 clean
