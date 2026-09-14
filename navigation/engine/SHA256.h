#pragma once
#include <array>
#include <algorithm>
#include <cstdint>
#include <cstring>
// Portable SHA-256 (FIPS 180-4), used only for cache/source identity.
class SHA256 {
  uint32_t h[8]={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
  unsigned char buffer[64]{}; uint64_t bytes=0;size_t used=0;
  static uint32_t r(uint32_t x,int n){return (x>>n)|(x<<(32-n));}
  void block(const unsigned char *p){
    static const uint32_t k[64]={0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
    uint32_t w[64];for(int i=0;i<16;i++)w[i]=(uint32_t(p[4*i])<<24)|(uint32_t(p[4*i+1])<<16)|(uint32_t(p[4*i+2])<<8)|p[4*i+3];
    for(int i=16;i<64;i++){auto a=w[i-15],b=w[i-2];w[i]=w[i-16]+(r(a,7)^r(a,18)^(a>>3))+w[i-7]+(r(b,17)^r(b,19)^(b>>10));}
    uint32_t a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],v=h[7];
    for(int i=0;i<64;i++){auto t=v+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+k[i]+w[i];auto u=(r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c));v=g;g=f;f=e;e=d+t;d=c;c=b;b=a;a=t+u;}
    h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=v;
  }
public:
  void update(const void *data,size_t n){bytes+=n;auto p=static_cast<const unsigned char*>(data);while(n){auto count=std::min(n,64-used);memcpy(buffer+used,p,count);used+=count;p+=count;n-=count;if(used==64){block(buffer);used=0;}}}
  void finish(unsigned char out[32]){uint64_t bits=bytes*8;unsigned char pad[128]{};pad[0]=0x80;auto count=used<56?56-used:120-used;update(pad,count);for(int i=0;i<8;i++)pad[i]=static_cast<unsigned char>(bits>>(56-8*i));update(pad,8);for(int i=0;i<32;i++)out[i]=static_cast<unsigned char>(h[i/4]>>(24-8*(i%4)));}
};
