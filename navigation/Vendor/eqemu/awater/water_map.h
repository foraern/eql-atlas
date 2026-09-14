#ifndef EQEMU_WATER_MAP_H
#define EQEMU_WATER_MAP_H

#include <stdint.h>
#include <string>

enum WaterWriterWriterRegionType
{
	WriterRegionTypeUnsupported = -2,
	WriterRegionTypeUntagged = -1,
	WriterRegionTypeNormal = 0,
	WriterRegionTypeWater = 1,
	WriterRegionTypeLava = 2,
	WriterRegionTypeZoneLine = 3,
	WriterRegionTypePVP = 4,
	WriterRegionTypeSlime = 5,
	WriterRegionTypeIce = 6,
	WriterRegionTypeVWater = 7,
	WriterRegionTypeGeneralArea = 8,
	WriterRegionTypePreferPathing = 9,
	WriterRegionTypeDisableNavMesh = 10
};

class WaterWriter
{
public:
	WaterWriter();
	~WaterWriter();
	
	bool BuildAndWrite(std::string zone_name);
	bool BuildAndWriteS3D(std::string zone_name);
	bool BuildAndWriteEQG(std::string zone_name);
	bool BuildAndWriteEQG4(std::string zone_name);
};

#endif
