TOOLS	=	src/main
COMMON	=	src/util.o src/mcio.o
DEPS	=	Makefile

CC	=	gcc
CFLAGS	=	-g -O3 -W -I./include -I. -D_GNU_SOURCE
#LDFLAGS =	-lz

OBJS	= $(COMMON) $(addsuffix .o, $(TOOLS))

all: $(TOOLS)

$(TOOLS): %: %.o $(COMMON) $(DEPS)
	$(CC) $(CFLAGS) -o ps2vmc-tool $< $(COMMON) $(LDFLAGS)
#	$(CC) $(CFLAGS) -o $@ $< $(COMMON) $(LDFLAGS)
#	mv src/main ps2vmc-tool

$(OBJS): %.o: %.c $(DEPS)
	$(CC) $(CFLAGS) -c -o $@ $<

clean:
	-rm -f $(OBJS) $(TOOLS)
