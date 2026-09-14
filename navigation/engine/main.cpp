// Headless geometry preparation and walking queries. Coordinates on the wire
// are map X,Y,Z.
#include "../Vendor/eqemu/awater/water_map.h"
#include "../Vendor/eqemu/azone/map.h"
#include "DetourCommon.h"
#include "DetourNavMesh.h"
#include "DetourNavMeshBuilder.h"
#include "DetourNavMeshQuery.h"
#include "Recast.h"
#include "Support.h"
#include "log_macros.h"
#include "log_stdout.h"
#include "pfs.h"
#include "zone_map.h"
#include "SHA256.h"
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>
#include <set>
#ifdef _WIN32
#include <process.h>
#define getpid _getpid
#else
#include <unistd.h>
#endif
using json = nlohmann::json;
namespace fs = std::filesystem;
std::string atlas_format;
fs::path sourceRoot;
std::string atlas_source_path(const std::string &name) {
  fs::path p=fs::u8path(name);
  if (sourceRoot.empty()) return name;
  if (p.is_absolute()) return name; // inventory supplies canonical, trusted paths
  if (p.has_parent_path()) throw std::runtime_error("Invalid external asset path");
  return (sourceRoot / p).u8string();
}
std::set<std::string> dependencies;
FILE *atlas_open_source(const std::string &name) {
  auto p=fs::u8path(atlas_source_path(name));
#ifdef _WIN32
  return _wfopen(p.c_str(), L"rb");
#else
  return fopen(p.c_str(), "rb");
#endif
}
std::string fileHash(const fs::path &p);
bool recordSourceReads = false;
std::map<std::string, std::string> sourceHashes;
void atlas_dependency(const std::string &s) {
  dependencies.insert(s);
  if (recordSourceReads && sourceHashes.count(s) == 0)
    sourceHashes[s] = fileHash(fs::u8path(atlas_source_path(s)));
}
constexpr const char *engineVersion = "atlas-nav-6";
struct Failure : std::runtime_error {
  std::string code;
  json details = json::object();
  Failure(std::string c, std::string m) : runtime_error(m), code(c) {}
};
void atlas_missing_geometry(const std::string &name) {
  throw Failure("missingGeometry",
                "Required geometry is missing or unreadable: " + name);
}
void require(bool b, const char *c, const char *m) {
  if (!b)
    throw Failure(c, m);
}
std::string digest(const std::string &s) {
  unsigned char h[32];
  SHA256 ctx; ctx.update(s.data(), s.size()); ctx.finish(h);
  char out[65];
  for (int i = 0; i < 32; i++)
    sprintf(out + i * 2, "%02x", h[i]);
  return out;
}
std::string fileHash(const fs::path &p) {
  if (!fs::is_regular_file(p))
    return "missing";
  std::ifstream in(p, std::ios::binary);
  require(in.good(), "assetRead", "Cannot read a source asset");
  SHA256 ctx;
  char b[65536];
  while (in) {
    in.read(b, sizeof b);
    ctx.update(b, size_t(in.gcount()));
  }
  unsigned char h[32];
  ctx.finish(h);
  char out[65];
  for (int i = 0; i < 32; i++)
    sprintf(out + i * 2, "%02x", h[i]);
  return out;
}
json readJSON(const fs::path &p) {
  std::ifstream f(p);
  json j;
  f >> j;
  return j;
}
void writeJSON(const fs::path &p, const json &j) {
  std::ofstream f(p);
  f << j.dump();
  require(f.good(), "cacheWrite", "Cannot write navigation cache");
}
// ZoneMap coordinates map to Atlas as (-nav.x, -nav.z, nav.y).
// WaterMap uses its own upstream coordinate convention, separately below.
glm::vec3 fromMap(const json &p) {
  require(p.is_array() && p.size() == 3, "point", "Expected map X,Y,Z");
  glm::vec3 v(-p.at(0).get<float>(), p.at(2).get<float>(),
              -p.at(1).get<float>());
  require(std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z),
          "point", "Coordinates must be finite");
  return v;
}
json toMap(const float *p) { return json::array({-p[0], -p[2], p[1]}); }
struct Profile {
  float height = 6.55f, radius = 1.31f, step = 2.0f, slope = 45, cs = .8f,
        ch = .4f;
  Profile(const json &p = json::object()) {
    height = p.value("height", height);
    radius = p.value("radius", radius);
    step = p.value("step", step);
    slope = p.value("slope", slope);
    require(std::isfinite(height) && height >= 1 && height <= 30 &&
                std::isfinite(radius) && radius >= .4f && radius <= 10 &&
                std::isfinite(step) && step >= 0 && step <= height &&
                std::isfinite(slope) && slope >= 1 && slope <= 60,
            "profile",
            "Height 1–30, radius 0.4–10, step 0–height, slope 1–60 required");
  }
  json value() const {
    return {{"height", height}, {"radius", radius}, {"step", step},
            {"slope", slope},   {"cs", cs},         {"ch", ch}};
  }
};
struct Scratch {
  fs::path path, old;
  Scratch(const fs::path &root) {
    old = fs::current_path();
    fs::create_directories(root);
    path = root / ("scratch-" + std::to_string(getpid()));
    fs::remove_all(path);
    fs::create_directories(path);
  }
  ~Scratch() {
    fs::current_path(old);
    std::error_code ec;
    fs::remove_all(path, ec);
  }
};
struct Mesh {
  dtNavMesh *nav = dtAllocNavMesh();
  dtNavMeshQuery *query = dtAllocNavMeshQuery();
  ~Mesh() {
    dtFreeNavMeshQuery(query);
    dtFreeNavMesh(nav);
  }
  void initQuery() {
    require(dtStatusSucceed(query->init(nav, 65535)), "capacity",
            "Cannot allocate query nodes");
  }
};
std::unique_ptr<Mesh> mesh;
Profile profile;
std::string activeKey;
json activeManifest;
bool verifyWater = false;
void status(const json &id, const std::string &message, int done = 0,
            int total = 0) {
  std::cout << json({{"version", 1},
                     {"id", id},
                     {"event", "progress"},
                     {"message", message},
                     {"done", done},
                     {"total", total}})
                   .dump()
            << std::endl;
}
void checkDT(dtStatus s) {
  require(dtStatusSucceed(s) && !dtStatusDetail(s, DT_BUFFER_TOO_SMALL) &&
              !dtStatusDetail(s, DT_OUT_OF_NODES),
          "capacity", "Navigation query failed or exceeded capacity");
}
json surfaces() {
  json tris = json::array();
  const dtNavMesh *nav = mesh->nav;
  for (int t = 0; t < nav->getMaxTiles(); t++) {
    auto tile = nav->getTile(t);
    if (!tile || !tile->header)
      continue;
    for (int i = 0; i < tile->header->polyCount; i++) {
      auto &poly = tile->polys[i];
      if (poly.getType() == DT_POLYTYPE_OFFMESH_CONNECTION)
        continue;
      auto &detail = tile->detailMeshes[i];
      for (unsigned int k = 0; k < detail.triCount; k++) {
        const unsigned char *tri = &tile->detailTris[(detail.triBase + k) * 4];
        json pts = json::array();
        for (int n = 0; n < 3; n++) {
          const float *v = tri[n] < poly.vertCount
                               ? &tile->verts[poly.verts[tri[n]] * 3]
                               : &tile->detailVerts[(detail.vertBase + tri[n] -
                                                     poly.vertCount) *
                                                    3];
          pts.push_back(toMap(v));
        }
        tris.push_back(pts);
      }
    }
  }
  return tris;
}
void saveMesh(const fs::path &dir) {
  std::ofstream f(dir / "mesh.bin", std::ios::binary);
  auto params = *mesh->nav->getParams();
  f.write((char *)&params, sizeof params);
  const dtNavMesh *nav = mesh->nav;
  for (int i = 0; i < nav->getMaxTiles(); i++) {
    auto t = nav->getTile(i);
    if (!t || !t->header)
      continue;
    uint32_t n = t->dataSize;
    f.write((char *)&n, 4);
    f.write((char *)t->data, n);
  }
  require(f.good(), "cacheWrite", "Cannot save navigation tiles");
}
void loadMesh(const fs::path &dir) {
  auto m = std::make_unique<Mesh>();
  std::ifstream f(dir / "mesh.bin", std::ios::binary);
  dtNavMeshParams p{};
  f.read((char *)&p, sizeof p);
  require(f.good() && p.maxTiles > 0 && p.maxTiles <= 65536 && p.maxPolys > 0,
          "cacheInvalid", "Invalid cache parameters");
  checkDT(m->nav->init(&p));
  uint32_t n;
  while (f.read((char *)&n, 4)) {
    require(n >= sizeof(dtMeshHeader) && n < 64 * 1024 * 1024, "cacheInvalid",
            "Invalid tile size");
    auto d = (unsigned char *)dtAlloc(n, DT_ALLOC_PERM);
    require(d, "capacity", "Cannot allocate cached tile");
    f.read((char *)d, n);
    if (!f.good()) {
      dtFree(d);
      throw Failure("cacheInvalid", "Truncated tile");
    }
    auto s = m->nav->addTile(d, n, DT_TILE_FREE_DATA, 0, nullptr);
    if (dtStatusFailed(s))
      dtFree(d);
    checkDT(s);
  }
  require(f.eof(), "cacheInvalid", "Cannot read tiles");
  m->initQuery();
  mesh = std::move(m);
}
bool blocked(WaterMap *water, float x, float y, float z) {
  if (!water)
    return false;
  auto t = water->ReturnRegionType(x, z, y);
  return t == RegionTypeWater || t == RegionTypeVWater || t == RegionTypeLava ||
         t == RegionTypeSlime || t == RegionTypeDisableNavMesh ||
         t == RegionTypeZoneLine || t == RegionTypeUnsupported;
}
void buildMesh(const std::vector<glm::vec3> &verts,
               const std::vector<unsigned int> &inds, WaterMap *water,
               const json &id, const json &obstacles = json::array()) {
  require(!verts.empty() && !inds.empty() && inds.size() % 3 == 0,
          "emptyGeometry", "No collision geometry");
  require(verts.size() < 10000000 && inds.size() < 30000000, "capacity",
          "Geometry exceeds supported capacity");
  glm::vec3 lo = verts[0], hi = lo;
  for (auto v : verts) {
    require(std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z),
            "geometry", "Nonfinite geometry");
    lo = glm::min(lo, v);
    hi = glm::max(hi, v);
  }
  for (auto i : inds)
    require(i < verts.size(), "geometry", "Invalid triangle index");
  std::cerr << "Geometry bounds " << lo.x << "," << lo.y << "," << lo.z
            << " to " << hi.x << "," << hi.y << "," << hi.z << " triangles "
            << inds.size() / 3 << "\n";
  const int tileSize = 128;
  float tileWorld = tileSize * profile.cs;
  int nx = int(ceil((hi.x - lo.x) / tileWorld)),
      nz = int(ceil((hi.z - lo.z) / tileWorld));
  nx = std::max(1, nx);
  nz = std::max(1, nz);
  require((int64_t)nx * nz <= 65536, "capacity",
          "Zone requires more than 65536 navigation tiles");
  auto m = std::make_unique<Mesh>();
  dtNavMeshParams np{};
  rcVcopy(np.orig, &lo.x);
  np.tileWidth = tileWorld;
  np.tileHeight = tileWorld;
  np.maxTiles = dtNextPow2(std::min(nx * nz * 2, 65536));
  np.maxPolys = 32768;
  checkDT(m->nav->init(&np));
  std::vector<std::vector<int>> bins(nx * nz);
  float border = (ceil(profile.radius / profile.cs) + 3) * profile.cs;
  for (size_t i = 0; i < inds.size(); i += 3) {
    auto a = verts[inds[i]], b = verts[inds[i + 1]], c = verts[inds[i + 2]];
    auto mn = glm::min(a, glm::min(b, c)), mx = glm::max(a, glm::max(b, c));
    int x0 = std::max(0, int(floor((mn.x - lo.x - border) / tileWorld))),
        x1 = std::min(nx - 1, int(floor((mx.x - lo.x + border) / tileWorld)));
    int z0 = std::max(0, int(floor((mn.z - lo.z - border) / tileWorld))),
        z1 = std::min(nz - 1, int(floor((mx.z - lo.z + border) / tileWorld)));
    for (int z = z0; z <= z1; z++)
      for (int x = x0; x <= x1; x++) {
        auto &out = bins[z * nx + x];
        for (int j = 0; j < 3; j++)
          out.push_back(inds[i + j]);
      }
  }
  rcContext ctx;
  int built = 0;
  for (int tz = 0; tz < nz; tz++)
    for (int tx = 0; tx < nx; tx++) {
      auto &ids = bins[tz * nx + tx];
      if ((tz * nx + tx) % 16 == 0)
        status(id, "Building walking surfaces", tz * nx + tx, nx * nz);
      if (ids.empty())
        continue;
      rcConfig cfg{};
      cfg.cs = profile.cs;
      cfg.ch = profile.ch;
      cfg.walkableSlopeAngle = profile.slope;
      cfg.walkableHeight = int(ceil(profile.height / cfg.ch));
      cfg.walkableClimb = int(floor(profile.step / cfg.ch));
      cfg.walkableRadius = int(ceil(profile.radius / cfg.cs));
      cfg.maxEdgeLen = 15;
      cfg.maxSimplificationError = 1.1f;
      cfg.minRegionArea = 0;
      cfg.mergeRegionArea = 400;
      cfg.maxVertsPerPoly = 6;
      cfg.tileSize = tileSize;
      cfg.borderSize = cfg.walkableRadius + 3;
      cfg.width = cfg.height = tileSize + cfg.borderSize * 2;
      cfg.detailSampleDist = cfg.cs * 6;
      cfg.detailSampleMaxError = cfg.ch;
      // Use local surface height intervals; very distant levels get separate
      // tile layers.
      cfg.bmin[0] = lo.x + tx * tileWorld - cfg.borderSize * cfg.cs;
      cfg.bmin[2] = lo.z + tz * tileWorld - cfg.borderSize * cfg.cs;
      cfg.bmax[0] = lo.x + (tx + 1) * tileWorld + cfg.borderSize * cfg.cs;
      cfg.bmax[2] = lo.z + (tz + 1) * tileWorld + cfg.borderSize * cfg.cs;
      std::vector<std::pair<float, float>> intervals;
      for (size_t i = 0; i < ids.size(); i += 3) {
        auto a = verts[ids[i]], b = verts[ids[i + 1]], c = verts[ids[i + 2]];
        auto normal = glm::cross(b - a, c - a);
        float length = glm::length(normal);
        if (length == 0 ||
            normal.y / length <= cos(profile.slope * 3.14159265f / 180.f))
          continue;
        std::vector<glm::vec3> polygon = {a, b, c};
        for (int plane = 0; plane < 4; plane++) {
          if (polygon.empty())
            break;
          int axis = plane < 2 ? 0 : 2;
          float bound = plane % 2 == 0 ? cfg.bmin[axis] : cfg.bmax[axis];
          auto distance = [&](glm::vec3 v) {
            return plane % 2 == 0 ? v[axis] - bound : bound - v[axis];
          };
          std::vector<glm::vec3> out;
          auto prev = polygon.back();
          float pd = distance(prev);
          for (auto v : polygon) {
            float d = distance(v);
            if ((pd >= 0) != (d >= 0))
              out.push_back(prev + (v - prev) * (pd / (pd - d)));
            if (d >= 0)
              out.push_back(v);
            prev = v;
            pd = d;
          }
          polygon = out;
        }
        if (polygon.empty())
          continue;
        float bottom = INFINITY, top = -INFINITY;
        for (auto v : polygon) {
          bottom = std::min(bottom, v.y);
          top = std::max(top, v.y);
        }
        intervals.push_back({bottom, top});
      }
      if (intervals.empty())
        continue;
      std::sort(intervals.begin(), intervals.end());
      std::vector<std::pair<float, float>> bands;
      for (auto interval : intervals) {
        if (bands.empty())
          bands.push_back(interval);
        else {
          auto &last = bands.back();
          if (interval.second - last.first < 24000 ||
              interval.first - last.second <= profile.height + profile.step + 2)
            last.second = std::max(last.second, interval.second);
          else
            bands.push_back(interval);
        }
      }
      int layer = 0;
      for (auto band : bands) {
        float floorMin = band.first, floorMax = band.second;
        cfg.bmin[1] = floorMin - profile.step - 1;
        cfg.bmax[1] = floorMax + profile.height + 1;
        require((cfg.bmax[1] - cfg.bmin[1]) / cfg.ch < 65000, "capacity",
                "Vertical range exceeds voxel capacity");
        auto solid =
            std::unique_ptr<rcHeightfield, decltype(&rcFreeHeightField)>(
                rcAllocHeightfield(), rcFreeHeightField);
        require(solid &&
                    rcCreateHeightfield(&ctx, *solid, cfg.width, cfg.height,
                                        cfg.bmin, cfg.bmax, cfg.cs, cfg.ch),
                "capacity", "Cannot allocate heightfield");
        std::vector<unsigned char> areas(ids.size() / 3);
        rcMarkWalkableTriangles(&ctx, cfg.walkableSlopeAngle, &verts[0].x,
                                verts.size(), ids.data(), areas.size(),
                                areas.data());
        require(rcRasterizeTriangles(&ctx, &verts[0].x, verts.size(),
                                     ids.data(), areas.data(), areas.size(),
                                     *solid, cfg.walkableClimb),
                "geometry", "Rasterization failed");
        rcFilterLowHangingWalkableObstacles(&ctx, cfg.walkableClimb, *solid);
        rcFilterLedgeSpans(&ctx, cfg.walkableHeight, cfg.walkableClimb, *solid);
        rcFilterWalkableLowHeightSpans(&ctx, cfg.walkableHeight, *solid);
        auto compact = std::unique_ptr<rcCompactHeightfield,
                                       decltype(&rcFreeCompactHeightfield)>(
            rcAllocCompactHeightfield(), rcFreeCompactHeightfield);
        require(compact && rcBuildCompactHeightfield(&ctx, cfg.walkableHeight,
                                                     cfg.walkableClimb, *solid,
                                                     *compact),
                "capacity", "Cannot build compact heightfield");
        solid.reset();
        // Skip exact region queries only when the complete tile box is proven
        // free of blocking regions.
        bool waterTile =
            water &&
            water->PotentiallyBlocked(
                glm::vec3(cfg.bmin[0], floorMin, cfg.bmin[2]),
                glm::vec3(cfg.bmax[0], floorMax + profile.height, cfg.bmax[2]));
        // Region classification at every voxel, before erosion, keeps clearance
        // from water boundaries.
        for (int z = 0; z < compact->height; z++)
          for (int x = 0; x < compact->width; x++) {
            auto cell = compact->cells[x + z * compact->width];
            for (unsigned int j = cell.index; j < cell.index + cell.count;
                 j++) {
              if (compact->areas[j] == RC_NULL_AREA)
                continue;
              float px = compact->bmin[0] + (x + .5f) * cfg.cs,
                    pz = compact->bmin[2] + (z + .5f) * cfg.cs,
                    py = compact->bmin[1] + compact->spans[j].y * cfg.ch;
              bool deny = false;
              if (waterTile || verifyWater)
                for (float dx : {-.4f, 0.f, .4f})
                  for (float dz : {-.4f, 0.f, .4f})
                    for (float dy : {.2f, profile.height * .5f})
                      deny = deny || blocked(water, px + dx, py + dy, pz + dz);
              if (verifyWater && deny && !waterTile)
                throw Failure(
                    "regionValidation",
                    "Dry-tile proof disagrees with exact water queries");
              for (auto &box : obstacles) {
                auto a = fromMap(box[0]), b = fromMap(box[1]);
                auto mn = glm::min(a, b), mx = glm::max(a, b);
                deny = deny || (px >= mn.x && px <= mx.x && pz >= mn.z &&
                                pz <= mx.z && py >= mn.y && py <= mx.y);
              }
              if (deny)
                compact->areas[j] = RC_NULL_AREA;
            }
          }
        require(rcErodeWalkableArea(&ctx, cfg.walkableRadius, *compact) &&
                    rcBuildDistanceField(&ctx, *compact) &&
                    rcBuildRegions(&ctx, *compact, cfg.borderSize,
                                   cfg.minRegionArea, cfg.mergeRegionArea),
                "geometry", "Surface partition failed");
        auto contours =
            std::unique_ptr<rcContourSet, decltype(&rcFreeContourSet)>(
                rcAllocContourSet(), rcFreeContourSet);
        require(contours &&
                    rcBuildContours(&ctx, *compact, cfg.maxSimplificationError,
                                    cfg.maxEdgeLen, *contours),
                "geometry", "Contour build failed");
        if (!contours->nconts)
          continue;
        auto poly = std::unique_ptr<rcPolyMesh, decltype(&rcFreePolyMesh)>(
            rcAllocPolyMesh(), rcFreePolyMesh);
        auto detail =
            std::unique_ptr<rcPolyMeshDetail, decltype(&rcFreePolyMeshDetail)>(
                rcAllocPolyMeshDetail(), rcFreePolyMeshDetail);
        require(
            poly && detail &&
                rcBuildPolyMesh(&ctx, *contours, cfg.maxVertsPerPoly, *poly) &&
                rcBuildPolyMeshDetail(&ctx, *poly, *compact,
                                      cfg.detailSampleDist,
                                      cfg.detailSampleMaxError, *detail),
            "geometry", "Polygon build failed");
        if (!poly->npolys)
          continue;
        for (int i = 0; i < poly->npolys; i++) {
          poly->flags[i] = 1;
          poly->areas[i] = 0;
        }
        dtNavMeshCreateParams p{};
        p.verts = poly->verts;
        p.vertCount = poly->nverts;
        p.polys = poly->polys;
        p.polyAreas = poly->areas;
        p.polyFlags = poly->flags;
        p.polyCount = poly->npolys;
        p.nvp = poly->nvp;
        p.detailMeshes = detail->meshes;
        p.detailVerts = detail->verts;
        p.detailVertsCount = detail->nverts;
        p.detailTris = detail->tris;
        p.detailTriCount = detail->ntris;
        p.walkableHeight = profile.height;
        p.walkableRadius = profile.radius;
        p.walkableClimb = profile.step;
        p.tileX = tx;
        p.tileY = tz;
        p.tileLayer = layer++;
        rcVcopy(p.bmin, poly->bmin);
        rcVcopy(p.bmax, poly->bmax);
        p.cs = cfg.cs;
        p.ch = cfg.ch;
        p.buildBvTree = true;
        unsigned char *data = nullptr;
        int size = 0;
        require(dtCreateNavMeshData(&p, &data, &size), "geometry",
                "Tile creation failed");
        auto s = m->nav->addTile(data, size, DT_TILE_FREE_DATA, 0, nullptr);
        if (dtStatusFailed(s))
          dtFree(data);
        checkDT(s);
        built++;
      }
    }
  require(built > 0, "emptyWalkingSurface",
          "No dry walking surfaces for this profile");
  m->initQuery();
  mesh = std::move(m);
}
json candidates(glm::vec3 p) {
  require(bool(mesh), "notPrepared", "Prepare a zone first");
  dtQueryFilter filter;
  filter.setIncludeFlags(1);
  float ext[] = {2 * profile.radius, profile.height, 2 * profile.radius};
  dtPolyRef refs[2048];
  int count = 0;
  checkDT(mesh->query->queryPolygons(&p.x, ext, &filter, refs, &count, 2048));
  json out = json::array();
  for (int i = 0; i < count; i++) {
    float q[3];
    bool over;
    checkDT(mesh->query->closestPointOnPoly(refs[i], &p.x, q, &over));
    if (hypot(q[0] - p.x, q[2] - p.z) > 2 * profile.radius + .001 ||
        fabs(q[1] - p.y) > profile.height + .001)
      continue;
    bool duplicate = false;
    for (auto &e : out) {
      auto v = fromMap(e["point"]);
      if (glm::distance(v, glm::vec3(q[0], q[1], q[2])) < .1)
        duplicate = true;
    }
    if (!duplicate)
      out.push_back(
          {{"point", toMap(q)},
           {"poly", std::to_string(refs[i])},
           {"distance", glm::distance(p, glm::vec3(q[0], q[1], q[2]))}});
  }
  std::sort(out.begin(), out.end(), [](const json &a, const json &b) {
    return a["distance"].get<float>() < b["distance"].get<float>();
  });
  // Adjacent polygons on the same surface yield several projections; retain the
  // nearest per height.
  json floors = json::array();
  for (auto &e : out) {
    bool found = false;
    for (auto &f : floors)
      if (fabs(e["point"][2].get<float>() - f["point"][2].get<float>()) < .5f)
        found = true;
    if (!found)
      floors.push_back(e);
  }
  return floors;
}
dtPolyRef polyReference(const json &value) {
  if (value.is_number_unsigned()) return value.get<dtPolyRef>();
  auto s=value.get<std::string>();
  require(!s.empty() && s.size()<=20 && s.find_first_not_of("0123456789")==std::string::npos,"endpoint","Invalid polygon reference");
  return std::stoull(s);
}
std::pair<dtPolyRef, glm::vec3> endpoint(const json &e) {
  auto p = fromMap(e.at("point"));
  dtPolyRef ref = polyReference(e.at("poly"));
  require(mesh->nav->isValidPolyRef(ref), "endpoint",
          "Endpoint belongs to a different mesh");
  float q[3];
  bool over = false;
  checkDT(mesh->query->closestPointOnPoly(ref, &p.x, q, &over));
  // Detour may report over=false for its own closest-point result on a polygon
  // edge. Accept that boundary within floating-point tolerance, then use q.
  require(hypot(p.x - q[0], p.z - q[2]) < .01f &&
              glm::distance(p, glm::vec3(q[0], q[1], q[2])) < .2f,
          "endpoint", "Endpoint must be on its selected surface");
  return {ref, glm::vec3(q[0], q[1], q[2])};
}
json findRoute(const json &req) {
  require(bool(mesh), "notPrepared", "Prepare a zone first");
  auto a = endpoint(req.at("start")), b = endpoint(req.at("end"));
  dtQueryFilter filter;
  filter.setIncludeFlags(1);
  std::vector<dtPolyRef> polys(32768);
  int count = 0;
  auto s = mesh->query->findPath(a.first, b.first, &a.second.x, &b.second.x,
                                 &filter, polys.data(), &count, polys.size());
  checkDT(s);
  require(count > 0 && !dtStatusDetail(s, DT_PARTIAL_RESULT) &&
              polys[count - 1] == b.first,
          "noRoute", "No walking route found");
  std::vector<float> straight(32768 * 3);
  std::vector<unsigned char> flags(32768);
  std::vector<dtPolyRef> refs(32768);
  int n = 0;
  checkDT(mesh->query->findStraightPath(
      &a.second.x, &b.second.x, polys.data(), count, straight.data(),
      flags.data(), refs.data(), &n, 32768, DT_STRAIGHTPATH_ALL_CROSSINGS));
  json points = json::array();
  points.push_back(toMap(&a.second.x));
  glm::vec3 prev = a.second;
  double length = 0;
  dtPolyRef current = a.first;
  // Sample each corridor segment on its polygon. All crossings avoids
  // interpolation across floors.
  for (int i = 1; i < n; i++) {
    glm::vec3 from(straight[(i - 1) * 3], straight[(i - 1) * 3 + 1],
                   straight[(i - 1) * 3 + 2]),
        to(straight[i * 3], straight[i * 3 + 1], straight[i * 3 + 2]);
    if (refs[i - 1])
      current = refs[i - 1];
    int steps = std::max(1, (int)ceil(glm::distance(from, to) / .8f));
    require(points.size() + steps <= 200000, "capacity",
            "Route exceeds point capacity");
    for (int j = 1; j <= steps; j++) {
      auto p = from + (to - from) * (float(j) / steps);
      float height = 0;
      auto hs = mesh->query->getPolyHeight(current, &p.x, &height);
      if (dtStatusFailed(hs)) {
        float q[3];
        bool over;
        checkDT(mesh->query->closestPointOnPoly(current, &p.x, q, &over));
        require(hypot(q[0] - p.x, q[2] - p.z) < .2, "routeValidation",
                "Route leaves the walking surface");
        height = q[1];
      }
      p.y = height;
      length += glm::distance(prev, p);
      points.push_back(toMap(&p.x));
      prev = p;
    }
  }
  require(glm::distance(prev, b.second) < .5f, "routeValidation",
          "Route did not reach the destination");
  return {{"points", points},
          {"distance", length},
          {"start", req["start"]},
          {"end", req["end"]}};
}
json inventory(const fs::path &root, const json &id) {
  json zones = json::array(), failures = json::array();
  int count = 0;
  for (auto &f : fs::directory_iterator(root)) {
    auto ext = f.path().extension().u8string();
    if (ext != ".s3d" && ext != ".eqg")
      continue;
    auto key = f.path().stem().u8string();
    if (++count % 100 == 0)
      status(id, "Inspecting zone archives", count, 0);
    try {
      EQEmu::PFS::Archive ar;
      if (!ar.Open(f.path().u8string())) {
        failures.push_back({{"archive", f.path().filename().u8string()},
                            {"error", "Unreadable archive"}});
        continue;
      }
      bool zone = false;
      if (ext == ".s3d")
        zone = ar.Exists(key + ".wld") && ar.Exists("objects.wld");
      else {
        std::vector<std::string> names;
        ar.GetFilenames("zon", names);
        zone = !names.empty() || fs::exists(root / (key + ".zon"));
      }
      if (zone)
        zones.push_back({{"key", key}, {"format", ext.substr(1)}});
    } catch (std::exception &e) {
      failures.push_back(
          {{"archive", f.path().filename().u8string()}, {"error", e.what()}});
    }
  }
  return {{"zones", zones}, {"failures", failures}};
}
json prepare(const json &req) {
  auto id = req.at("id");
  verifyWater = req.value("verifyWater", false);
  profile = Profile(req.value("profile", json::object()));
  fs::path root = fs::canonical(fs::u8path(req.at("root").get<std::string>())),
           cache = fs::absolute(fs::u8path(req.at("cache").get<std::string>()));
  std::string zone = req.at("zone"), format = req.at("format");
  require(zone.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789_-") ==
                  std::string::npos &&
              !zone.empty(),
          "zone", "Invalid zone identifier");
  require(format == "s3d" || format == "eqg", "format",
          "Choose S3D or EQG geometry");
  require(fs::is_regular_file(root / (zone + "." + format)), "unavailable",
          "Geometry unavailable");
  auto key = digest(root.u8string() + zone + format + profile.value().dump() +
                    engineVersion);
  auto dir = cache / key;
  fs::create_directories(cache);
  if (!req.value("verifyWater", false) && !req.value("validateOnly", false) &&
      fs::exists(dir / "manifest.json")) {
    try {
      auto manifest = readJSON(dir / "manifest.json");
      bool fresh = manifest["engine"] == engineVersion;
      for (auto it = manifest["assets"].begin(); it != manifest["assets"].end();
           ++it)
        fresh = fresh &&
                (fileHash(root / it.key()) == it.value().get<std::string>());
      if (fresh) {
        activeManifest = manifest;
        if (activeKey != key) {
          loadMesh(dir);
          activeKey = key;
        }
        return {{"contentKey", digest(manifest.dump())},
                {"cached", true},
                {"surfaceFile", (dir / "surfaces.json").u8string()},
                {"manifest", manifest},
                {"key", key}};
      }
    } catch (std::exception &e) {
      std::cerr << "Cache rebuild: " << e.what() << '\n';
    }
  }
  activeKey.clear();
  activeManifest = nullptr;
  mesh.reset();
  status(id, "Reading zone geometry");
  Scratch scratch(cache);
  sourceRoot = root; // Reads resolve to the game folder; all writes stay in scratch.
  fs::current_path(scratch.path);
  dependencies.clear();
  sourceHashes.clear();
  recordSourceReads = true;
  atlas_format = format;
  Map converter;
  require(converter.Build(zone, false), "geometryRead",
          "Cannot read complete zone collision geometry");
  require(converter.Write("geometry.map"), "geometryRead",
          "Cannot convert zone collision geometry");
  ZoneMap geo;
  require(geo.Load("geometry.map"), "geometryRead",
          "Cannot load converted geometry");
  WaterWriter writer;
  bool waterOK = format == "s3d" ? writer.BuildAndWriteS3D(zone)
                                 : (writer.BuildAndWriteEQG(zone) ||
                                    writer.BuildAndWriteEQG4(zone));
  require(waterOK, "regionRead", "Cannot read required water-region data");
  std::unique_ptr<WaterMap> water(WaterMap::LoadWaterMapfile("", zone));
  require(bool(water), "regionRead", "Cannot load water-region data");
  if (req.value("validateOnly", false))
    return {{"validated", true},
            {"triangles", geo.GetCollidableInds().size() / 3},
            {"engine", engineVersion}};
  buildMesh(geo.GetCollidableVerts(), geo.GetCollidableInds(), water.get(), id);
  json assets = json::object();
  for (auto &dep : dependencies) {
    auto p = fs::path(dep);
    if (p.is_relative() && p.filename() == p) {
      assets[dep] = fileHash(root / p);
      require(sourceHashes.at(dep) == assets[dep].get<std::string>(),
              "assetsChanged",
              "Zone assets changed during preparation; retry after the game "
              "update finishes");
    }
  }
  assets[zone + "." + format] = fileHash(root / (zone + "." + format));
  json manifest = {{"engine", engineVersion},
                   {"zone", zone},
                   {"format", format},
                   {"profile", profile.value()},
                   {"assets", assets}};
  auto out = scratch.path / "complete";
  fs::create_directory(out);
  saveMesh(out);
  writeJSON(out / "surfaces.json", surfaces());
  writeJSON(out / "manifest.json", manifest);
  fs::current_path(scratch.old);
  fs::remove_all(dir);
  fs::rename(out, dir);
  activeKey = key;
  activeManifest = manifest;
  return {{"contentKey", digest(manifest.dump())},
          {"cached", false},
          {"surfaceFile", (dir / "surfaces.json").u8string()},
          {"manifest", manifest},
          {"key", key}};
}
json fixture(const json &req) {
  profile = Profile(req.value("profile", json::object()));
  std::vector<glm::vec3> v;
  std::vector<unsigned int> ids;
  for (auto &tri : req.at("triangles")) {
    require(tri.size() == 3, "fixture", "Triangle needs three vertices");
    for (auto &p : tri) {
      v.push_back(fromMap(p));
      ids.push_back(v.size() - 1);
    }
  }
  for (size_t i = 0; i < ids.size(); i += 3)
    std::swap(ids[i + 1], ids[i + 2]);
  activeKey.clear();
  buildMesh(v, ids, nullptr, req["id"], req.value("blocked", json::array()));
  activeManifest = {{"zone", "fixture"}, {"format", "synthetic"}, {"assets", json::object()}};
  return {{"triangles", surfaces()}};
}
#include "ActionRoutes.h"

int main() {
  eqLogInit(EQEmu::Log::LogError | EQEmu::Log::LogWarn);
  eqLogRegister(std::make_shared<EQEmu::Log::LogStdOut>());
  std::string line;
  while (std::getline(std::cin, line)) {
    json id = nullptr;
    try {
      require(line.size() < 128 * 1024 * 1024, "capacity", "Request too large");
      auto req = json::parse(line);
      id = req.at("id");
      require(req.value("version", 0) == 1, "version",
              "Unsupported protocol version");
      auto cmd = req.at("command").get<std::string>();
      recordSourceReads = false;
      auto start = std::chrono::steady_clock::now();
      json result;
      if (cmd == "locateAsset") {
        result = json::array();
        std::string name = req.at("name");
        for (auto &f :
             fs::directory_iterator(req.at("root").get<std::string>())) {
          auto ext = f.path().extension();
          if (ext != ".eqg" && ext != ".s3d")
            continue;
          EQEmu::PFS::Archive ar;
          if (ar.Open(f.path().u8string()) && ar.Exists(name))
            result.push_back(f.path().filename().u8string());
        }
        result = {{"archives", result}};
      } else if (cmd == "inventory")
        result = inventory(fs::u8path(req.at("root").get<std::string>()), id);
      else if (cmd == "prepare")
        result = prepare(req);
      else if (cmd == "projectPoint")
        result = {{"candidates", candidates(fromMap(req.at("point")))}};
      else if (cmd == "findRoute")
        result = actionRoute(req);
      else if (cmd == "fixture")
        result = fixture(req);
      else
        throw Failure("command", "Unknown command");
      result["elapsedMS"] = std::chrono::duration<double, std::milli>(
                                std::chrono::steady_clock::now() - start)
                                .count();
      std::cout << json({{"version", 1},
                         {"id", id},
                         {"event", "result"},
                         {"result", result}})
                       .dump()
                << std::endl;
    } catch (Failure &e) {
      std::cout << json({{"version", 1},
                         {"id", id},
                         {"event", "error"},
                         {"code", e.code},
                         {"message", e.what()},
                         {"details", e.details}})
                       .dump()
                << std::endl;
    } catch (std::exception &e) {
      std::cout << json({{"version", 1},
                         {"id", id},
                         {"event", "error"},
                         {"code", "invalidData"},
                         {"message", e.what()}})
                       .dump()
                << std::endl;
    }
  }
}
