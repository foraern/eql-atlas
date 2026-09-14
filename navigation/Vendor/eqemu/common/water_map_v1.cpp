#include "water_map_v1.h"
#include <functional>

WaterMapV1::WaterMapV1() {
	BSP_Root = nullptr;
}

WaterMapV1::~WaterMapV1() {
	if (BSP_Root) {
		delete[] BSP_Root;
	}
}

WaterRegionType WaterMapV1::ReturnRegionType(float y, float x, float z) const {
	return BSPReturnRegionType(1, y, x, z);
}

bool WaterMapV1::InWater(float y, float x, float z) const {
	return ReturnRegionType(y, x, z) == RegionTypeWater;
}

bool WaterMapV1::InVWater(float y, float x, float z) const {
	return ReturnRegionType(y, x, z) == RegionTypeVWater;
}

bool WaterMapV1::InLava(float y, float x, float z) const {
	return ReturnRegionType(y, x, z) == RegionTypeLava;
}

bool WaterMapV1::InLiquid(float y, float x, float z) const {
	return InWater(y, x, z) || InLava(y, x, z);
}

bool WaterMapV1::Load(FILE *fp) {
	uint32_t bsp_tree_size;
	if (fread(&bsp_tree_size, sizeof(bsp_tree_size), 1, fp) != 1) {
		return false;
	}

	if(bsp_tree_size==0 || bsp_tree_size>1000000) return false;
	BSP_Root = new ZBSP_Node[bsp_tree_size];
	if (!BSP_Root) {
		return false;
	}

	if (fread(BSP_Root, sizeof(ZBSP_Node), bsp_tree_size, fp) != bsp_tree_size) {
		return false;
	}


    blockedSubtree.assign(bsp_tree_size,0);
    std::vector<unsigned char> state(bsp_tree_size,0);
    std::function<bool(int,int)> visit=[&](int i,int depth) {
        if(i<1||i>(int)bsp_tree_size||depth>1024)return false;
        if(state[i-1]==1)return false;
        if(state[i-1]==2)return true;
        state[i-1]=1;auto& n=BSP_Root[i-1];bool block=BlocksWalking(n.special);
        for(int child:{n.left,n.right})if(child){if(!visit(child,depth+1))return false;block=block||blockedSubtree[child-1];}
        blockedSubtree[i-1]=block;state[i-1]=2;return true;
    };
    return visit(1,0);
}

bool WaterMapV1::PotentiallyBlocked(const glm::vec3& low,const glm::vec3& high) const {
    glm::vec3 center((low.z+high.z)*.5f,(low.x+high.x)*.5f,(low.y+high.y)*.5f);
    glm::vec3 extent((high.z-low.z)*.5f,(high.x-low.x)*.5f,(high.y-low.y)*.5f);
    std::function<bool(int)> walk=[&](int i){
        if(!i||!blockedSubtree[i-1])return false;auto& n=BSP_Root[i-1];
        if(!n.left&&!n.right)return BlocksWalking(n.special);
        float mid=n.normal[0]*center.x+n.normal[1]*center.y+n.normal[2]*center.z+n.splitdistance;
        float radius=fabs(n.normal[0])*extent.x+fabs(n.normal[1])*extent.y+fabs(n.normal[2])*extent.z;
        return (mid+radius>=0&&walk(n.left)) || (mid-radius<=0&&walk(n.right));
    };return walk(1);
}

WaterRegionType WaterMapV1::BSPReturnRegionType(int32_t node_number, float y, float x, float z) const {
	float distance;

	const ZBSP_Node *current_node = &BSP_Root[node_number - 1];

	if ((current_node->left == 0) &&
		(current_node->right == 0)) {
		return (WaterRegionType)current_node->special;
	}

	distance = (x * current_node->normal[0]) +
		(y * current_node->normal[1]) +
		(z * current_node->normal[2]) +
		current_node->splitdistance;

	if (distance == 0.0f) {
		return(RegionTypeNormal);
	}

	if (distance >0.0f) {
		if (current_node->left == 0) {
			return(RegionTypeNormal);
		}
		return BSPReturnRegionType(current_node->left, y, x, z);
	}

	if (current_node->right == 0) {
		return(RegionTypeNormal);
	}

	return BSPReturnRegionType(current_node->right, y, x, z);
}
