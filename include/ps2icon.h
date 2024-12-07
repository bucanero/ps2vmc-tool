/*
*
* Copyright (c) 2008 Andreas Weis (http://www.ghulbus-inc.de/)
*
* Permission is hereby granted, free of charge, to any person obtaining a
* copy  of  this   software  and  associated   documentation  files  (the
* "Software"),  to deal  in the Software  without  restriction, including
* without  limitation  the rights to  use, copy,  modify, merge, publish,
* distribute,  sublicense, and/or  sell  copies of the  Software, and  to
* permit persons to  whom the Software is furnished  to do so, subject to
* the following conditions:
*
* The above copyright notice and this permission notice shall be included
* in all copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
* OR   IMPLIED,  INCLUDING   BUT  NOT  LIMITED  TO   THE  WARRANTIES   OF
* MERCHANTABILITY, FITNESS FOR A PARTICULAR  PURPOSE AND NONINFRINGEMENT.
* IN NO EVENT SHALL THE  AUTHORS OR COPYRIGHT HOLDERS  BE LIABLE FOR  ANY
* CLAIM,  DAMAGES  OR OTHER  LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
* TORT  OR OTHERWISE,  ARISING FROM,  OUT OF  OR IN  CONNECTION  WITH THE
* SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

//================================================================================================
//   Typedefs and Defines
//================================================================================================

typedef struct
{
    char magic[4];
    uint16_t padding1;             // 0000
    uint16_t secondLineOffset;
    uint32_t padding2;             // 00000000
    uint32_t transparencyVal;      // 0x00 (clear) to 0x80 (opaque)
    uint8_t bgColourUpperLeft[16];
    uint8_t bgColourUpperRight[16];
    uint8_t bgColourLowerLeft[16];
    uint8_t bgColourLowerRight[16];
    uint8_t light1Direction[16];
    uint8_t light2Direction[16];
    uint8_t light3Direction[16];
    uint8_t light1RGB[16];
    uint8_t light2RGB[16];
    uint8_t light3RGB[16];
    uint8_t ambientLightRGB[16];
    char title[68];            // null terminated, S-JIS
    char IconName[64];         // null terminated
    char copyIconName[64];     // null terminated
    char deleteIconName[64];   // null terminated
    uint8_t padding3[512];
} ps2_IconSys_t;

/** File header
 */
typedef struct Icon_Header_t {
	unsigned int file_id;						///< reserved; should be: 0x010000 (but does not have to ;) )
	unsigned int animation_shapes;				///< number of animation shapes per vertex
	unsigned int texture_type;					///< texture type - 0x07: uncompressed, 0x06: uncompresses, 0x0f: RLE compression
	unsigned int reserved;						///< reserved; should be: 0x3F800000 (but does not have to ;) )
	unsigned int n_vertices;					///< number of vertices; must be a multiple of 3
} Icon_Header;
/** Set of vertex coordinates
 * @note The f16_* fields indicate float16 data; divide by 4096.0f to convert to float32;
 */
typedef struct Vertex_Coord_t {
	short f16_x;								///< vertex x coordinate in float16
	short f16_y;								///< vertex y coordinate in float16
	short f16_z;								///< vertex z coordinate in float16
	short f16_unknown;							///< unknown; seems to influence lightning?
} Vertex_Coord;
/** Set of texture coordinates
 * @note The f16_* fields indicate float16 data; divide by 4096.0f to convert to float32;
 */
typedef struct Texture_Data_t {
	short        f16_u;							///< vertex u texture coordinate in float16
	short        f16_v;							///< vertex v texture coordinate in float16
	unsigned int color;							///< vertex color (32 bit RGBA)
} Texture_Data;
/** Animation header
 */
typedef struct Animation_Header_t {
	unsigned int id_tag;						///< ???
	unsigned int frame_length;					///< ???
	float        anim_speed;					///< ???
	unsigned int play_offset;					///< ???
	unsigned int n_frames;						///< number of frames in the animation
} Animation_Header;
/** Per-frame animation data
 */
typedef struct Frame_Data_t {
	unsigned int shape_id;						///< shape used for this frame
	unsigned int n_keys;						///< number of keys corresponding to this frame
} Frame_Data;
/** Per-key animation data
 */
typedef struct Frame_Key_t {
	float time;									///< ???
	float value;								///< ???
} Frame_Key;

//Get icon data as bytes
uint8_t* getIconPS2(const char* folder, const char* iconfile);
