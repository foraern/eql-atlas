// Explicit, asset-bound crossing graph layered over unchanged dry walking meshes.
// Crossing geometry is a schematic instruction, never a simulated jump trajectory.
#pragma once
#include <queue>
#include <tuple>
#include <numeric>

struct MovementOptions {
  std::string mode = "walk", capability = "Standard movement";
  std::set<std::string> actions;
  double jumpDistance = 16, jumpRise = 2, jumpDrop = 2, drop = 8;
  MovementOptions(const json &j) {
    mode = j.value("mode", mode);
    require(mode == "walk" || mode == "tested" || mode == "preview", "capabilities", "Unknown routing mode");
    capability = j.value("capability", capability);
    require(!capability.empty() && capability.size() <= 120, "capabilities", "Name the character movement setup (up to 120 characters)");
    auto allowed = j.value("actions", json::array({"jump"}));
    require(allowed.is_array() && allowed.size() <= 5, "capabilities", "Invalid action capabilities");
    for (const auto &a : allowed) {
      auto name = a.get<std::string>();
      require(name == "jump" || name == "drop" || name == "swim" || name == "door" || name == "lift", "capabilities", "Unsupported action capability");
      actions.insert(name);
    }
    jumpDistance = j.value("jumpDistance", jumpDistance); jumpRise = j.value("jumpRise", jumpRise);
    jumpDrop = j.value("jumpDrop", jumpDrop); drop = j.value("drop", drop);
    for (double v : {jumpDistance, jumpRise, jumpDrop, drop})
      require(std::isfinite(v) && v >= 0 && v <= 100, "capabilities", "Crossing limits must be between 0 and 100 game units");
  }
};

// Weak components are only an optimisation; every walking edge still uses a
// complete Detour query, including direction and capacity validation.
struct NavigationComponents {
  std::map<dtPolyRef, dtPolyRef> parents;
  dtPolyRef root(dtPolyRef r) {
    auto top = r;
    while (parents.at(top) != top) top = parents.at(top);
    while (r != top) {auto next = parents.at(r); parents[r] = top; r = next;}
    return top;
  }
  NavigationComponents() {
    const dtNavMesh *nav = mesh->nav;
    for (int i = 0; i < nav->getMaxTiles(); i++) {
      auto t = nav->getTile(i); if (!t || !t->header) continue;
      for (int p = 0; p < t->header->polyCount; p++) {auto r = nav->getPolyRefBase(t) | p; parents[r] = r;}
    }
    require(parents.size() <= 200000, "capacity", "Action graph exceeds polygon capacity");
    for (auto &entry : parents) {
      const dtMeshTile *t; const dtPoly *p; checkDT(nav->getTileAndPolyByRef(entry.first, &t, &p));
      for (auto l = p->firstLink; l != DT_NULL_LINK; l = t->links[l].next) {
        auto other = t->links[l].ref; if (!other) continue;
        auto a = root(entry.first), b = root(other); if (a != b) parents[std::max(a,b)] = std::min(a,b);
      }
    }
  }
};
json reachableSurfaces(dtPolyRef start) {
  std::set<dtPolyRef> visited{start}; std::queue<dtPolyRef> pending; pending.push(start);
  json triangles = json::array();
  while (!pending.empty()) {
    auto r = pending.front(); pending.pop(); const dtMeshTile *t; const dtPoly *p;
    checkDT(mesh->nav->getTileAndPolyByRef(r, &t, &p));
    // Fan polygons are sufficient for a reachability overlay, not height queries.
    for (int i = 1; i + 1 < p->vertCount; i++)
      triangles.push_back(json::array({toMap(&t->verts[p->verts[0]*3]), toMap(&t->verts[p->verts[i]*3]), toMap(&t->verts[p->verts[i+1]*3])}));
    require(triangles.size() <= 200000, "capacity", "Reachable surface overlay exceeds capacity");
    for (auto l = p->firstLink; l != DT_NULL_LINK; l = t->links[l].next) {
      auto next = t->links[l].ref; if (next && visited.insert(next).second) pending.push(next);
    }
  }
  return triangles;
}
bool testedFor(const json &link, const MovementOptions &options) {
  if (!link.count("verification") || !link["verification"].is_object()) return false;
  auto v = link["verification"];
  if (v.value("status", "") != "userTested" || v.value("capability", "") != options.capability ||
      v.value("date", "").empty() || v.value("notes", "").empty() || !v.count("profile")) return false;
  auto actual = profile.value();
  for (auto key : {"height", "radius", "step", "slope"})
    if (!v["profile"].count(key) || !v["profile"][key].is_number() ||
        std::abs(v["profile"][key].get<double>() - actual[key].get<double>()) > .001) return false;
  return true;
}
json walkingSegment(json r) {
  return {{"kind", "walk"}, {"status", "static"}, {"points", r["points"]}, {"distance", r["distance"]}};
}
json actionRoute(const json &req) {
  require(bool(mesh), "notPrepared", "Prepare a zone first");
  MovementOptions options(req.value("movement", json::object()));
  auto start = endpoint(req.at("start")), end = endpoint(req.at("end"));
  // Always prefer an entirely dry walking route, regardless of crossing costs.
  try {
    auto r = findRoute(req); r["segments"] = json::array({walkingSegment(r)});
    r["status"] = "static"; r["crossings"] = 0; r["unverifiedCrossings"] = 0; return r;
  } catch (const Failure &e) {if (e.code != "noRoute") throw;}
  NavigationComponents components;
  struct Edge {int from, to; json segment; bool unverified;};
  std::vector<json> nodes = {req["start"], req["end"]}; std::vector<Edge> crossings;
  json excluded = json::array(); std::set<std::string> ids;
  auto catalogs = req.value("catalogs", json::array());
  require(catalogs.is_array() && catalogs.size() <= 64, "capacity", "At most 64 crossing catalogs are supported");
  int linkCount = 0;
  for (const auto &catalog : catalogs) {
    require(catalog.is_object() && catalog.value("version", 0) == 1, "catalog", "Unsupported crossing catalog version");
    if (catalog.value("zone", "") != activeManifest.value("zone", "") || catalog.value("format", "") != activeManifest.value("format", "")) continue;
    if (!catalog.count("assets") || catalog["assets"] != activeManifest["assets"]) {
      excluded.push_back({{"reason", "Source assets changed; crossing catalog needs review"}}); continue;
    }
    const auto &links = catalog.at("links"); require(links.is_array(), "catalog", "Crossing links must be an array");
    for (const auto &link : links) {
      require(++linkCount <= 64, "capacity", "At most 64 crossings per zone are supported");
      auto id = link.at("id").get<std::string>(), kind = link.at("kind").get<std::string>();
      require(!id.empty() && id.size() <= 120 && ids.insert(id).second, "catalog", "Crossing identifiers must be unique");
      require(kind == "jump" || kind == "drop" || kind == "swim" || kind == "door" || kind == "lift", "catalog", "Unknown crossing action");
      auto from = fromMap(link.at("from")), to = fromMap(link.at("to"));
      auto label = link.value("label", kind); require(label.size() <= 240, "catalog", "Crossing label is too long");
      auto reject = [&](std::string reason) {excluded.push_back({{"id",id},{"kind",kind},{"label",label},{"reason",reason},{"from",link["from"]},{"to",link["to"]}});};
      if (options.mode == "walk" || !options.actions.count(kind)) {reject(kind + " is excluded by the routing preference"); continue;}
      bool tested = testedFor(link, options);
      if (!tested && options.mode != "preview") {reject("Not tested for this movement setup and walking profile"); continue;}
      auto a = candidates(from), b = candidates(to);
      if (a.size() != 1 || b.size() != 1) {reject("Crossing endpoint is unavailable or has ambiguous floors"); continue;}
      from = endpoint(a[0]).second; to = endpoint(b[0]).second;
      double horizontal = hypot(to.x-from.x, to.z-from.z), rise = to.y-from.y;
      if (kind == "jump" && (horizontal > options.jumpDistance || rise > options.jumpRise || -rise > options.jumpDrop)) {reject("Jump exceeds the selected distance or height limits"); continue;}
      if (kind == "drop" && (rise > .2 || -rise > options.drop)) {reject("Drop exceeds the selected limit or points uphill"); continue;}
      // Catalog authors must author reverse links explicitly: a test of one
      // direction does not verify the reverse jump, drop, lift or door action.
      json points = json::array({a[0]["point"]});
      auto via = link.value("via", json::array());
      require(via.is_array() && via.size() <= 512, "capacity", "Crossing waypoint capacity exceeded");
      require(kind != "jump" || via.empty(), "catalog", "Jump links use takeoff and landing only; no inferred flight curve");
      for (const auto &p : via) {fromMap(p); points.push_back(p);} points.push_back(b[0]["point"]);
      double distance = 0; for (size_t i=1;i<points.size();i++) distance += glm::distance(fromMap(points[i-1]),fromMap(points[i]));
      require(link.value("note", "").size() <= 4096, "catalog", "Crossing note is too long");
      auto segment = json{{"id",id},{"kind",kind},{"label",label},{"status",tested ? "userTested" : "unverified"},{"points",points},{"distance",distance},{"note",tested ? link["verification"].value("notes", "") : link.value("note", "Crossing requires in-game verification")}};
      if (tested) segment["verification"] = link["verification"];
      int i = nodes.size(); nodes.push_back(a[0]); nodes.push_back(b[0]); crossings.push_back({i,i+1,segment,!tested});
    }
  }
  using Score = std::pair<int,double>; const Score infinity{1000000, INFINITY};
  std::vector<Score> best(nodes.size(), infinity); std::vector<int> previous(nodes.size(), -1);
  std::vector<json> incoming(nodes.size());
  using Item = std::tuple<int,double,int>; std::priority_queue<Item,std::vector<Item>,std::greater<Item>> pending;
  best[0] = {0,0}; pending.emplace(0,0,0); int queries=0;
  auto relax = [&](int a, int b, json segment, bool unverified) {
    // Prefer fewer unverified transitions; discourage unnecessary actions.
    Score score{best[a].first + int(unverified), best[a].second + segment["distance"].get<double>() + (segment["kind"] == "walk" ? 0 : 50)};
    if (score < best[b]) {best[b]=score;previous[b]=a;incoming[b]=std::move(segment);pending.emplace(score.first,score.second,b);}
  };
  while (!pending.empty()) {
    auto [unverified,cost,i] = pending.top(); pending.pop(); if (best[i] != Score{unverified,cost}) continue;
    if (i == 1) break;
    for (auto &e : crossings) if (e.from == i) relax(i,e.to,e.segment,e.unverified);
    for (int j=0;j<int(nodes.size());j++) {
      if (i==j || components.root(polyReference(nodes[i]["poly"])) != components.root(polyReference(nodes[j]["poly"]))) continue;
      require(++queries <= 4096, "capacity", "Action route exceeds walking-query capacity");
      try {relax(i,j,walkingSegment(findRoute({{"start",nodes[i]},{"end",nodes[j]}})),false);}
      catch (const Failure &e) {if(e.code != "noRoute") throw;}
    }
  }
  if (previous[1] == -1) {
    Failure failure("noRoute", options.mode == "walk" ? "No walking route found" : "No route using the supported crossings and selected capabilities");
    failure.details = {{"reachable",reachableSurfaces(start.first)},{"excluded",excluded},{"supportedCrossings",crossings.size()},
      {"explanation", excluded.empty() ? "The destination is disconnected. No usable crossing is recorded for the break; this does not prove the journey is impossible in-game." : "Known crossings are excluded or insufficient. Review the crossing requirements; the green area is reachable by walking."}};
    throw failure;
  }
  std::vector<json> reversed; for(int i=1;i!=0;i=previous[i]) reversed.push_back(incoming[i]);
  std::reverse(reversed.begin(),reversed.end()); json segments=json::array(),points=json::array(); double distance=0;int actions=0,unverified=0;
  for(auto &segment:reversed) {
    segments.push_back(segment);distance += segment["distance"].get<double>();
    if(segment["kind"] != "walk") {actions++;if(segment["status"] == "unverified") unverified++;}
    for(const auto &point:segment["points"]) {if(points.empty() || point != points.back()) points.push_back(point);}
    require(points.size() <= 200000, "capacity", "Combined route exceeds point capacity");
  }
  require(!points.empty() && glm::distance(fromMap(points.back()),end.second) < .5, "routeValidation", "Action route did not reach the destination");
  return {{"points",points},{"segments",segments},{"distance",distance},{"distanceKind","Walking plus schematic crossing lengths"},{"start",req["start"]},{"end",req["end"]},{"crossings",actions},{"unverifiedCrossings",unverified},{"status",unverified ? "requiresVerification" : "userTestedCrossings"}};
}
