#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
extern std::string atlas_format;
void atlas_dependency(const std::string &path);

void atlas_missing_geometry(const std::string &name);

std::string atlas_source_path(const std::string &path);

FILE *atlas_open_source(const std::string &path);
