//based on PS1 Memory Card class
//by Shendo 2009-2021 (MemcardRex)

#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <ctype.h>

#include "ps1card.h"
#include "util.h"


enum ps1block_type
{
    PS1BLOCK_FORMATTED,
    PS1BLOCK_INITIAL,
    PS1BLOCK_MIDDLELINK,
    PS1BLOCK_ENDLINK,
    PS1BLOCK_DELETED_INITIAL,
    PS1BLOCK_DELETED_MIDDLELINK,
    PS1BLOCK_DELETED_ENDLINK,
    PS1BLOCK_CORRUPTED,
};

//Memory Card's type (0 - unset, 1 - raw, 2 - gme, 3 - vgs, 4 - vmp);
static uint8_t cardType = PS1CARD_NULL;

//Flag used to determine if the card has been edited since the last saving
bool changedFlag = false;

//Complete Memory Card in the raw format (131072 bytes)
static uint8_t rawMemoryCard[131072];

//Header data for the GME Memory Card

static ps1McData_t ps1saves[15];

#define Color uint32_t
typedef uint8_t Bitmap[256];


//Save comments (supported by .gme files only), 255 characters allowed
char saveComments[15][256];


const uint8_t saveKey[] = { 0xAB, 0x5A, 0xBC, 0x9F, 0xC1, 0xF4, 0x9D, 0xE6, 0xA0, 0x51, 0xDB, 0xAE, 0xFA, 0x51, 0x88, 0x59 };
const uint8_t saveIv[] = { 0xB3, 0x0F, 0xFE, 0xED, 0xB7, 0xDC, 0x5E, 0xB7, 0x13, 0x3D, 0xA6, 0x0D, 0x1B, 0x6B, 0x2C, 0xDC };

const uint8_t mcxKey[] = { 0x81, 0xD9, 0xCC, 0xE9, 0x71, 0xA9, 0x49, 0x9B, 0x04, 0xAD, 0xDC, 0x48, 0x30, 0x7F, 0x07, 0x92 };
const uint8_t mcxIv[] = { 0x13, 0xC2, 0xE7, 0x69, 0x4B, 0xEC, 0x69, 0x6D, 0x52, 0xCF, 0x00, 0x09, 0x2A, 0xC1, 0xF2, 0x72 };

/*
//Overwrite the contents of one byte array
static void FillByteArray(uint8_t* destination, int start, int fill)
{
    for (int i = 0; i < destination.Length - start; i++)
    {
        destination[i + start] = (byte)fill;
    }
}

//XORs a buffer with a constant
static void XorWithByte(uint8_t* buffer, byte xorByte)
{
    for (int i = 0; i < buffer.Length; i++)
    {
        buffer[i] = (byte)(buffer[i] ^ xorByte);
    }
}

//XORs one buffer with another
static void XorWithIv(uint8_t* destBuffer, uint8_t* iv)
{
    for (int i = 0; i < 16; i++)
    {
        destBuffer[i] = (byte)(destBuffer[i] ^ iv[i]);
    }
}

//Encrypts a buffer using AES CBC 128
static uint8_t* AesCbcEncrypt(uint8_t* toEncrypt, uint8_t* key, uint8_t* iv)
{
    Aes aes = Aes.Create();
    aes.Key = key;
    aes.IV = iv;
    aes.Padding = PaddingMode.Zeros;
    aes.Mode = CipherMode.CBC;

    using (ICryptoTransform encryptor = aes.CreateEncryptor(key, iv))
    {
        using (MemoryStream msEncrypt = new MemoryStream())
        {
            using (CryptoStream csEncrypt = new CryptoStream(msEncrypt, encryptor, CryptoStreamMode.Write))
            {
                using (BinaryWriter bnEncrypt = new BinaryWriter(csEncrypt))
                {
                    bnEncrypt.Write(toEncrypt);
                }
                return msEncrypt.ToArray();
            }
        }
    }
}

//Decrypts a buffer using AES CBC 128
static uint8_t* AesCbcDecrypt(uint8_t* toDecrypt, uint8_t* key, uint8_t* iv)
{
    Aes aes = Aes.Create();
    aes.Key = key;
    aes.IV = iv;
    aes.Padding = PaddingMode.Zeros;
    aes.Mode = CipherMode.CBC;

    using (ICryptoTransform decryptor = aes.CreateDecryptor(key, iv))
    {
        using (MemoryStream msDecrypt = new MemoryStream(toDecrypt))
        {
            using (CryptoStream csDecrypt = new CryptoStream(msDecrypt, decryptor, CryptoStreamMode.Read))
            {
                using (BinaryReader bnDecrypt = new BinaryReader(csDecrypt))
                {
                    return bnDecrypt.ReadBytes(toDecrypt.Length - (toDecrypt.Length % 16));
                }
            }
        }
    }
}

//Encrypts a buffer using AES ECB 128
static uint8_t* AesEcbEncrypt(uint8_t* toEncrypt, uint8_t* key, uint8_t* iv)
{
    Aes aes = Aes.Create();
    aes.Key = key;
    aes.IV = iv;
    aes.Padding = PaddingMode.Zeros;
    aes.Mode = CipherMode.ECB;

    using (ICryptoTransform encryptor = aes.CreateEncryptor(key, iv))
    {
        using (MemoryStream msEncrypt = new MemoryStream())
        {
            using (CryptoStream csEncrypt = new CryptoStream(msEncrypt, encryptor, CryptoStreamMode.Write))
            {
                using (BinaryWriter bnEncrypt = new BinaryWriter(csEncrypt))
                {
                    bnEncrypt.Write(toEncrypt);
                }
                return msEncrypt.ToArray();
            }
        }
    }
}

//Decrypts a buffer using AES ECB 128
static uint8_t* AesEcbDecrypt(uint8_t* toDecrypt, uint8_t* key, uint8_t* iv)
{
    Aes aes = Aes.Create();
    aes.Key = key;
    aes.IV = iv;
    aes.Padding = PaddingMode.Zeros;
    aes.Mode = CipherMode.ECB;

    using (ICryptoTransform decryptor = aes.CreateDecryptor(key, iv))
    {
        using (MemoryStream msDecrypt = new MemoryStream(toDecrypt))
        {
            using (CryptoStream csDecrypt = new CryptoStream(msDecrypt, decryptor, CryptoStreamMode.Read))
            {
                using (BinaryReader bnDecrypt = new BinaryReader(csDecrypt))
                {
                    return bnDecrypt.ReadBytes(toDecrypt.Length - (toDecrypt.Length % 16));
                }
            }
        }
    }
}
*/

//Load Data from raw Memory Card
static void loadDataFromRawCard(void)
{
    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
    {
        //Load header data
        ps1saves[slotNumber].headerData = &rawMemoryCard[128 + (slotNumber * 128)];

        //Load save 
        ps1saves[slotNumber].saveData = &rawMemoryCard[8192 + (slotNumber * 8192)];
    }
}

//Recreate raw Memory Card
static void loadDataToRawCard(bool fixData)
{
    //Check if data needs to be fixed or left as is (mandatory for FreePSXBoot)
    if (fixData)
    {
        //Clear existing data
        uint8_t rawMemoryCard[131072];

        //Recreate the signature
        rawMemoryCard[0] = 0x4D;        //M
        rawMemoryCard[1] = 0x43;        //C
        rawMemoryCard[127] = 0x0E;      //XOR (precalculated)

        rawMemoryCard[8064] = 0x4D;     //M
        rawMemoryCard[8065] = 0x43;     //C
        rawMemoryCard[8191] = 0x0E;     //XOR (precalculated)
    }

    //This can be copied freely without fixing
    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
    {
        //Load header data
        ps1saves[slotNumber].headerData = &rawMemoryCard[128 + (slotNumber * 128)];
        for (int currentByte = 0; currentByte < 128; currentByte++)
        {
//            rawMemoryCard[128 + (slotNumber * 128) + currentByte] = headerData[slotNumber][currentByte];
        }

        //Load save data
        ps1saves[slotNumber].saveData = &rawMemoryCard[8192 + (slotNumber * 8192)];
        for (int currentByte = 0; currentByte < 8192; currentByte++)
        {
//            rawMemoryCard[8192 + (slotNumber * 8192) + currentByte] = saveData[slotNumber][currentByte];
        }
    }


    //Skip fixing data if it's not needed
    if (!fixData) return;

    //Create authentic data (just for completeness)
    for (int i = 0; i < 20; i++)
    {
        //Reserved slot typed
        rawMemoryCard[2048 + (i * 128)] = 0xFF;
        rawMemoryCard[2048 + (i * 128) + 1] = 0xFF;
        rawMemoryCard[2048 + (i * 128) + 2] = 0xFF;
        rawMemoryCard[2048 + (i * 128) + 3] = 0xFF;

        //Next slot pointer doesn't point to anything
        rawMemoryCard[2048 + (i * 128) + 8] = 0xFF;
        rawMemoryCard[2048 + (i * 128) + 9] = 0xFF;
    }
}

//Recreate GME header(add signature, slot description and comments)
static void fillGmeHeader(FILE* fp)
{
    uint8_t gmeHeader[3904];

    //Clear existing data
    memset(gmeHeader, 0, sizeof(gmeHeader));

    //Fill in the signature
    gmeHeader[0] = 0x31;        //1
    gmeHeader[1] = 0x32;        //2
    gmeHeader[2] = 0x33;        //3
    gmeHeader[3] = 0x2D;        //-
    gmeHeader[4] = 0x34;        //4
    gmeHeader[5] = 0x35;        //5
    gmeHeader[6] = 0x36;        //6
    gmeHeader[7] = 0x2D;        //-
    gmeHeader[8] = 0x53;        //S
    gmeHeader[9] = 0x54;        //T
    gmeHeader[10] = 0x44;       //D

    gmeHeader[18] = 0x1;
    gmeHeader[20] = 0x1;
    gmeHeader[21] = 0x4D;       //M

    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
    {
        gmeHeader[22 + slotNumber] = ps1saves[slotNumber].headerData[0];
        gmeHeader[38 + slotNumber] = ps1saves[slotNumber].headerData[8];

        //Convert string from UTF-16 to currently used codepage
//        tempByteArray = Encoding.Convert(Encoding.Unicode, Encoding.Default, Encoding.Unicode.GetBytes(saveComments[slotNumber]));

        //Inject comments to GME header
        memcpy(&gmeHeader[64 + (256 * slotNumber)], saveComments[slotNumber], 256);
//        for (int byteCount = 0; byteCount < tempByteArray.Length; byteCount++)
//            gmeHeader[byteCount + 64 + (256*slotNumber)] = tempByteArray[byteCount];
    }

    fwrite(gmeHeader, 1, sizeof(gmeHeader), fp);
    return;
}

static bool IsMcxCard(uint8_t* rawCard)
{
    return false;
}

/*
//Gets the HMAC checksum for .psv or .vmp saving
static uint8_t* GetHmac(uint8_t* data, uint8_t* saltSeed)
{
    uint8_t* buffer = new byte[0x14];
    uint8_t* salt = new byte[0x40];
    uint8_t* temp = new byte[0x14];
    uint8_t* hash1 = new byte[data.Length + 0x40];
    uint8_t* hash2 = new byte[0x54];
    SHA1 sha1 = SHA1.Create();

    Array.Copy(saltSeed, buffer, 0x14);
    Array.Copy(AesEcbDecrypt(buffer, saveKey, saveIv), buffer, 0x10);
    Array.Copy(buffer, salt, 0x10);
    Array.Copy(saltSeed, buffer, 0x10);
    Array.Copy(AesEcbEncrypt(buffer, saveKey, saveIv), buffer, 0x14);

    Array.Copy(buffer, 0, salt, 0x10, 0x10);
    XorWithIv(salt, saveIv);
    FillByteArray(buffer, 0x14, 0xFF);
    Array.Copy(saltSeed, 0x10, buffer, 0, 0x4);
    Array.Copy(salt, 0x10, temp, 0, 0x14);
    XorWithIv(temp, buffer);
    Array.Copy(temp, 0, salt, 0x10, 0x10);
    Array.Copy(salt, temp, 0x14);
    FillByteArray(salt, 0x14, 0);
    Array.Copy(temp, salt, 0x14);
    XorWithByte(salt, 0x36);

    Array.Copy(salt, hash1, 0x40);
    Array.Copy(data, 0, hash1, 0x40, data.Length);
    Array.Copy(sha1.ComputeHash(hash1), buffer, 0x14);
    XorWithByte(salt, 0x6A);
    Array.Copy(salt, hash2, 0x40);
    Array.Copy(buffer, 0, hash2, 0x40, 0x14);
    return sha1.ComputeHash(hash2);

}

static uint8_t* DecryptMcxCard(uint8_t* rawCard)
{
    uint8_t* mcxCard = new byte[0x200A0];
    Array.Copy(rawCard, mcxCard, mcxCard.Length);
    return AesCbcDecrypt(mcxCard, mcxKey, mcxIv);
}
// Check if a given card is a MCX image
static bool IsMcxCard(uint8_t* rawCard)
{
    uint8_t* mcxCard = DecryptMcxCard(rawCard);
    // Check for "MC" header 0x80 bytes in
    if (mcxCard[0x80] == 'M' && mcxCard[0x81] == 'C') 
        return true;
    else
        return false;
}

//Generate encrypted MCX Memory Card
static uint8_t* MakeMcxCard(uint8_t* rawCard)
{
    uint8_t* mcxCard = new byte[0x200A0];
    uint8_t* hash;

    Array.Copy(rawCard, 0, mcxCard, 0x80, 0x20000);
    
    using (SHA256 sha = SHA256.Create())
        hash = sha.ComputeHash(mcxCard, 0, 0x20080);

    Array.Copy(hash, 0, mcxCard, 0x20080, 0x20);
    Array.Copy(AesCbcEncrypt(mcxCard, mcxKey, mcxIv), 0, mcxCard, 0x0, 0x200A0);
    return mcxCard;
}
*/

//Generate unsigned VMP Memory Card
static void setVmpCardHeader(FILE* fp)
{
    uint8_t vmpCard[0x80];

    memset(vmpCard, 0, sizeof(vmpCard));
    vmpCard[1] = 0x50;
    vmpCard[2] = 0x4D;
    vmpCard[3] = 0x56;
    vmpCard[4] = 0x80; //header length 

    fwrite(vmpCard, 1, sizeof(vmpCard), fp);
    return;
}

//Generate unsigned PSV save
static void setPsvHeader(const char* saveFilename, uint32_t saveLength, FILE* fp)
{
    uint8_t psvSave[0x84];

    memset(psvSave, 0, sizeof(psvSave));
    psvSave[1] = 0x56;
    psvSave[2] = 0x53;
    psvSave[3] = 0x50;
    psvSave[0x38] = 0x14;
    psvSave[0x3C] = 1;
    psvSave[0x44] = 0x84;
    psvSave[0x49] = 2;
    psvSave[0x5D] = 0x20;
    psvSave[0x60] = 3;
    psvSave[0x61] = 0x90;

    memcpy(&psvSave[8], "www.bucanero.com.ar", 20);
    memcpy(&psvSave[0x64], saveFilename, 0x20);
    memcpy(&psvSave[0x40], &saveLength, sizeof(uint32_t));

    fwrite(psvSave, 1, sizeof(psvSave), fp);
    return;
}

static void setArHeader(const char* fileName, const char* saveName, FILE* fp)
{
    uint8_t arHeader[54];
    char* arName = strrchr(fileName, '/') + 1;
    int arName_Length = strlen(arName);

    //Copy header data to arHeader
    memset(arHeader, 0, sizeof(arHeader));
    memcpy(arHeader, saveName, 20);
//            for (int byteCount = 0; byteCount < 22; byteCount++)
//                arHeader[byteCount] = ps1saves[slotNumber].headerData[byteCount + 10];

    //Convert save name to bytes
//            arName = Encoding.Default.GetBytes(saveName[slotNumber]);

    //Copy save name to arHeader
    memcpy(&arHeader[21], arName, arName_Length);
//            for (int byteCount = 0; byteCount < arName_Length; byteCount++)
//                arHeader[byteCount + 21] = arName[byteCount];

    fwrite(arHeader, 1, sizeof(arHeader), fp);
    return;
}
//Calculate XOR checksum
static void calculateXOR(void)
{
    uint8_t XORchecksum = 0;

    //Cycle through each slot
    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
    {
        //Set default value
        XORchecksum = 0;

        //Count 127 bytes
        for (int byteCount = 0; byteCount < 126; byteCount++)
            XORchecksum ^= ps1saves[slotNumber].headerData[byteCount];

        //Store checksum in 128th byte
        ps1saves[slotNumber].headerData[127] = XORchecksum;
    }
}

//Load region of the saves
static void loadRegion(void)
{
    //Cycle trough each slot
    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
    {
        //Store save region
        ps1saves[slotNumber].saveRegion = (uint16_t)((ps1saves[slotNumber].headerData[11] << 8) | ps1saves[slotNumber].headerData[10]);
    }
}

//Load palette
static void loadPalette(void)
{
    int redChannel = 0;
    int greenChannel = 0;
    int blueChannel = 0;
    int colorCounter = 0;
    int blackFlag = 0;

    //Cycle through each slot on the Memory Card
    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
    {
        //Clear existing data
        memset(ps1saves[slotNumber].iconPalette, 0, sizeof(uint32_t)*16);

        //Reset color counter
        colorCounter = 0;

        //Fetch two bytes at a time
        for (int byteCount = 0; byteCount < 32; byteCount += 2)
        {
            redChannel = (ps1saves[slotNumber].saveData[byteCount + 96] & 0x1F) << 3;
            greenChannel = ((ps1saves[slotNumber].saveData[byteCount + 97] & 0x3) << 6) | ((ps1saves[slotNumber].saveData[byteCount + 96] & 0xE0) >> 2);
            blueChannel = ((ps1saves[slotNumber].saveData[byteCount + 97] & 0x7C) << 1);
            blackFlag = (ps1saves[slotNumber].saveData[byteCount + 97] & 0x80);
            
            //Get the color value
            if ((redChannel | greenChannel | blueChannel | blackFlag) == 0)
                ps1saves[slotNumber].iconPalette[colorCounter] = 0x000000FF; //Color.Transparent;
            else
                ps1saves[slotNumber].iconPalette[colorCounter] = (redChannel << 24) | (greenChannel << 16) | (blueChannel << 8) | 0xFF; //Color.FromArgb(redChannel, greenChannel, blueChannel);

            colorCounter++;
        }
    }
}

//Load the icons
static void loadIcons(void)
{
    int byteCount = 0;

    //Cycle through each slot
    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
    {
        //Clear existing data
        memset(ps1saves[slotNumber].iconData, 0, 256*3);

        //Each save has 3 icons (some are data but those will not be shown)
        for (int iconNumber = 0; iconNumber < 3; iconNumber++)
        {
//            iconData[slotNumber][iconNumber] = new Bitmap(16, 16);
            byteCount = 128 + ( 128 * iconNumber);

            for (int y = 0; y < 16; y++)
            {
                for (int x = 0; x < 16; x += 2)
                {
//                    iconData[slotNumber][iconNumber].SetPixel(x, y, iconPalette[slotNumber][saveData[slotNumber][byteCount] & 0xF]);
//                    iconData[slotNumber][iconNumber].SetPixel(x + 1, y, iconPalette[slotNumber][saveData[slotNumber][byteCount] >> 4]);
                    byteCount++;
                }
            }
        }
    }
}

//Load icon frames
static void loadIconFrames(void)
{
    //Cycle through each slot
    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
    {
        switch(ps1saves[slotNumber].saveData[2])
        {
            case 0x11:      //1 frame
                ps1saves[slotNumber].iconFrames = 1;
                break;

            case 0x12:      //2 frames
                ps1saves[slotNumber].iconFrames = 2;
                break;

            case 0x13:      //3 frames
                ps1saves[slotNumber].iconFrames = 3;
                break;

            default:        //No frames (save data is probably clean)
                ps1saves[slotNumber].iconFrames = 0;
                break;
        }
    }
}

//Recreate VGS header
static void setVGSheader(FILE* fp)
{
    uint8_t vgsHeader[64];

    memset(vgsHeader, 0, sizeof(vgsHeader));
    //Fill in the signature
    vgsHeader[0] = 0x56;       //V
    vgsHeader[1] = 0x67;       //g
    vgsHeader[2] = 0x73;       //s
    vgsHeader[3] = 0x4D;       //M

    vgsHeader[4] = 0x1;
    vgsHeader[8] = 0x1;
    vgsHeader[12] = 0x1;
    vgsHeader[17] = 0x2;

    fwrite(vgsHeader, 1, sizeof(vgsHeader), fp);
    return;
}

//Get the type of the save slots
static void loadSlotTypes(void)
{
    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
    {
        //Clear existing data
        ps1saves[slotNumber].saveType = 0;

        switch(ps1saves[slotNumber].headerData[0])
        {
            case 0xA0:      //Formatted
                ps1saves[slotNumber].saveType = PS1BLOCK_FORMATTED;
                break;

            case 0x51:      //Initial
                ps1saves[slotNumber].saveType = PS1BLOCK_INITIAL;
                break;

            case 0x52:      //Middle link
                ps1saves[slotNumber].saveType = PS1BLOCK_MIDDLELINK;
                break;

            case 0x53:      //End link
                ps1saves[slotNumber].saveType = PS1BLOCK_ENDLINK;
                break;

            case 0xA1:      //Initial deleted
                ps1saves[slotNumber].saveType = PS1BLOCK_DELETED_INITIAL;
                break;

            case 0xA2:      //Middle link deleted
                ps1saves[slotNumber].saveType = PS1BLOCK_DELETED_MIDDLELINK;
                break;

            case 0xA3:      //End link deleted
                ps1saves[slotNumber].saveType = PS1BLOCK_DELETED_ENDLINK;
                break;

            default:        //Regular values have not been found, save is corrupted
                ps1saves[slotNumber].saveType = PS1BLOCK_CORRUPTED;
                break;
        }
    }
}

//Load Save name, Product code and Identifier from the header data
static void loadStringData(void)
{
    //Temp array used for conversion
    char tempByteArray[64];

    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
    {
        //Clear existing data
        memset(ps1saves[slotNumber].saveProdCode, 0, 11);
        memset(ps1saves[slotNumber].saveIdentifier, 0, 9);
        memset(ps1saves[slotNumber].saveName, 0, 21);

        //Copy Product code
//        memset(tempByteArray, 0, sizeof(tempByteArray));
//        for (int byteCount = 0; byteCount < 10; byteCount++)
//            tempByteArray[byteCount] = ps1saves[slotNumber].headerData[byteCount + 12];

        //Convert Product Code from currently used codepage to UTF-16
        strncpy(ps1saves[slotNumber].saveProdCode, (char*) &ps1saves[slotNumber].headerData[12], 10);

        //Copy Identifier
//        memset(tempByteArray, 0, sizeof(tempByteArray));
//        for (int byteCount = 0; byteCount < 8; byteCount++)
//            tempByteArray[byteCount] = ps1saves[slotNumber].headerData[byteCount + 22];

        //Convert Identifier from currently used codepage to UTF-16
        strncpy(ps1saves[slotNumber].saveIdentifier, (char*) &ps1saves[slotNumber].headerData[22], 8);

        strncpy(ps1saves[slotNumber].saveName, (char*) &ps1saves[slotNumber].headerData[10], 20);

        //Copy bytes from save data to temp array
        memset(tempByteArray, 0, sizeof(tempByteArray));
        for (int currentByte = 0; currentByte < 64; currentByte++)
        {
            uint8_t b = ps1saves[slotNumber].saveData[currentByte + 4];
            if (currentByte % 2 == 0 && b == 0)
            {
//                Array.Resize(ref tempByteArray, currentByte);
                break;
            }
            tempByteArray[currentByte] = b;
        }

        memcpy(ps1saves[slotNumber].saveTitle, &ps1saves[slotNumber].saveData[4], 64);
        //Convert save name from Shift-JIS to UTF-16 and normalize full-width characters
//        saveName[slotNumber] = Encoding.GetEncoding(932).GetString(tempByteArray).Normalize(NormalizationForm.FormKC);

        //Check if the title converted properly, get ASCII if it didn't
//        if (saveName[slotNumber] == NULL) saveName[slotNumber] = Encoding.Default.GetString(tempByteArray, 0, 32);
    }
}

//Load size of each slot in Bytes
static void loadSaveSize(void)
{
    //Fill data for each slot
    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
        ps1saves[slotNumber].saveSize = (ps1saves[slotNumber].headerData[4] | (ps1saves[slotNumber].headerData[5]<<8) | (ps1saves[slotNumber].headerData[6]<<16));
}

//Find and return all save links
static int findSaveLinks(int initialSlotNumber, int* tempSlotList)
{
    int j = 0;
    int currentSlot = initialSlotNumber;

    //Maximum number of cycles is 15
    for (int i = 0; i < 15; i++)
    {
        //Add current slot to the list
        tempSlotList[j++] = currentSlot;

        //Check if next slot pointer overflows
        if (currentSlot > 15) break;

        //Check if current slot is corrupted
        if (ps1saves[currentSlot].saveType == PS1BLOCK_CORRUPTED) break;

        //Check if pointer points to the next save
        if (ps1saves[currentSlot].headerData[8] == 0xFF) break;
        else currentSlot = ps1saves[currentSlot].headerData[8];
    }

    //Return int array
    return j;
}

//Toggle deleted/undeleted status
void toggleDeleteSave(int slotNumber)
{
    //Get all linked saves
    int saveSlots_Length;
    int saveSlots[16];
    
    saveSlots_Length = findSaveLinks(slotNumber, saveSlots);

    //Cycle through each slot
    for (int i = 0; i < saveSlots_Length; i++)
    {
        //Check the save type
        switch (ps1saves[saveSlots[i]].saveType)
        {
            //Regular save
            case PS1BLOCK_INITIAL:
                ps1saves[saveSlots[i]].headerData[0] = 0xA1;
                break;

            //Middle link
            case PS1BLOCK_MIDDLELINK:
                ps1saves[saveSlots[i]].headerData[0] = 0xA2;
                break;

            //End link
            case PS1BLOCK_ENDLINK:
                ps1saves[saveSlots[i]].headerData[0] = 0xA3;
                break;

            //Regular deleted save
            case PS1BLOCK_DELETED_INITIAL:
                ps1saves[saveSlots[i]].headerData[0] = 0x51;
                break;

            //Middle link deleted
            case PS1BLOCK_DELETED_MIDDLELINK:
                ps1saves[saveSlots[i]].headerData[0] = 0x52;
                break;

            //End link deleted
            case PS1BLOCK_DELETED_ENDLINK:
                ps1saves[saveSlots[i]].headerData[0] = 0x53;
                break;

            //Slot should not be deleted
            default:
                break;
        }
    }

    //Reload data
    calculateXOR();
    loadSlotTypes();

    //Memory Card is changed
    changedFlag = true;
}

//Format a specified slot (Data MUST be reloaded after the use of this function)
static void formatSlot(int slotNumber)
{
    //Clear headerData
    memset(ps1saves[slotNumber].headerData, 0, 128);
//    for (int byteCount = 0; byteCount < 128; byteCount++)
//        ps1saves[slotNumber].headerData[byteCount] = 0x00;

    //Clear saveData
    memset(ps1saves[slotNumber].saveData, 0, 8192);
//    for (int byteCount = 0; byteCount < 8192; byteCount++)
//        ps1saves[slotNumber].saveData[byteCount] = 0x00;

    //Clear GME comment for selected slot
//    saveComments[slotNumber] = new string('\0',256);

    //Place default values in headerData
    ps1saves[slotNumber].headerData[0] = 0xA0;
    ps1saves[slotNumber].headerData[8] = 0xFF;
    ps1saves[slotNumber].headerData[9] = 0xFF;
}

//Format save
void formatSave(int slotNumber)
{
    //Get all linked saves
    int saveSlots_Length;
    int saveSlots[16];
    
    saveSlots_Length = findSaveLinks(slotNumber, saveSlots);

    //Cycle through each slot
    for (int i = 0; i < saveSlots_Length; i++)
    {
        formatSlot(saveSlots[i]);
    }

    //Reload data
    calculateXOR();
    loadStringData();
    loadSlotTypes();
    loadRegion();
    loadSaveSize();
    loadPalette();
    loadIcons();
    loadIconFrames();

    //Set changedFlag to edited
    changedFlag = true;
}

//Find and return continuous free slots
static int findFreeSlots(int slotCount, int* tempSlotList)
{
    //Cycle through available slots
    for (int j, slotNumber = 0; slotNumber < PS1CARD_MAX_SLOTS; slotNumber++)
    {
        j = 0;
        for (int i = slotNumber; i < (slotNumber + slotCount); i++)
        {
            if (ps1saves[i].saveType == PS1BLOCK_FORMATTED) tempSlotList[j++]=i;
            else break;

            //Exit if next save would be over the limit of 15
            if (slotNumber + slotCount > 15) break;
        }

        if (j >= slotCount)
            return j;
    }

    return 0;
}

//Return all bytes of the specified save
uint8_t* getSaveBytes(int slotNumber, uint32_t* saveLen)
{
    //Get all linked saves
    int saveSlots_Length;
    int saveSlots[16];
    uint8_t* saveBytes;

    saveSlots_Length = findSaveLinks(slotNumber, saveSlots);

    //Calculate the number of bytes needed to store the save
    *saveLen = 8320 + ((saveSlots_Length - 1) * 8192);
    saveBytes = malloc(*saveLen);

    //Copy save header
    memcpy(saveBytes, ps1saves[saveSlots[0]].headerData, 128);
//    for (int i = 0; i < 128; i++)
//        saveBytes[i] = ps1saves[saveSlots[0]].headerData[i];

    //Copy save data
    for (int sNumber = 0; sNumber < saveSlots_Length; sNumber++)
    {
        memcpy(&saveBytes[128 + (sNumber * 8192)], ps1saves[saveSlots[sNumber]].saveData, 8192);
//        for (int i = 0; i < 8192; i++)
//            saveBytes[128 + (sNumber * 8192) + i] = ps1saves[saveSlots[sNumber]].saveData[i];
    }

    //Return save bytes
    return saveBytes;
}

//Input given bytes back to the Memory Card
int setSaveBytes(const uint8_t* saveBytes, int saveBytes_Length, int* reqSlots)
{
    //Number of slots to set
    int freeSlots_Length;
    int slotCount = (saveBytes_Length - 128) / 8192;
    int freeSlots[16];
    int numberOfBytes = slotCount * 8192;

    *reqSlots = slotCount;
    freeSlots_Length = findFreeSlots(slotCount, freeSlots);

    //Check if there are enough free slots for the operation
    if (freeSlots_Length < slotCount) return false;

    //Place header data
    memcpy(ps1saves[freeSlots[0]].headerData, saveBytes, 128);
//    for (int i = 0; i < 128; i++)
//        ps1saves[freeSlots[0]].headerData[i] = saveBytes[i];

    //Place save size in the header
    ps1saves[freeSlots[0]].headerData[4] = (uint8_t)(numberOfBytes & 0xFF);
    ps1saves[freeSlots[0]].headerData[5] = (uint8_t)((numberOfBytes & 0xFF00) >> 8);
    ps1saves[freeSlots[0]].headerData[6] = (uint8_t)((numberOfBytes & 0xFF0000) >> 16);

    //Place save data(cycle through each save)
    for (int i = 0; i < slotCount; i++)
    {
        //Set all bytes
        memcpy(ps1saves[freeSlots[i]].saveData, &saveBytes[128 + (i * 8192)], 8192);
//        for (int byteCount = 0; byteCount < 8192; byteCount++)
//            ps1saves[freeSlots[i]].saveData[byteCount] = saveBytes[128 + (i * 8192) + byteCount];
    }

    //Recreate header data
    //Set pointer to all slots except the last
    for (int i = 0; i < (freeSlots_Length - 1); i++)
    {
        ps1saves[freeSlots[i]].headerData[0] = 0x52;
        ps1saves[freeSlots[i]].headerData[8] = (uint8_t)freeSlots[i + 1];
        ps1saves[freeSlots[i]].headerData[9] = 0x00;
    }

    //Add final slot pointer to the last slot in the link
    ps1saves[freeSlots[freeSlots_Length - 1]].headerData[0] = 0x53;
    ps1saves[freeSlots[freeSlots_Length - 1]].headerData[8] = 0xFF;
    ps1saves[freeSlots[freeSlots_Length - 1]].headerData[9] = 0xFF;

    //Add initial saveType to the first slot
    ps1saves[freeSlots[0]].headerData[0] = 0x51;

    //Reload data
    calculateXOR();
    loadStringData();
    loadSlotTypes();
    loadRegion();
    loadSaveSize();
    loadPalette();
    loadIcons();
    loadIconFrames();

    //Set changedFlag to edited
    changedFlag = true;

    return true;
}

//Set Product code, Identifier and Region in the header of the selected save
static void setHeaderData(int slotNumber, const char* sProdCode, const char* sIdentifier, uint16_t sRegion)
{
    //Temp array used for manipulation
    uint8_t* tempByteArray;

    //Merge Product code and Identifier
//    char headerString[256];
//    int headerString_Length = strlen(headerString);
    // = sProdCode + sIdentifier;

    //Convert string from UTF-16 to currently used codepage
//    tempByteArray = Encoding.Convert(Encoding.Unicode, Encoding.Default, Encoding.Unicode.GetBytes(headerString));

    //Clear existing data from header
    memset(&ps1saves[slotNumber].headerData[10], 0, 20);
//    for (int byteCount = 0; byteCount < 20; byteCount++)
//        ps1saves[slotNumber].headerData[byteCount + 10] = 0x00;

    //Inject new data to header
    snprintf((char*) &ps1saves[slotNumber].headerData[12], 18, "%s%s", sProdCode, sIdentifier);
//    for (int byteCount = 0; byteCount < headerString_Length; byteCount++)
//        ps1saves[slotNumber].headerData[byteCount + 12] = tempByteArray[byteCount];

    //Add region to header
    ps1saves[slotNumber].headerData[10] = (uint8_t)(sRegion & 0xFF);
    ps1saves[slotNumber].headerData[11] = (uint8_t)(sRegion >> 8);

    //Reload data
    loadStringData();
    loadRegion();

    //Calculate XOR
    calculateXOR();

    //Set changedFlag to edited
    changedFlag = true;
}

//Get icon data as bytes
uint8_t* getIconBytes(int slotNumber)
{
    uint8_t* iconBytes = malloc(416);

    //Copy bytes from the given slot
    memcpy(iconBytes, &ps1saves[slotNumber].saveData[96], 416);
//    for (int i = 0; i < 416; i++)
//        iconBytes[i] = ps1saves[slotNumber].saveData[i + 96];

    return iconBytes;
}

//Set icon data to saveData
void setIconBytes(int slotNumber, uint8_t* iconBytes)
{
    //Set bytes from the given slot
    memcpy(&ps1saves[slotNumber].saveData[96], iconBytes, 416);
//    for (int i = 0; i < 416; i++)
//        ps1saves[slotNumber].saveData[i + 96] = iconBytes[i];

    //Reload data
    loadPalette();
    loadIcons();

    //Set changedFlag to edited
    changedFlag = true;
}

//Load GME comments
/*
static void loadGMEComments(void)
{
    //Clear existing data
    memset(saveComments, 0, sizeof(saveComments));

    //Load comments from gmeHeader to saveComments
    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
    {
        memcpy(saveComments[slotNumber], &gmeHeader[64 + (256*slotNumber)], 256);
//        for (int byteCount = 0; byteCount < 256; byteCount++)
//            tempByteArray[byteCount] = gmeHeader[byteCount+64 + (256*slotNumber)];

        //Set save comment for each slot
//        saveComments[slotNumber] = Encoding.Default.GetString(tempByteArray);
    }
}
*/

//Format a complete Memory Card
void formatMemoryCard(void)
{
    //Format each slot in Memory Card
    for (int slotNumber = 0; slotNumber < 15; slotNumber++)
        formatSlot(slotNumber);

    //Reload data
    calculateXOR();
    loadStringData();
    loadSlotTypes();
    loadRegion();
    loadSaveSize();
    loadPalette();
    loadIcons();
    loadIconFrames();

    //Set changedFlag to edited
    changedFlag = true;
}

//Save single save to the given filename
int saveSingleSave(const char* fileName, int slotNumber, int singleSaveType)
{
    FILE* binWriter;
    uint32_t outputData_Length;
    uint8_t* outputData;

    //Check if the file is allowed to be opened for writing
    binWriter = fopen(fileName, "wb");
    if (!binWriter)
    {
        return false;
    }

    outputData = getSaveBytes(slotNumber, &outputData_Length);

    //Check what kind of file to output according to singleSaveType
    switch (singleSaveType)
    {
        case PS1SAVE_AR:        //Action Replay single save
            setArHeader(fileName, ps1saves[slotNumber].saveName, binWriter);
            fwrite(outputData + 128, 1, outputData_Length - 128, binWriter);
            break;

        case PS1SAVE_MCS:         //MCS single save
            fwrite(outputData, 1, outputData_Length, binWriter);
            break;

        case PS1SAVE_RAW:         //RAW single save
            fwrite(outputData + 128, 1, outputData_Length - 128, binWriter);
            break;

        case PS1SAVE_PSV:         //PS3 unsigned save
            setPsvHeader(ps1saves[slotNumber].saveName, outputData_Length - 0x80, binWriter);
            fwrite(outputData + 128, 1, outputData_Length - 128, binWriter);
            break;
    }

    //File is sucesfully saved, close the stream
    fclose(binWriter);
    free(outputData);

    return true;
}

//Import single save to the Memory Card
int openSingleSave(const char* fileName, int* requiredSlots)
{
    uint8_t* inputData;
    uint8_t* finalData;
    int finalData_Length;
    size_t inputData_Length;

    *requiredSlots = -1;

    //Check if the file is allowed to be opened
    //Put data into temp array
    if (read_buffer(fileName, &inputData, &inputData_Length) < 0)
    {
        return false;
    }

    //Check the format of the save and if it's supported load it (filter illegal characters from types)

    // 'Q':           //MCS single save
    if (inputData[0] == 'Q')
    {
        finalData_Length = inputData_Length;
        finalData = malloc(finalData_Length);

        memcpy(finalData, inputData, finalData_Length);
    }
    // 'SC':          //RAW single save
    // 'sc':          //Also valid as seen with MMX4 save
    else if (toupper(inputData[0]) == 'S' && toupper(inputData[1]) == 'C')
    {
        finalData_Length = inputData_Length + 128;
        finalData = calloc(1, finalData_Length);
        char* singleSaveName = strrchr(fileName, '/') + 1; // Encoding.Default.GetBytes(Path.GetFileName(fileName));

        //Recreate save header
        finalData[0] = 0x51;        //Q

        strncpy((char*) &finalData[10], singleSaveName, 20);
//        for (int i = 0; i < 20 && i < strlen(singleSaveName); i++)
//            finalData[i + 10] = singleSaveName[i];

        //Copy save data
        memcpy(&finalData[128], inputData, inputData_Length);
//        for (int i = 0; i < inputData_Length; i++)
//            finalData[i + 128] = inputData[i];
    }
    // 'VSP':           //PSV single save (PS3 virtual save)
    else if (memcmp(inputData, "\0VSP", 4) == 0 && inputData[60] == 1)
    {
        // Check if this is a PS1 type save
        finalData_Length = inputData_Length - 4;
        finalData = calloc(1, finalData_Length);

        //Recreate save header
        finalData[0] = 0x51;        //Q

        memcpy(&finalData[10], &inputData[100], 20);
//        for (int i = 0; i < 20; i++)
//            finalData[i + 10] = inputData[i + 100];

        //Copy save data
        memcpy(&finalData[128], &inputData[132], inputData_Length - 132);
//        for (int i = 0; i < inputData_Length - 132; i++)
//            finalData[i + 128] = inputData[i + 132];
    }
    //Action Replay single save
    //Check if this is really an AR save (check for SC magic)
    else if (inputData[0x36] == 'S' && inputData[0x37] == 'C')
    {
        finalData_Length = inputData_Length + 74;
        finalData = calloc(1, finalData_Length);

        //Recreate save header
        finalData[0] = 0x51;        //Q

        memcpy(&finalData[10], inputData, 20);
//        for (int i = 0; i < 20; i++)
//            finalData[i + 10] = inputData[i];

        //Copy save data
        memcpy(&finalData[128], &inputData[54], inputData_Length - 54);
//        for (int i = 0; i < inputData_Length - 54; i++)
//            finalData[i + 128] = inputData[i + 54];
    }
    else
    {
        free(inputData);
        return false;
    }

    //Import the save to Memory Card
    if (setSaveBytes(finalData, finalData_Length, requiredSlots))
    {
        free(finalData);
        free(inputData);
        return true;
    }

    free(finalData);
    free(inputData);
    return (false);
}

//Save Memory Card to the given filename
int saveMemoryCard(const char* fileName, int memoryCardType, int fixData)
{
    FILE* binWriter = NULL;

    binWriter = fopen(fileName, "wb");
    //Check if the file is allowed to be opened for writing
    if (!binWriter)
    {
        return false;
    }

    if (!memoryCardType)
        memoryCardType = cardType;

    //Prepare data for saving
    loadDataToRawCard(fixData);

    //Check what kind of file to output according to memoryCardType
    switch (memoryCardType)
    {
        case PS1CARD_GME:         //GME Memory Card
            fillGmeHeader(binWriter);
            fwrite(rawMemoryCard, 1, 131072, binWriter);
            break;

        case PS1CARD_VGS:         //VGS Memory Card
            setVGSheader(binWriter);
            fwrite(rawMemoryCard, 1, 131072, binWriter);
            break;

        case PS1CARD_VMP:         //VMP Memory Card
            setVmpCardHeader(binWriter);
            fwrite(rawMemoryCard, 1, 131072, binWriter);
            break;

        case PS1CARD_MCX:         //MCX Memory Card
//            fwrite(MakeMcxCard(rawMemoryCard));
            break;

        default:        //Raw Memory Card
            fwrite(rawMemoryCard, 1, 131072, binWriter);
            break;
    }

    //Store the location of the Memory Card
//    cardLocation = fileName;

    //Store the filename of the Memory Card
//    cardName = Path.GetFileNameWithoutExtension(fileName);

    //Set changedFlag to saved
    changedFlag = false;

    //File is sucesfully saved, close the stream
    fclose(binWriter);

    return true;
}

//Save (export) Memory Card to a given byte stream
uint8_t* saveMemoryCardStream(int fixData)
{
    //Prepare data for saving
    loadDataToRawCard(fixData);

    //Return complete Memory Card data
    return rawMemoryCard;
}

//Get Memory Card data and free slots
ps1McData_t* getMemoryCardData(void)
{
    if (0)
        return NULL;

    //Return Memory Card data
    return ps1saves;
}

//Open memory card from the given byte stream
void openMemoryCardStream(const uint8_t* memCardData, int fixData)
{
    //Set the reference for the recieved data
    memcpy(rawMemoryCard, memCardData, sizeof(rawMemoryCard));

    //Load Memory Card data from raw card
    loadDataFromRawCard();

//    cardName = "Untitled";

    if(fixData) calculateXOR();
    loadStringData();
//    loadGMEComments();
    loadSlotTypes();
    loadRegion();
    loadSaveSize();
    loadPalette();
    loadIcons();
    loadIconFrames();

    //Since the stream is of the unknown origin Memory Card is treated as edited
    changedFlag = true;
}

//Open Memory Card from the given filename (return error message if operation is not sucessfull)
int openMemoryCard(const char* fileName, int fixData)
{
    //Check if the Memory Card should be opened or created
    if (fileName != NULL)
    {
        uint8_t tempData[134976];
        char tempString[256];
        int startOffset;
        FILE* binReader;

        //Check if the file is allowed to be opened
        binReader = fopen(fileName, "rb");

        //File cannot be opened, return error message
        if (!binReader)
        {
            //Return the error description
            return 0;
        }

        //Put data into temp array
        if (fread(tempData, 1, 134976, binReader) < 131072)
        {
            fclose(binReader);
            return 0;
        }

        //File is sucesfully read, close the stream
        fclose(binReader);

        //Store the location of the Memory Card
//        cardLocation = fileName;

        //Store the filename of the Memory Card
//        cardName = Path.GetFileNameWithoutExtension(fileName);

        //Check the format of the card and if it's supported load it (filter illegal characters from types)

        // "MC":              //Standard raw Memory Card
        if (memcmp(tempData, "MC", 2) == 0)
        {
            startOffset = 0;
            cardType = PS1CARD_RAW;
        }
        // "123-456-STD":     //DexDrive GME Memory Card
        else if (memcmp(tempData, "123-456-STD", 11) == 0)
        {
            startOffset = 3904;
            cardType = PS1CARD_GME;

            //Copy input data to gmeHeader
//            for (int i = 0; i < 3904; i++) gmeHeader[i] = tempData[i];
        }
        // "VgsM":            //VGS Memory Card
        else if (memcmp(tempData, "VgsM", 4) == 0)
        {
            startOffset = 64;
            cardType = PS1CARD_VGS;
        }
        // "PMV":             //PSP virtual Memory Card
        else if (memcmp(tempData, "\0PMV", 4) == 0)
        {
            startOffset = 128;
            cardType = PS1CARD_VMP;
        }
        //File type is not supported or is MCX
        else if (IsMcxCard(tempData))
        {
//            tempData = DecryptMcxCard(tempData);
            startOffset = 128;
            cardType = PS1CARD_MCX;
        }
        else return 0;

        //Copy data to rawMemoryCard array with offset from input data
        memcpy(rawMemoryCard, tempData + startOffset, 131072);

        //Load Memory Card data from raw card
        loadDataFromRawCard();
    }
    // Memory Card should be created
    else
    {
//        cardName = "Untitled";
        loadDataToRawCard(true);
        formatMemoryCard();

        //Set changedFlag to false since this is created card
        changedFlag = false;
    }

    //Calculate XOR checksum (in case if any of the saveHeaders have corrputed XOR)
    if(fixData) calculateXOR();

    //Convert various Memory Card data to strings
    loadStringData();

    //Load GME comments (if card is any other type comments will be NULL)
//    loadGMEComments();

    //Load slot descriptions (types)
    loadSlotTypes();

    //Load region data
    loadRegion();

    //Load size data
    loadSaveSize();

    //Load icon palette data as Color values
    loadPalette();

    //Load icon data to bitmaps
    loadIcons();

    //Load number of frames
    loadIconFrames();

    //Everything went well, no error messages
    return 1;
}
