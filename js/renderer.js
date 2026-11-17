/* Savage scene renderer: draws a Savage map's terrain, sky, fog and objects with WebGL2
   from the compact map JSON made by extract.py.  World axes: x east, y north, z up (game units). */
(function () {
  'use strict';
  const TILE = 100,
    EXT = 36,
    MODEL_SCALE = 0.390625; // Savage model units -> world units (fit from how modular walls/fences join)                       // tiles of flat skirt drawn past the map edge

  /* ---------- small math ---------- */
  const M4 = {
    persp(fovy, asp, n, f) {
      const t = 1 / Math.tan(fovy / 2),
        r = 1 / (n - f);
      return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (n + f) * r, -1, 0, 0, 2 * n * f * r, 0]);
    },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) {
          let s = 0;
          for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
          o[c * 4 + r] = s;
        }
      return o;
    },
    inv(m) {
      const a = m,
        o = new Float32Array(16);
      const b00 = a[0] * a[5] - a[1] * a[4],
        b01 = a[0] * a[6] - a[2] * a[4],
        b02 = a[0] * a[7] - a[3] * a[4],
        b03 = a[1] * a[6] - a[2] * a[5],
        b04 = a[1] * a[7] - a[3] * a[5],
        b05 = a[2] * a[7] - a[3] * a[6],
        b06 = a[8] * a[13] - a[9] * a[12],
        b07 = a[8] * a[14] - a[10] * a[12],
        b08 = a[8] * a[15] - a[11] * a[12],
        b09 = a[9] * a[14] - a[10] * a[13],
        b10 = a[9] * a[15] - a[11] * a[13],
        b11 = a[10] * a[15] - a[11] * a[14];
      let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      d = 1 / d;
      o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * d;
      o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * d;
      o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * d;
      o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * d;
      o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * d;
      o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * d;
      o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * d;
      o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * d;
      o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * d;
      o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * d;
      o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * d;
      o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * d;
      o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * d;
      o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * d;
      o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * d;
      o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * d;
      return o;
    },
    view(eye, yaw, pitch) {
      // yaw 0 = looking north (+y), positive = turn right (clockwise)
      const cp = Math.cos(pitch),
        f = [Math.sin(yaw) * cp, Math.cos(yaw) * cp, Math.sin(pitch)];
      const r = [Math.cos(yaw), -Math.sin(yaw), 0];
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      const d = a => a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2];
      return new Float32Array([
        r[0],
        u[0],
        -f[0],
        0,
        r[1],
        u[1],
        -f[1],
        0,
        r[2],
        u[2],
        -f[2],
        0,
        -d(r),
        -d(u),
        d(f),
        1,
      ]);
    },
  };
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
  }
  const b64 = s => {
    const bin = atob(s),
      u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };

  /* ---------- shaders ---------- */
  const COMMON = `
uniform vec3 uEye; uniform vec3 uFog; uniform vec2 uFogR; uniform vec3 uSunDir;
vec3 applyFog(vec3 c, vec3 wp){ float d=distance(wp,uEye); float f=clamp((d-uFogR.x)/(uFogR.y-uFogR.x),0.,1.); f=f*f*(3.-2.*f); return mix(c,uFog,f); }
vec3 tone(vec3 c){ c=max(c,0.); return pow(c/(1.+c*0.18),vec3(0.96)); }
`;
  const TER_VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in float aShd;
uniform mat4 uVP; out vec3 vW; out vec3 vN; out float vS;
void main(){ vW=aPos; vN=aNrm; vS=aShd; gl_Position=uVP*vec4(aPos,1.); }`;
  const TER_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp usampler2D; precision highp sampler2DArray;
in vec3 vW; in vec3 vN; in float vS; out vec4 o;
uniform usampler2D uMat; uniform usampler2D uMat2; uniform sampler2D uCol; uniform sampler2D uNoise; uniform ivec2 uSize; uniform sampler2DArray uTex; uniform int uReal;
uniform vec3 uL0,uL1,uAmb;
${COMMON}
float nz(vec2 p){ return texture(uNoise,p).r; }
float fbm(vec2 p){ return nz(p)*.5+nz(p*2.03+.17)*.25+nz(p*4.1+.41)*.125+nz(p*8.3+.7)*.0625; }
vec3 N1,N2,TW; float nA,nB,nC,nD,nR,slope;
float tz(float s,float o){ return TW.z*nz(vW.xy/s+o)+TW.x*nz(vW.yz/s+o)+TW.y*nz(vW.xz/s+o); }
vec3 grass(vec3 a,vec3 b){ return mix(a,b,smoothstep(.25,.75,nB))*(.78+.4*nD)*(mix(1.,1.12,smoothstep(.55,.8,nA))); }
vec3 mat(uint id){
  if(id==0u) return grass(vec3(.30,.42,.13),vec3(.45,.56,.19));
  if(id==1u) return mix(vec3(.43,.33,.21),vec3(.52,.41,.27),nB)*(.8+.35*nD);
  if(id==2u) return mix(vec3(.42,.39,.35),vec3(.55,.51,.45),nR)*(.82+.3*nD);
  if(id==3u) return mix(vec3(.62,.42,.26),vec3(.74,.55,.35),nR)*(.85+.25*nD);
  if(id==4u) return mix(vec3(.80,.84,.90),vec3(.93,.95,.98),nB)*(.95+.08*nD);
  if(id==5u) return mix(vec3(.76,.67,.47),vec3(.86,.78,.57),nB)*(.9+.15*nD);
  if(id==6u) return mix(vec3(.62,.53,.26),vec3(.74,.64,.32),nB)*(.75+.45*nC);
  if(id==7u){ vec2 g=abs(fract(vW.xy/55.+vec2(nC*.08))-.5); float l=smoothstep(.47,.5,max(g.x,g.y)); return mix(vec3(.50,.49,.45),vec3(.60,.58,.53),nB)*(.85+.25*nD)*(1.-.35*l); }
  if(id==8u) return mix(vec3(.42,.29,.14),vec3(.58,.38,.16),nC)*(.75+.4*nD);
  if(id==9u) return mix(grass(vec3(.30,.40,.14),vec3(.40,.50,.18)),vec3(.45,.36,.23)*(.85+.3*nD),smoothstep(.4,.65,nB));
  if(id==10u) return mix(vec3(.33,.31,.26),vec3(.45,.42,.35),nD)*(.85+.2*nC);
  if(id==11u){ float c=smoothstep(.035,.0,abs(nC-.5)); return mix(vec3(.55,.45,.31),vec3(.63,.53,.38),nB)*(1.-.45*c)*(.9+.15*nD); }
  if(id==12u) return mix(vec3(.85,.88,.92),vec3(.45,.38,.30),smoothstep(.45,.7,nB));
  if(id==13u) return mix(grass(vec3(.30,.42,.13),vec3(.45,.56,.19)),vec3(.48,.38,.25)*(.85+.3*nD),smoothstep(.55,.72,nA*.6+nB*.4));
  if(id==14u) return grass(vec3(.24,.35,.12),vec3(.36,.46,.16));
  if(id==15u) return grass(vec3(.34,.50,.12),vec3(.50,.64,.18));
  if(id==16u) return mix(vec3(.33,.32,.31),vec3(.45,.44,.42),nR)*(.82+.3*nD);
  if(id==17u) return mix(vec3(.66,.56,.28)*(.75+.45*nC),vec3(.50,.40,.26),smoothstep(.55,.72,nA*.6+nB*.4));
  return vec3(.5);
}
vec3 corner(ivec2 c){
  c=clamp(c,ivec2(0),uSize-1);
  uvec4 m=texelFetch(uMat,c,0);
  vec3 a=mat(m.r), b=mat(m.g);
  vec3 col=mix(a,b,float(m.b)/255.);
  vec3 cm=texelFetch(uCol,c,0).rgb;
  return col*clamp(cm/.70,0.,1.45);
}
float am(ivec2 c){ return float(texelFetch(uMat,clamp(c,ivec2(0),uSize-1),0).b)/255.; }
float am2(ivec2 c){ return float(texelFetch(uMat2,clamp(c,ivec2(0),uSize-1),0).g)/255.; }
void main(){
  vec3 n=normalize(vN); slope=1.-n.z;
  vec2 p=vW.xy; TW=pow(abs(n),vec3(4.)); TW/=TW.x+TW.y+TW.z;
  nA=fbm(p/2600.); nB=tz(520.,3.1)*.6+tz(260.,1.7)*.4; nC=tz(90.,0.); nD=tz(23.,.3)*.6+tz(7.,.6)*.4;
  float strata=nz(vec2((p.x+p.y)/700.,vW.z/45.))*.6+tz(140.,2.2)*.4; nR=mix(nB,strata,smoothstep(.15,.5,slope))*.7+nD*.3;
  vec2 t=p/${TILE}.; ivec2 i=ivec2(floor(t)); vec2 f=fract(t);
  vec3 c;
  if(uReal==1){
    // Savage's own textures: one texture per terrain tile, north at the top, a second layer blended by the alpha map
    // Savage stores the texture choice per vertex: blend the four corners' textures across the tile (like the game's per-vertex passes)
    // Savage draws one texture per tile (maps are painted with hand-made edge/corner tiles), mirrored in u,
    // plus a second layer whose alpha is interpolated smoothly between the tile's corners
    ivec2 ic=clamp(i,ivec2(0),uSize-2); uvec4 m=texelFetch(uMat,ic,0);
    vec2 uv=vec2(1.-f.x,1.-f.y);
    vec3 c1=texture(uTex,vec3(uv,float(m.r))).rgb;
    float a=mix(mix(am(ic),am(ic+ivec2(1,0)),f.x),mix(am(ic+ivec2(0,1)),am(ic+ivec2(1,1)),f.x),f.y);
    vec3 base=a>0.?mix(c1,texture(uTex,vec3(uv,float(m.g))).rgb,a):c1;
    // third layer (newer maps): its own texture per tile and its own alpha map, drawn over the first two
    float a2=mix(mix(am2(ic),am2(ic+ivec2(1,0)),f.x),mix(am2(ic+ivec2(0,1)),am2(ic+ivec2(1,1)),f.x),f.y);
    if(a2>0.) base=mix(base,texture(uTex,vec3(uv,float(texelFetch(uMat2,ic,0).r))).rgb,a2);
    vec3 cm=texture(uCol,(t+.5)/vec2(uSize)).rgb;
    c=base*clamp(cm/.70,0.,1.5);
  } else {
    f=clamp(f+(vec2(nz(p/60.),nz(p/60.+.5))-.5)*.55,0.,1.);
    c=mix(mix(corner(i),corner(i+ivec2(1,0)),f.x),mix(corner(i+ivec2(0,1)),corner(i+ivec2(1,1)),f.x),f.y);
    vec3 rock=mix(vec3(.40,.37,.33),vec3(.52,.48,.42),nR)*(.8+.3*nD);
    c=mix(c,rock*mix(vec3(1.),c/max(max(c.r,c.g),.01)*.5+.5,.35),smoothstep(.30,.50,slope)*.9);
  }
  float d=max(dot(n,uSunDir),0.)*vS;
  vec3 light=uL1*(.36+.12*n.z)+uL0*d*.80+vec3(.06);
  vec3 col=c*light;
  o=vec4(tone(applyFog(col,vW)),1.);
}`;
  const OBJT_VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUV; in vec3 aCol; in vec4 iPos; in vec4 iTint; in vec2 iRot;
uniform mat4 uVP; out vec3 vW; out vec3 vN; out vec2 vUV; out vec3 vC;
vec3 tilt(vec3 v){ float cy=cos(iRot.y),sy=sin(iRot.y),cx=cos(iRot.x),sx=sin(iRot.x);
  v=vec3(cy*v.x+sy*v.z, v.y, -sy*v.x+cy*v.z);      // about local y (field 8)
  return vec3(v.x, cx*v.y-sx*v.z, sx*v.y+cx*v.z); } // about local x (field 7)
void main(){ float s=sin(iPos.w),c=cos(iPos.w); float sc=iTint.w;
  vec3 p=tilt(aPos*sc); p.xy=mat2(c,s,-s,c)*p.xy; vec3 nn=tilt(aNrm); nn.xy=mat2(c,s,-s,c)*nn.xy;
  vW=p+iPos.xyz; vN=nn; vUV=aUV; vC=aCol*iTint.rgb; gl_Position=uVP*vec4(vW,1.); }`;
  const OBJT_FS = `#version 300 es
precision highp float; in vec3 vW; in vec3 vN; in vec2 vUV; in vec3 vC; out vec4 o;
uniform vec3 uL0,uAmb; uniform sampler2D uTex; uniform int uAT; uniform int uFol;
${COMMON}
void main(){ vec4 t=texture(uTex,vUV); if(uAT==1&&t.a<.5) discard;
  vec3 n=normalize(vN+vec3(0,0,1e-4)); if(!gl_FrontFacing) n=-n;
  float d=dot(n,uSunDir); float w=uFol==2?max(uSunDir.z,0.):uFol==1?max(d*.45+.55,0.):max(d*.75+.25,0.); if(uFol==2) n=vec3(0,0,1);
  vec3 light=uAmb*(.42+.12*n.z)+uL0*w*.72+vec3(.05);
  o=vec4(tone(applyFog(t.rgb*vC*light*1.25,vW)),1.); }`;
  const SKY_VS = `#version 300 es
out vec2 vP; void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2)*2.-1.; vP=p; gl_Position=vec4(p,.9999,1.); }`;
  const SKY_FS = `#version 300 es
precision highp float; in vec2 vP; out vec4 o;
uniform mat4 uInvVP; uniform vec3 uZen,uHor,uSunC,uCloud; uniform float uCover; uniform sampler2D uNoise;
${COMMON}
float nz(vec2 p){ return texture(uNoise,p).r; }
void main(){ vec4 a=uInvVP*vec4(vP,1.,1.); vec3 dir=normalize(a.xyz/a.w-uEye);
  float e=dir.z; float t=pow(clamp(e,0.,1.),.45);
  vec3 col=mix(uHor,uZen,t);
  float sd=max(dot(dir,uSunDir),0.);
  col+=uSunC*(pow(sd,8.)*.18+pow(sd,90.)*.5)+uSunC*smoothstep(.9994,.9997,sd)*2.;
  if(e>0.){ vec2 uv=dir.xy/(e+.25)*.16+vec2(.31,.17);
    float hf=smoothstep(.02,.3,e); float c=nz(uv*.6)*.55+nz(uv*1.3+.3)*.3+mix(.075,nz(uv*2.9+.7)*.15,hf);
    c=smoothstep(1.-uCover,1.-uCover+.32,c)*smoothstep(0.,.25,e);
    vec3 cc=uCloud*(.85+.3*nz(uv*1.7+.9))+uSunC*.25*pow(sd,4.);
    col=mix(col,cc,c*.85); }
  col=mix(col,uFog,smoothstep(.12,-.02,e));
  o=vec4(tone(col),1.); }`;

  function compile(gl, vs, fs) {
    const p = gl.createProgram();
    for (const [t, s] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ]) {
      const sh = gl.createShader(t);
      gl.shaderSource(sh, s);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const nm = gl.getActiveUniform(p, i).name;
      u[nm] = gl.getUniformLocation(p, nm);
    }
    return { p, u };
  }

  /* ---------- procedural object meshes ---------- */

  /* ---------- renderer ---------- */
  class SavageRenderer {
    constructor(canvas) {
      this.cv = canvas;
      const gl = (this.gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true }));
      if (!gl) throw new Error('WebGL2 is not available in this browser.');
      this.pTer = compile(gl, TER_VS, TER_FS);
      this.pSky = compile(gl, SKY_VS, SKY_FS);
      this.pObjT = compile(gl, OBJT_VS, OBJT_FS);
      this.models = {};
      this.mtex = {};
      this.real3d = [];
      this.noise = this.makeNoise();
      this.yaw = 0;
      this.pitch = 0;
      this.fov = (68 * Math.PI) / 180;
      this.eye = [0, 0, 0];
    }
    makeNoise() {
      const gl = this.gl,
        N = 256,
        R = rng(77),
        g = new Float32Array(N * N),
        d = new Uint8Array(N * N);
      // tileable value noise, smoothed
      const base = new Float32Array(64 * 64).map(() => R());
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const fx = (x / N) * 64,
            fy = (y / N) * 64,
            ix = Math.floor(fx),
            iy = Math.floor(fy),
            tx = fx - ix,
            ty = fy - iy;
          const s = t => t * t * (3 - 2 * t);
          const v = (a, b) => base[(b & 63) * 64 + (a & 63)];
          const a = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * s(tx),
            b = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * s(tx);
          g[y * N + x] = a + (b - a) * s(ty);
        }
      for (let i = 0; i < N * N; i++) d[i] = Math.round(g[i] * 255);
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, d);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      return t;
    }

    async loadMap(d, texBase = 'tex/') {
      const gl = this.gl;
      const texReady = this.loadTextures(d, texBase);
      this.map = d;
      const W = d.W,
        H = d.H;
      this.W = W;
      this.H = H;
      const q = new Uint16Array(b64(d.hm).buffer);
      const hm = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) hm[i] = d.hmin + (q[i] / 65535) * (d.hmax - d.hmin);
      this.hm = hm;
      const m1 = b64(d.m1),
        m2 = b64(d.m2),
        am = b64(d.am),
        cm = b64(d.cm);
      this.m1 = m1;
      this.m2 = m2;
      this.amArr = am;
      this.cmArr = cm;
      const wb = b64(d.walk);
      this.walk = (x, y) => {
        const i = y * (W - 1) + x;
        return (wb[i >> 3] >> (7 - (i & 7))) & 1;
      };
      const e = d.env;
      this.env = e;
      {
        let sx = -e.sun[0],
          sy = -e.sun[1];
        const hl = Math.hypot(sx, sy) || 1;
        sx /= hl;
        sy /= hl;
        const el = (38 * Math.PI) / 180;
        this.sunDir = [sx * Math.cos(el), sy * Math.cos(el), Math.sin(el)];
      }
      // terrain self-shadow by marching the heightmap toward the sun
      const shd = new Float32Array(W * H);
      const sd = this.sunDir,
        hl = Math.hypot(sd[0], sd[1]) || 1e-3,
        rise = (sd[2] / hl) * TILE;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const h0 = hm[y * W + x];
          let lit = 1;
          for (let s = 1; s < 60; s++) {
            const fx = x + (sd[0] / hl) * s * 0.7,
              fy = y + (sd[1] / hl) * s * 0.7;
            if (fx < 0 || fy < 0 || fx > W - 1 || fy > H - 1) break;
            const h = this.hAt(fx * TILE, fy * TILE);
            const need = h0 + rise * s * 0.7;
            if (h > need) {
              lit = Math.max(0, lit - Math.min(1, (h - need) / 60));
              if (lit <= 0) break;
            }
          }
          shd[y * W + x] = lit;
        }
      // mesh with an outer skirt so the world never ends in a void
      const GW = W + EXT * 2,
        GH = H + EXT * 2,
        pos = new Float32Array(GW * GH * 3),
        nrm = new Float32Array(GW * GH * 3),
        sh = new Float32Array(GW * GH);
      const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
      const H0 = (x, y) => hm[cl(y, 0, H - 1) * W + cl(x, 0, W - 1)];
      for (let j = 0; j < GH; j++)
        for (let i = 0; i < GW; i++) {
          const x = i - EXT,
            y = j - EXT,
            k = j * GW + i;
          const out = Math.max(0, -x, -y, x - (W - 1), y - (H - 1));
          const ox = out > 0 ? (x < 0 ? x * 1.0 : x > W - 1 ? W - 1 + (x - (W - 1)) * 1.0 : x) : x,
            oy = out > 0 ? (y < 0 ? y : y > H - 1 ? y : y) : y;
          pos[k * 3] = ox * TILE;
          pos[k * 3 + 1] = oy * TILE;
          pos[k * 3 + 2] = H0(x, y) + Math.min(out * out * 6, 420) * (0.6 + 0.4 * Math.sin(x * 0.7 + y * 0.45));
          const dx = (H0(x + 1, y) - H0(x - 1, y)) / (2 * TILE),
            dy = (H0(x, y + 1) - H0(x, y - 1)) / (2 * TILE);
          const l = Math.hypot(dx, dy, 1);
          nrm[k * 3] = -dx / l;
          nrm[k * 3 + 1] = -dy / l;
          nrm[k * 3 + 2] = 1 / l;
          sh[k] = shd[cl(y, 0, H - 1) * W + cl(x, 0, W - 1)];
        }
      const idx = new Uint32Array((GW - 1) * (GH - 1) * 6);
      let n = 0;
      for (let j = 0; j < GH - 1; j++)
        for (let i = 0; i < GW - 1; i++) {
          const a = j * GW + i,
            b = a + 1,
            c = a + GW,
            dd = c + 1;
          idx[n++] = a;
          idx[n++] = b;
          idx[n++] = dd;
          idx[n++] = a;
          idx[n++] = dd;
          idx[n++] = c;
        }
      if (this.ter) {
        gl.deleteVertexArray(this.ter.vao);
      }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const P = this.pTer.p;
      const buf = (arr, name, size) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
        const l = gl.getAttribLocation(P, name);
        gl.enableVertexAttribArray(l);
        gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0);
      };
      buf(pos, 'aPos', 3);
      buf(nrm, 'aNrm', 3);
      buf(sh, 'aShd', 1);
      const eb = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.ter = { vao, count: n };
      // material + colour textures
      const real = !!(d.tex && d.s1);
      const s1 = real ? b64(d.s1) : m1,
        s2 = real ? b64(d.s2) : m2;
      this.s1a = s1;
      this.s2a = s2;
      const mat = new Uint8Array(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        mat[i * 4] = s1[i];
        mat[i * 4 + 1] = s2[i];
        mat[i * 4 + 2] = am[i];
      }
      const mk = (fmt, ifmt, type, data, filter) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, W, H, 0, fmt, type, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        return t;
      };
      this.texMat = mk(gl.RGBA_INTEGER, gl.RGBA8UI, gl.UNSIGNED_BYTE, mat, gl.NEAREST);
      {
        const s3 = real && d.s3 ? b64(d.s3) : null,
          a2 = real && d.am2 ? b64(d.am2) : null;
        const m2b = new Uint8Array(W * H * 4);
        if (s3 && a2)
          for (let i = 0; i < W * H; i++) {
            m2b[i * 4] = s3[i];
            m2b[i * 4 + 1] = a2[i];
          }
        if (this.texMat2) gl.deleteTexture(this.texMat2);
        this.texMat2 = mk(gl.RGBA_INTEGER, gl.RGBA8UI, gl.UNSIGNED_BYTE, m2b, gl.NEAREST);
      }
      this.texCol = mk(gl.RGB, gl.RGB8, gl.UNSIGNED_BYTE, cm, gl.LINEAR);
      this.real = false;
      {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, H, 0, gl.RED, gl.FLOAT, hm);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        this.texHm = t;
      }
      // Savage marks rivers and ponds with waterfall/river props; remember them so no spawn lands in a river bed
      this.solid = [];
      this.waters = [];
      for (const o of d.objs || []) if (o[0] === 'water') this.waters.push([o[1], o[2], o[3], 550]);
      const realReady = this.loadReal(d, texBase.replace(/tex\/$/, ''));
      const fk = (d.env.fol && d.env.fol.k) || 'foliage_grass';
      this.folKey = fk;
      const folReady =
        fk === 'none' || (this.folTexs && this.folTexs[fk])
          ? Promise.resolve()
          : new Promise(res => {
              const im = new Image();
              im.onload = () => {
                const t = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, t);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                (this.folTexs = this.folTexs || {})[fk] = t;
                res();
              };
              im.onerror = () => res();
              im.src = texBase.replace(/tex\/$/, '') + 'foliage/' + fk + '.png';
            });
      try {
        this.real = (await texReady) && real;
      } catch (e) {
        this.real = false;
      }
      try {
        await folReady;
      } catch (e) {}
      try {
        await realReady;
      } catch (e) {
        console.warn('real models', e);
        this.real3d = [];
      }
    }
    async loadTextures(d, base) {
      // the map's terrain textures as one texture array (256px layers)
      if (!d.tex || !d.tex.length) return false;
      const N = 256,
        n = d.tex.length,
        cv = document.createElement('canvas');
      cv.width = cv.height = N;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      const imgs = await Promise.all(
        d.tex.map(
          k =>
            new Promise(res => {
              if (!k) {
                res(null);
                return;
              }
              const im = new Image();
              im.onload = () => res(im);
              im.onerror = () => res(null);
              im.src = base + k + '.jpg';
            })
        )
      );
      const gl = this.gl;
      if (this.texArr) gl.deleteTexture(this.texArr);
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 9, gl.RGBA8, N, N, n);
      this.texAvg = [];
      for (let i = 0; i < n; i++) {
        if (imgs[i]) cx.drawImage(imgs[i], 0, 0, N, N);
        else {
          cx.fillStyle = '#fff';
          cx.fillRect(0, 0, N, N);
        }
        const px = cx.getImageData(0, 0, N, N);
        let r = 0,
          g = 0,
          b = 0;
        for (let j = 0; j < px.data.length; j += 64) {
          r += px.data[j];
          g += px.data[j + 1];
          b += px.data[j + 2];
        }
        const c = px.data.length / 64;
        this.texAvg.push([r / c / 255, g / c / 255, b / c / 255]);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, N, N, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const af = gl.getExtension('EXT_texture_filter_anisotropic');
      if (af)
        gl.texParameterf(
          gl.TEXTURE_2D_ARRAY,
          af.TEXTURE_MAX_ANISOTROPY_EXT,
          Math.min(8, gl.getParameter(af.MAX_TEXTURE_MAX_ANISOTROPY_EXT))
        );
      this.texArr = t;
      return imgs.some(Boolean);
    }
    async loadReal(d, base) {
      // Savage's own prop models, instanced per map
      this.real3d = [];
      this.boxes = [];
      if (!d.rn || !d.rn.length) return;
      const gl = this.gl;
      if (!this.mIndex) {
        try {
          this.mIndex = await (await fetch(base + 'mpack/models.json')).json();
        } catch (e) {
          this.mIndex = { models: {}, tex: {}, gc: {}, tc: {} };
        }
        this.mIndex.g = {};
        this.gChunks = {};
        this.tChunks = {};
      }
      // geometry and textures live in chunk files; fetch only the chunks this map's props need
      const chunk = (store, pre, c) =>
        store[c] ||
        (store[c] = fetch(base + 'mpack/' + pre + c + '.json')
          .then(r => r.json())
          .catch(() => ({})));
      const needG = new Set();
      for (const nm of d.rn) if (this.mIndex.gc[nm] !== undefined) needG.add(this.mIndex.gc[nm]);
      for (const g of await Promise.all([...needG].map(c => chunk(this.gChunks, 'g', c))))
        Object.assign(this.mIndex.g, g);
      const needT = new Set();
      for (const nm of d.rn)
        for (const g of this.mIndex.g[nm] || [])
          if (g.t && this.mIndex.tc[g.t] !== undefined) needT.add(this.mIndex.tc[g.t]);
      const texP = Promise.all([...needT].map(c => chunk(this.tChunks, 't', c))).then(a => Object.assign({}, ...a));
      const inst = {};
      const ro = d.ro;
      const RS = d.ros || 6;
      for (let i = 0; i < ro.length; i += RS) {
        const nm = d.rn[ro[i]];
        const b = this.mIndex.models[nm];
        if (!b) continue;
        const s = (ro[i + 5] || 1) * MODEL_SCALE;
        const j = 0.92 + (((ro[i + 1] * 7 + ro[i + 2] * 13) % 17) / 17) * 0.16;
        (inst[nm] = inst[nm] || []).push(
          ro[i + 1],
          ro[i + 2],
          ro[i + 3],
          ((ro[i + 4] + 180) * Math.PI) / 180,
          j,
          j,
          j,
          s,
          (-(RS > 6 ? ro[i + 6] : 0) * Math.PI) / 180,
          (-(RS > 6 ? ro[i + 7] : 0) * Math.PI) / 180
        );
        const r = Math.max(Math.abs(b[0]), Math.abs(b[1]), Math.abs(b[3]), Math.abs(b[4]));
        const fol = /tree|bush|palm|pine|foliage/.test(nm);
        const rr = (fol ? Math.min(r * 0.35, 170) : Math.min(r * 0.8, 400)) * s;
        if (b[5] * s > 25) this.solid.push([ro[i + 1], ro[i + 2], Math.max(rr, 40)]);
        if (b[5] * s > 30) {
          const w = ((ro[i + 4] + 180) * Math.PI) / 180;
          this.boxes.push([
            ro[i + 1],
            ro[i + 2],
            ro[i + 3],
            Math.cos(w),
            Math.sin(w),
            b[0] * s,
            b[1] * s,
            b[2] * s,
            b[3] * s,
            b[4] * s,
            b[5] * s,
            fol ? 1 : 0,
          ]);
        }
      }
      const B64 = (s, T) => {
        const bin = atob(s),
          u = new Uint8Array(bin.length);
        for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
        return new T(u.buffer);
      };
      const P = this.pObjT.p;
      const loadModel = async nm => {
        if (this.models[nm]) return this.models[nm];
        const j = { g: this.mIndex.g[nm] };
        if (!j.g) throw new Error('no model ' + nm);
        const groups = [];
        for (const g of j.g) {
          const vao = gl.createVertexArray();
          gl.bindVertexArray(vao);
          const ab = (data, name, size, type, norm) => {
            const b = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, b);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            const l = gl.getAttribLocation(P, name);
            if (l < 0) return;
            gl.enableVertexAttribArray(l);
            gl.vertexAttribPointer(l, size, type, norm, 0, 0);
          };
          ab(B64(g.p, Float32Array), 'aPos', 3, gl.FLOAT, false);
          ab(B64(g.n, Int8Array), 'aNrm', 3, gl.BYTE, true);
          ab(B64(g.u, Float32Array), 'aUV', 2, gl.FLOAT, false);
          const lc = gl.getAttribLocation(P, 'aCol');
          if (g.c) ab(B64(g.c, Uint8Array), 'aCol', 3, gl.UNSIGNED_BYTE, true);
          else {
            gl.disableVertexAttribArray(lc);
            gl.vertexAttrib3f(lc, 1, 1, 1);
          }
          const ib = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, ib);
          const lp = gl.getAttribLocation(P, 'iPos'),
            lt = gl.getAttribLocation(P, 'iTint'),
            lr = gl.getAttribLocation(P, 'iRot');
          gl.enableVertexAttribArray(lp);
          gl.vertexAttribPointer(lp, 4, gl.FLOAT, false, 40, 0);
          gl.vertexAttribDivisor(lp, 1);
          gl.enableVertexAttribArray(lt);
          gl.vertexAttribPointer(lt, 4, gl.FLOAT, false, 40, 16);
          gl.vertexAttribDivisor(lt, 1);
          gl.enableVertexAttribArray(lr);
          gl.vertexAttribPointer(lr, 2, gl.FLOAT, false, 40, 32);
          gl.vertexAttribDivisor(lr, 1);
          const idx = g.w === 4 ? B64(g.i, Uint32Array) : B64(g.i, Uint16Array);
          const eb = gl.createBuffer();
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
          gl.bindVertexArray(null);
          groups.push({
            vao,
            ib,
            count: idx.length,
            type: g.w === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
            t: g.t,
            a: g.a,
            d: g.d,
          });
        }
        return (this.models[nm] = { groups });
      };
      const texData = await texP;
      const loadTex = key => {
        if (this.mtex[key]) return this.mtex[key];
        const info = this.mIndex.tex[key];
        if (!info || !texData[key]) return null;
        return (this.mtex[key] = new Promise(res => {
          const im = new Image();
          im.onload = () => {
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            res(t);
          };
          im.onerror = () => res(null);
          im.src = texData[key];
        }));
      };
      if (!this.white) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([200, 200, 200, 255])
        );
        this.white = t;
      }
      const list = await Promise.all(
        Object.keys(inst).map(async nm => {
          try {
            const m = await loadModel(nm);
            for (const g of m.groups) g.tex = g.t ? await loadTex(g.t) : null;
            return [nm, m];
          } catch (e) {
            return null;
          }
        })
      );
      for (const it of list) {
        if (!it) continue;
        const [nm, m] = it;
        const arr = new Float32Array(inst[nm]);
        for (const g of m.groups) {
          gl.bindBuffer(gl.ARRAY_BUFFER, g.ib);
          gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
        }
        this.real3d.push({ m, n: arr.length / 10 });
      }
    }
    hAt(x, y) {
      const W = this.W,
        H = this.H,
        fx = Math.min(Math.max(x / TILE, 0), W - 1.001),
        fy = Math.min(Math.max(y / TILE, 0), H - 1.001),
        ix = fx | 0,
        iy = fy | 0,
        tx = fx - ix,
        ty = fy - iy,
        h = this.hm;
      const a = h[iy * W + ix],
        b = h[iy * W + ix + 1],
        c = h[(iy + 1) * W + ix],
        d = h[(iy + 1) * W + ix + 1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
    /* pick a random standing spot on reachable, walkable ground that isn't inside a tree or building */
    horizon(x, y, yaw, eye) {
      // highest elevation angle of terrain along a direction (radians)
      let best = -1;
      const dx = Math.sin(yaw),
        dy = Math.cos(yaw);
      for (let d = 60; d < 2400; d *= 1.18) {
        const h = this.hAt(x + dx * d, y + dy * d);
        const a = Math.atan2(h - eye, d);
        if (a > best) best = a;
      }
      return best;
    }
    /* is a world point inside any prop's (rotated) bounding box, grown by m? */
    inBox(px, py, pz, list, m = 0) {
      for (const o of list) {
        const dx = px - o[0],
          dy = py - o[1],
          dz = pz - o[2];
        const lx = o[3] * dx + o[4] * dy,
          ly = -o[4] * dx + o[3] * dy;
        if (lx > o[5] - m && lx < o[8] + m && ly > o[6] - m && ly < o[9] + m && dz > o[7] - m && dz < o[10] + m)
          return true;
      }
      return false;
    }
    /* how far you can see from (x,y,eye) along yaw before running into a prop; capped at 700 */
    clearDist(x, y, eye, yaw, list) {
      const dx = Math.sin(yaw),
        dy = Math.cos(yaw);
      for (let d = 25; d < 700; d += 25) {
        if (this.hAt(x + dx * d, y + dy * d) > eye - 8) return d;
        if (this.inBox(x + dx * d, y + dy * d, eye, list)) return d;
      }
      return 700;
    }
    viewClear(x, y, eye, yaw, list) {
      let ok = 0,
        c = 0;
      for (let k = -3; k <= 3; k++) {
        const d = this.clearDist(x, y, eye, yaw + k * 0.17, list);
        if (d >= 350) ok++;
        if (Math.abs(k) <= 1 && d >= 450) c++;
      }
      return (ok / 7) * 0.6 + (c / 3) * 0.4;
    }
    randomSpot(seed) {
      const R = rng(seed),
        W = this.W,
        H = this.H;
      const cells = [];
      for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) if (this.walk(x, y)) cells.push([x, y]);
      const C = [];
      for (let tries = 0, cand = 0; tries < 900 && cand < 12; tries++) {
        const c = cells[Math.floor(R() * cells.length)];
        const x = (c[0] + R()) * TILE,
          y = (c[1] + R()) * TILE;
        if (this.solid.some(s => Math.hypot(s[0] - x, s[1] - y) < Math.max(s[2], 110))) continue;
        if (this.solid.filter(s => Math.hypot(s[0] - x, s[1] - y) < 320).length > 3) continue;
        cand++;
        const eye = this.hAt(x, y) + 52;
        let sc = 0,
          by = 0,
          bs = -1e9,
          bc = 1;
        const nb = (this.boxes || []).filter(o => Math.hypot(o[0] - x, o[1] - y) < 1300);
        if (this.inBox(x, y, eye, nb, 40) || this.inBox(x, y, eye - 40, nb, 25)) continue;
        if ((this.waters || []).some(w => Math.hypot(w[0] - x, w[1] - y) < w[3] && this.hAt(x, y) < w[2] + 80))
          continue; // in a river bed or pond (Savage marks them with waterfall/river props) // standing inside a building, tree canopy or rock
        const near = this.solid.filter(s => {
          const d = Math.hypot(s[0] - x, s[1] - y);
          return d < 1600;
        });
        for (let k = 0; k < 16; k++) {
          const yaw = (k / 16) * Math.PI * 2;
          const hz = this.horizon(x, y, yaw, eye);
          const open = hz < 0.18 ? 1 : hz < 0.35 ? 0.4 : 0;
          let objs = 0;
          for (const s of near) {
            let a = Math.atan2(s[0] - x, s[1] - y) - yaw;
            a = Math.atan2(Math.sin(a), Math.cos(a));
            if (Math.abs(a) < 0.6) objs++;
          }
          const clr = this.viewClear(x, y, eye, yaw, nb);
          const v = open * 2 + Math.min(objs, 8) * 0.25 + clr * 3 - (clr < 0.5 ? 6 : 0);
          sc += open;
          if (v > bs) {
            bs = v;
            by = yaw;
            bc = clr;
          }
        }
        let block = 0;
        for (const s of near) {
          const d = Math.hypot(s[0] - x, s[1] - y);
          if (d > s[2] + 260) continue;
          let a = Math.atan2(s[0] - x, s[1] - y) - by;
          a = Math.atan2(Math.sin(a), Math.cos(a));
          if (Math.abs(a) < 0.7) block++;
        }
        const total =
          (sc / 16) * 4 + Math.min(near.length, 12) * 0.12 + bs * 0.5 + R() * 0.4 - block * 3 - (bc < 0.7 ? 8 : 0);
        C.push({ x, y, yaw: by + (R() - 0.5) * 0.2, s: total });
      }
      if (C.length) {
        C.sort((a, b) => b.s - a.s);
        return C[Math.floor(R() * Math.min(4, C.length))];
      }
      const c = cells[0] || [W / 2, H / 2];
      return { x: (c[0] + 0.5) * TILE, y: (c[1] + 0.5) * TILE, yaw: 0 };
    }
    setView(x, y, yaw, pitch = 0) {
      this.eye = [x, y, this.hAt(x, y) + 52];
      this.yaw = yaw;
      this.pitch = pitch;
      this.grass(x, y);
    }
    makeGrassTex() {
      // a clump of thin, tapering grass blades with alpha, like Savage's foliage_grass card
      const gl = this.gl,
        W = 256,
        H = 128,
        cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const g = cv.getContext('2d');
      const R = rng(99);
      for (let i = 0; i < 120; i++) {
        const x = 8 + R() * (W - 16),
          h = H * (0.35 + R() * 0.62),
          lean = (R() - 0.5) * h * 0.55,
          w = 1.2 + R() * 2.2,
          l = 150 + R() * 105;
        const grd = g.createLinearGradient(0, H, 0, H - h);
        grd.addColorStop(0, `rgb(${(l * 0.45) | 0},${(l * 0.5) | 0},${(l * 0.42) | 0})`);
        grd.addColorStop(1, `rgb(${l | 0},${l | 0},${(l * 0.9) | 0})`);
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(x - w, H);
        g.quadraticCurveTo(x - w * 0.5 + lean * 0.3, H - h * 0.55, x + lean, H - h);
        g.quadraticCurveTo(x + w * 0.5 + lean * 0.3, H - h * 0.55, x + w, H);
        g.closePath();
        g.fill();
      }
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    buildGrassMesh(w, h) {
      // three crossed cards, w wide and h high, normals up so they light like the ground
      const gl = this.gl,
        P = this.pObjT.p,
        pos = [],
        uv = [],
        nrm = [],
        idx = [];
      for (let q = 0; q < 3; q++) {
        const a = (q * Math.PI) / 3,
          dx = (Math.cos(a) * w) / 2,
          dy = (Math.sin(a) * w) / 2,
          b = pos.length / 3;
        pos.push(-dx, -dy, -1, dx, dy, -1, dx, dy, h, -dx, -dy, h);
        uv.push(0, 1, 1, 1, 1, 0, 0, 0);
        for (let k = 0; k < 4; k++) nrm.push(0, 0, 127);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      if (this.gMesh) gl.deleteVertexArray(this.gMesh.vao);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const ab = (data, name, size, type, norm) => {
        const bb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bb);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const l = gl.getAttribLocation(P, name);
        gl.enableVertexAttribArray(l);
        gl.vertexAttribPointer(l, size, type, norm, 0, 0);
      };
      ab(new Float32Array(pos), 'aPos', 3, gl.FLOAT, false);
      ab(new Int8Array(nrm), 'aNrm', 3, gl.BYTE, true);
      ab(new Float32Array(uv), 'aUV', 2, gl.FLOAT, false);
      const lc = gl.getAttribLocation(P, 'aCol');
      gl.disableVertexAttribArray(lc);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, ib);
      const lp = gl.getAttribLocation(P, 'iPos'),
        lt = gl.getAttribLocation(P, 'iTint');
      gl.enableVertexAttribArray(lp);
      gl.vertexAttribPointer(lp, 4, gl.FLOAT, false, 32, 0);
      gl.vertexAttribDivisor(lp, 1);
      gl.enableVertexAttribArray(lt);
      gl.vertexAttribPointer(lt, 4, gl.FLOAT, false, 32, 16);
      gl.vertexAttribDivisor(lt, 1);
      const lr = gl.getAttribLocation(P, 'iRot');
      gl.disableVertexAttribArray(lr);
      const eb = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.gMesh = { vao, ib, count: idx.length, n: 0 };
    }
    grass(cx, cy) {
      // scatter foliage cards on grassy ground around the viewer, using the map's own foliage size
      const gl = this.gl,
        W = this.W,
        H = this.H,
        R = rng((cx | 0) * 31 + (cy | 0)),
        cm = this.cmArr,
        A = [];
      const f = (this.env && this.env.fol) || { h: 8, w: 12, k: 'grass' };
      if (!this.grassTex) this.grassTex = this.makeGrassTex();
      const fh = Math.max(4, Math.min(f.h || 8, 16)),
        fw = Math.max(6, Math.min(f.w || 12, 18));
      if (!this.gMesh || this.gMesh.key !== fh + '_' + fw) {
        this.buildGrassMesh(fw, fh * 1.6);
        this.gMesh.key = fh + '_' + fw;
      }
      if (f.k === 'none') {
        this.gMesh.n = 0;
        return;
      }
      const BASE = {
        0: [0.37, 0.49, 0.16],
        9: [0.36, 0.46, 0.17],
        13: [0.37, 0.49, 0.16],
        14: [0.3, 0.41, 0.14],
        15: [0.42, 0.57, 0.15],
        6: [0.68, 0.58, 0.29],
        17: [0.68, 0.58, 0.29],
      };
      const DENS = { 0: 1, 9: 0.55, 13: 0.6, 14: 1, 15: 1, 6: 1, 17: 0.55 };
      const realTex = !!(this.folTexs && this.folTexs[this.folKey]);
      this.curFolTex = realTex ? this.folTexs[this.folKey] : this.grassTex;
      for (let i = 0; i < 26000; i++) {
        const r = 20 + Math.pow(R(), 0.75) * 650,
          a = R() * 6.283,
          x = cx + Math.cos(a) * r,
          y = cy + Math.sin(a) * r;
        const ix = Math.round(x / TILE),
          iy = Math.round(y / TILE);
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
        const k = iy * W + ix;
        const al = this.amArr[k] / 255;
        const two = R() < al;
        const id = two ? this.m2[k] : this.m1[k];
        const dn = DENS[id];
        if (!dn || R() > dn) continue;
        const z = this.hAt(x, y);
        const nx = (this.hAt(x + 30, y) - this.hAt(x - 30, y)) / 60,
          ny = (this.hAt(x, y + 30) - this.hAt(x, y - 30)) / 60;
        if (Math.hypot(nx, ny) > 0.6) continue;
        const li = this.real && this.texAvg ? (two ? this.s2a[k] : this.s1a[k]) : -1;
        const gt = li >= 0 && this.texAvg && this.texAvg[li];
        const gl0 = gt ? gt[0] * 0.3 + gt[1] * 0.55 + gt[2] * 0.15 : 0.4;
        const b = realTex
          ? gt
            ? gt.map(v => 0.55 + 0.45 * (v / Math.max(gl0, 0.05)) * 0.6).map(v => v * 0.62)
            : [0.62, 0.62, 0.62]
          : li >= 0 && this.texAvg[li]
            ? this.texAvg[li].map(v => v * 1.25)
            : BASE[id];
        const c = [cm[k * 3] / 255 / 0.7, cm[k * 3 + 1] / 255 / 0.7, cm[k * 3 + 2] / 255 / 0.7].map(v =>
            Math.min(1.45, v)
          ),
          j = 0.85 + R() * 0.3;
        A.push(x, y, z, R() * 6.283, b[0] * c[0] * j, b[1] * c[1] * j, b[2] * c[2] * j, 0.7 + R() * 0.6);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gMesh.ib);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(A), gl.DYNAMIC_DRAW);
      this.gMesh.n = A.length / 8;
    }
    render() {
      const gl = this.gl,
        cv = this.cv;
      const w = cv.width,
        h = cv.height;
      gl.viewport(0, 0, w, h);
      const e = this.env;
      const proj = M4.persp(this.fov, w / h, 4, 30000),
        view = M4.view(this.eye, this.yaw, this.pitch),
        vp = M4.mul(proj, view);
      const hue = (v, lo = 0.05) => {
        const m = Math.max(...v);
        if (!(m > lo)) return [1, 1, 1];
        return v.map(c => Math.min(1, Math.max(0, c / m)));
      };
      const lum = v => v[0] * 0.3 + v[1] * 0.55 + v[2] * 0.15;
      let fogC = e.fog.map(v => Math.min(1, Math.max(0, v)));
      {
        const l0 = lum(fogC);
        fogC = fogC.map(v => v * 0.7 + l0 * 0.3);
        const l = lum(fogC);
        if (l < 0.45) fogC = fogC.map(v => v + (0.45 - l));
        fogC = fogC.map(v => Math.min(1, v));
      }
      const sunH = hue(e.tl0),
        fillH = hue(e.tl1).map((v, i) => v * 0.8 + fogC[i] * 0.2),
        oSun = hue(e.ol0),
        oAmb = hue(e.oa);
      const fogR = [e.fogNear * 0.9, Math.max(e.fogFar, e.fogNear + 600) * 1.05];
      gl.clearColor(fogC[0], fogC[1], fogC[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const common = u => {
        gl.uniform3fv(u.uEye, this.eye);
        gl.uniform3fv(u.uFog, fogC);
        gl.uniform2fv(u.uFogR, fogR);
        gl.uniform3fv(u.uSunDir, this.sunDir);
      };
      // sky
      const skin = (e.skin || '').toLowerCase();
      const storm = skin.includes('storm'),
        peach = skin.includes('peach');
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.useProgram(this.pSky.p);
      let u = this.pSky.u;
      common(u);
      gl.uniformMatrix4fv(u.uInvVP, false, M4.inv(vp));
      const bgH = hue(e.bg, 0.2);
      let zen = bgH.map((v, i) => (v * 0.62 + fogC[i] * 0.38) * 0.82);
      if (storm) zen = [0.55, 0.58, 0.64];
      if (peach) zen = zen.map((v, i) => v * [1.05, 0.98, 0.9][i]);
      gl.uniform3fv(u.uZen, zen);
      gl.uniform3fv(
        u.uHor,
        fogC.map(v => v * 1.02)
      );
      gl.uniform3fv(
        u.uSunC,
        hue(e.sunCol).map(v => v * (storm ? 0.25 : 1))
      );
      gl.uniform3fv(u.uCloud, storm ? [0.8, 0.81, 0.84] : peach ? [1.0, 0.92, 0.86] : [1, 1, 1]);
      gl.uniform1f(u.uCover, storm ? 0.55 : skin.includes('blue2') ? 0.42 : 0.36);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.noise);
      gl.uniform1i(u.uNoise, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // terrain
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.useProgram(this.pTer.p);
      u = this.pTer.u;
      common(u);
      gl.uniformMatrix4fv(u.uVP, false, vp);
      gl.uniform3fv(u.uL0, sunH);
      gl.uniform3fv(u.uL1, fillH);
      gl.uniform3fv(u.uAmb, [0, 0, 0]);
      gl.uniform2iv(u.uSize, [this.W, this.H]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texMat);
      gl.uniform1i(u.uMat, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.texCol);
      gl.uniform1i(u.uCol, 1);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.texMat2);
      gl.uniform1i(u.uMat2, 4);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.noise);
      gl.uniform1i(u.uNoise, 2);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArr || null);
      gl.uniform1i(u.uTex, 3);
      gl.uniform1i(u.uReal, this.real ? 1 : 0);
      gl.bindVertexArray(this.ter.vao);
      gl.drawElements(gl.TRIANGLES, this.ter.count, gl.UNSIGNED_INT, 0);
      // objects
      gl.disable(gl.CULL_FACE);
      const showG = this.showGrass !== false && this.gMesh && this.gMesh.n;
      if (this.real3d.length || showG) {
        const P = this.pObjT;
        gl.useProgram(P.p);
        const uu = P.u;
        common(uu);
        gl.uniformMatrix4fv(uu.uVP, false, vp);
        gl.uniform3fv(
          uu.uL0,
          oSun.map((v, i) => v * 0.6 + sunH[i] * 0.4)
        );
        gl.uniform3fv(
          uu.uAmb,
          oAmb.map((v, i) => v * 0.5 + fillH[i] * 0.5)
        );
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(uu.uTex, 0);
        for (const { m, n } of this.real3d)
          for (const g of m.groups) {
            gl.bindTexture(gl.TEXTURE_2D, g.tex || this.white);
            gl.uniform1i(uu.uAT, g.a ? 1 : 0);
            gl.uniform1i(uu.uFol, g.a ? 1 : 0);
            gl.bindVertexArray(g.vao);
            gl.drawElementsInstanced(gl.TRIANGLES, g.count, g.type, 0, n);
          }
        if (showG) {
          const lc = gl.getAttribLocation(P.p, 'aCol');
          gl.bindVertexArray(this.gMesh.vao);
          gl.vertexAttrib3f(lc, 1, 1, 1);
          gl.vertexAttrib2f(gl.getAttribLocation(P.p, 'iRot'), 0, 0);
          gl.bindTexture(gl.TEXTURE_2D, this.curFolTex || this.grassTex);
          gl.uniform1i(uu.uAT, 1);
          gl.uniform1i(uu.uFol, 2);
          gl.drawElementsInstanced(gl.TRIANGLES, this.gMesh.count, gl.UNSIGNED_SHORT, 0, this.gMesh.n);
        }
      }
      gl.bindVertexArray(null);
    }
  }
  window.SavageRenderer = SavageRenderer;
})();
