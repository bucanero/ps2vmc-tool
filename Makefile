TOOLS	=	src/main
PS1TOOLS=	src/ps1main
COMMON	=	src/util.o src/mcio.o src/ps1card.o src/aes.o src/ps2icon.o
DEPS	=	Makefile

CC	=	gcc
CFLAGS	=	-g -O3 -W -I./include -I. -D_GNU_SOURCE
#LDFLAGS =	-lz

OBJS	= $(COMMON) $(addsuffix .o, $(TOOLS))

all: $(TOOLS) $(PS1TOOLS)

$(TOOLS): %: %.o $(COMMON) $(DEPS)
	$(CC) $(CFLAGS) -o ps2vmc-tool $< $(COMMON) $(LDFLAGS)

$(PS1TOOLS): %: %.o $(COMMON) $(DEPS)
	$(CC) $(CFLAGS) -o ps1vmc-tool $< $(COMMON) $(LDFLAGS)

$(OBJS): %.o: %.c $(DEPS)
	$(CC) $(CFLAGS) -c -o $@ $<

clean:
	-rm -f $(OBJS) $(TOOLS)
