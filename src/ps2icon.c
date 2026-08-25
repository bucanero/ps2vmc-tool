#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <string.h>

#include "ps2icon.h"
#include "mcio.h"


static uint32_t TIM2RGBA(const uint8_t *buf)
{
	uint8_t RGBA[4];
	uint16_t lRGB = (int16_t) (buf[1] << 8) | buf[0];

	RGBA[0] = 8 * (lRGB & 0x1F);
	RGBA[1] = 8 * ((lRGB >> 5) & 0x1F);
	RGBA[2] = 8 * (lRGB >> 10);
	RGBA[3] = 0xFF;

	return *((uint32_t *) &RGBA);
}

//Bytes still readable at 'off' in a buffer of 'len' bytes
#define ICON_AVAIL(len, off)	(((off) < (len)) ? ((len) - (off)) : 0)

//Texels the output buffer can still take
#define ICON_TEXELS		(128 * 128)

static void* ps2IconTexture(const uint8_t* iData, size_t len)
{
	uint32_t i;
	uint16_t j;
	Icon_Header header;
	Animation_Header anim_header;
	Frame_Data animation;
	uint32_t *lTexturePtr, *lRGBA;
	size_t offset = 0, vertex_size;

	lTexturePtr = (uint32_t *) calloc(ICON_TEXELS, sizeof(uint32_t));
	if (!lTexturePtr)
		return NULL;

	//read header:
	if (len < sizeof(Icon_Header))
		return lTexturePtr;

	memcpy(&header, iData, sizeof(Icon_Header));
	offset += sizeof(Icon_Header);

	//n_vertices has to be divisible by three, that's for sure:
	if(header.file_id != 0x010000 || header.n_vertices % 3 != 0)
		return lTexturePtr;

	//a vertex needs at least one animation shape, and the count is bounded so
	//the size calculation below cannot overflow
	if(header.animation_shapes == 0 || header.animation_shapes > 0xFFFF)
		return lTexturePtr;

	//read icon data from file: https://ghulbus-inc.de/projects/ps2iconsys/
	///Vertex data
	// each vertex consists of animation_shapes tuples for vertex coordinates,
	// followed by one vertex coordinate tuple for normal coordinates
	// followed by one texture data tuple for texture coordinates and color
	vertex_size = (size_t)sizeof(Vertex_Coord) * header.animation_shapes
			+ sizeof(Vertex_Coord) + sizeof(Texture_Data);

	//divide instead of multiplying out, so the check cannot overflow
	if (header.n_vertices > ICON_AVAIL(len, offset) / vertex_size)
		return lTexturePtr;

	offset += vertex_size * header.n_vertices;

	//animation data
	// preceeded by an animation header, there is a frame data/key set for every frame:
	if (ICON_AVAIL(len, offset) < sizeof(Animation_Header))
		return lTexturePtr;

	memcpy(&anim_header, &iData[offset], sizeof(Animation_Header));
	offset += sizeof(Animation_Header);

	//read animation data:
	for(i=0; i<anim_header.n_frames; i++) {
		if (ICON_AVAIL(len, offset) < sizeof(Frame_Data))
			return lTexturePtr;

		memcpy(&animation, &iData[offset], sizeof(Frame_Data));
		offset += sizeof(Frame_Data);

		if (animation.n_keys > ICON_AVAIL(len, offset) / sizeof(Frame_Key))
			return lTexturePtr;

		offset += sizeof(Frame_Key) * animation.n_keys;
	}

	lRGBA = lTexturePtr;

	if (header.texture_type <= 7)
	{	// Uncompressed texture
		// Some icons carry no texture at all: the file ends after the animation
		// block and the model is drawn from its vertex colours. Hand back the
		// cleared buffer rather than reading past the end of the file.
		if (ICON_AVAIL(len, offset) < (ICON_TEXELS * 2))
			return lTexturePtr;

		for (i = 0; i < ICON_TEXELS; i++, offset += 2)
			*lRGBA++ = TIM2RGBA(&iData[offset]);
	}
	else
	{	//Compressed texture
		offset += 4;

		while ((lRGBA - lTexturePtr) < ICON_TEXELS)
		{
			if (ICON_AVAIL(len, offset) < 2)
				break;

			j = (int16_t) (iData[offset + 1] << 8) | iData[offset];

			if (0xFF00 == (j & 0xFF00))
			{	//a run of literal texels
				for (j = (0x0000 - j) & 0xFFFF; j > 0; j--)
				{
					offset += 2;

					if (ICON_AVAIL(len, offset) < 2 || (lRGBA - lTexturePtr) >= ICON_TEXELS)
						break;

					*lRGBA++ = TIM2RGBA(&iData[offset]);
				}
			}
			else
			{	//one texel repeated j times
				offset += 2;

				if (ICON_AVAIL(len, offset) < 2)
					break;

				for (; j > 0; j--)
				{
					if ((lRGBA - lTexturePtr) >= ICON_TEXELS)
						break;

					*lRGBA++ = TIM2RGBA(&iData[offset]);
				}
			}
			offset += 2;
		}
	}

	return (lTexturePtr);
}

//Get icon data as bytes
uint8_t* getIconPS2(const char* folder, const char* iconfile)
{
	int fd, r;
	uint8_t *buf, *out;
	char filePath[256];
	struct io_dirent st;

	snprintf(filePath, sizeof(filePath), "%s/%s", folder, iconfile);

	if (mcio_mcStat(filePath, &st) < 0)
		return calloc(ICON_TEXELS, sizeof(uint32_t));

	fd = mcio_mcOpen(filePath, sceMcFileAttrReadable | sceMcFileAttrFile);
	if (fd < 0)
		return calloc(ICON_TEXELS, sizeof(uint32_t));

	buf = malloc(st.stat.size ? st.stat.size : 1);
	if (!buf) {
		mcio_mcClose(fd);
		return calloc(ICON_TEXELS, sizeof(uint32_t));
	}

	r = mcio_mcRead(fd, buf, st.stat.size);
	mcio_mcClose(fd);

	//only the bytes actually read are valid input for the parser
	out = ps2IconTexture(buf, (r > 0) ? (size_t)r : 0);
	free(buf);

	return out;
}
