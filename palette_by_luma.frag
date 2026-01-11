#version 300 es
precision highp float;

in vec2 v_uv;

uniform vec2 u_gridSize;
uniform sampler2D u_charTex; // attachment 0
uniform sampler2D u_fgTex;   // attachment 1 (fallback luminance si besoin)

// bins & palettes
uniform int u_bins;                 // 2..8
uniform float u_paletteFG[24];      // 8 * RGB
uniform float u_paletteBG[24];      // 8 * RGB

// signatures apprises (une par bin). On passe en float pour éviter les soucis d'uniform int array.
uniform float u_sig[8];             // ex: sig = r + 256*g

uniform int u_useSig; // 1 = strict glyph, 0 = luma

layout(location = 0) out vec4 o_character;
layout(location = 1) out vec4 o_primaryColor;
layout(location = 2) out vec4 o_secondaryColor;

float luma709(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 palFG(int idx) {
  idx = clamp(idx, 0, 7);
  int base = idx * 3;
  return vec3(u_paletteFG[base+0], u_paletteFG[base+1], u_paletteFG[base+2]);
}
vec3 palBG(int idx) {
  idx = clamp(idx, 0, 7);
  int base = idx * 3;
  return vec3(u_paletteBG[base+0], u_paletteBG[base+1], u_paletteBG[base+2]);
}

vec2 cellCenterUV() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 p = uv * u_gridSize;
  return (floor(p) + 0.5) / u_gridSize;
}

int binFromSignature(vec4 ch, int bins) {
  // ch est normalisé [0..1] -> on reconstruit les octets
  int r = int(round(ch.r * 255.0));
  int g = int(round(ch.g * 255.0));
  float sig = float(r + 256 * g);

  // match direct contre les signatures apprises
  for (int i = 0; i < 8; i++) {
    if (i >= bins) break;
    if (abs(sig - u_sig[i]) < 0.5) return i;
  }
  return -1;
}

void main() {
  vec2 uv = cellCenterUV();

  vec4 ch = texture(u_charTex, uv);
  vec4 fg = texture(u_fgTex, uv);

  int bins = clamp(u_bins, 2, 8);

  int idx = -1;

  if (u_useSig == 1) {
    idx = binFromSignature(ch, bins);
  }

  // fallback OU mode luma
  if (idx < 0) {
    // plus “ASCII-friendly” que Rec.709 : moyenne RGB
    float y = (fg.r + fg.g + fg.b) / 3.0;
    // petit epsilon anti-seuil
    float eps = 1.0 / 1024.0;
    idx = int(floor((y + eps) * float(bins)));
    if (idx >= bins) idx = bins - 1;
  }

  o_character      = ch;
  o_primaryColor   = vec4(palFG(idx), 1.0);
  o_secondaryColor = vec4(palBG(idx), 1.0);
}



