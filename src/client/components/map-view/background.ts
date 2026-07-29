// Animated cosmic background shader for globe projection mode
// Two-pass rendering:
//   1. Full nebula+particles rendered to offscreen texture (only when idle)
//   2. Cheap blit shader composites cached texture + live globe glow (every frame)

const VERTEX_SRC = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Pass 1: Nebula + particles rendered to texture (no globe glow)
const NEBULA_SRC = `#version 300 es
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;

out vec4 fragColor;

vec3 hash33(vec3 p) {
  p = fract(p * vec3(443.8975, 397.2973, 491.1871));
  p += dot(p.zxy, p.yxz + 19.19);
  return fract(vec3(p.x * p.y, p.z * p.x, p.y * p.z));
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(mix(dot(hash33(i) - 0.5, f),
            dot(hash33(i + vec3(1,0,0)) - 0.5, f - vec3(1,0,0)), f.x),
        mix(dot(hash33(i + vec3(0,1,0)) - 0.5, f - vec3(0,1,0)),
            dot(hash33(i + vec3(1,1,0)) - 0.5, f - vec3(1,1,0)), f.x), f.y),
    mix(mix(dot(hash33(i + vec3(0,0,1)) - 0.5, f - vec3(0,0,1)),
            dot(hash33(i + vec3(1,0,1)) - 0.5, f - vec3(1,0,1)), f.x),
        mix(dot(hash33(i + vec3(0,1,1)) - 0.5, f - vec3(0,1,1)),
            dot(hash33(i + vec3(1,1,1)) - 0.5, f - vec3(1,1,1)), f.x), f.y),
    f.z);
  return n + 0.5;
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  vec3 shift = vec3(100.0);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

float stars(vec2 uv, float scale, float brightness, float time) {
  vec2 id = floor(uv * scale);
  vec2 gv = fract(uv * scale) - 0.5;
  float h = hash21(id);
  float star = 0.0;
  if (h > 0.97) {
    float d = length(gv);
    float h2 = hash21(id + 71.7);
    // Mix two sine waves at different speeds per star for organic twinkle
    float slow = sin(time * (0.15 + h * 0.4) + h * 6.28);
    float fast = sin(time * (0.6 + h2 * 1.2) + h2 * 6.28);
    float twinkle = (slow * 0.6 + fast * 0.4) * 0.5 + 0.5;
    star = brightness * smoothstep(0.05, 0.0, d) * (0.6 + 0.4 * twinkle);
  }
  return star;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 centered = (gl_FragCoord.xy - u_resolution * 0.5) / min(u_resolution.x, u_resolution.y);
  float t = u_time * 0.03;

  vec3 p = vec3(centered * 2.0, t * 0.5);
  float warp1 = fbm(p + vec3(0.0, 0.0, t));
  float warp2 = fbm(p + vec3(5.2, 1.3, t * 0.7));
  float nebula = fbm(p + vec3(warp1, warp2, 0.0) * 1.5);

  vec3 col1 = vec3(0.05, 0.015, 0.10);
  vec3 col2 = vec3(0.03, 0.05, 0.12);
  vec3 col3 = vec3(0.015, 0.08, 0.10);
  vec3 col4 = vec3(0.10, 0.025, 0.08);

  vec3 color = mix(col1, col2, smoothstep(0.2, 0.6, nebula));
  color = mix(color, col3, smoothstep(0.4, 0.8, warp1) * 0.6);
  color = mix(color, col4, smoothstep(0.5, 0.9, warp2) * 0.4);

  float glow = smoothstep(0.55, 0.75, nebula) * 0.12;
  vec3 glowColor = mix(vec3(0.12, 0.08, 0.25), vec3(0.04, 0.15, 0.18), warp1);
  color += glow * glowColor;

  // Floating particles
  float p1 = stars(uv + vec2(t * 0.01, t * 0.005), 80.0, 0.8, u_time);
  float p2 = stars(uv + vec2(-t * 0.008, t * 0.012), 120.0, 0.5, u_time);
  float p3 = stars(uv + vec2(t * 0.006, -t * 0.003), 200.0, 0.3, u_time);
  color += vec3(0.7, 0.8, 1.0) * (p1 + p2 + p3);

  // Subtle vignette
  float dist = length(centered);
  float vignette = 1.0 - 0.25 * smoothstep(0.5, 1.5, dist);
  color *= max(vignette, 0.0);

  fragColor = vec4(color, 1.0);
}`;

// Pass 2: Blit cached texture + live globe glow
const BLIT_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_nebulaTexture;
uniform vec2 u_resolution;
uniform float u_globeRadius;

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 centered = (gl_FragCoord.xy - u_resolution * 0.5) / min(u_resolution.x, u_resolution.y);
  float dist = length(centered);

  // Sample cached nebula
  vec3 color = texture(u_nebulaTexture, uv).rgb;

  // Live globe glow — smooth falloff from globe edge
  float r = u_globeRadius;
  float d = max(dist - r, 0.0) / max(r, 0.1);
  float glow = 0.15 / (1.0 + d * 6.0) * smoothstep(r + 0.8, r, dist);
  vec3 globeGlowCol = vec3(0.2, 0.3, 0.55);
  color += globeGlowCol * glow;

  fragColor = vec4(color, 1.0);
}`;

let canvas: HTMLCanvasElement | null = null;
let gl: WebGL2RenderingContext | null = null;
let nebulaProgram: WebGLProgram | null = null;
let blitProgram: WebGLProgram | null = null;
let animationId: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let startTime = 0;
let currentGlobeRadius = 0.45;

// Nebula program uniforms
let nebTimeLoc: WebGLUniformLocation | null = null;
let nebResolutionLoc: WebGLUniformLocation | null = null;

// Blit program uniforms
let blitTextureLoc: WebGLUniformLocation | null = null;
let blitResolutionLoc: WebGLUniformLocation | null = null;
let blitGlobeRadiusLoc: WebGLUniformLocation | null = null;

// Framebuffer for offscreen nebula rendering
let fbo: WebGLFramebuffer | null = null;
let fboTexture: WebGLTexture | null = null;
let fboWidth = 0;
let fboHeight = 0;

// State
let mapIdle = true;
let needsNebulaUpdate = true;
let pausedAt = 0; // timestamp when map interaction started
let totalPausedMs = 0; // accumulated paused time to subtract from elapsed

const RESOLUTION_SCALE = 0.5;
const FRAME_INTERVAL = 1000 / 30;
let lastFrameTime = 0;

function createShader(
  ctx: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = ctx.createShader(type);
  if (shader === null) return null;
  ctx.shaderSource(shader, source);
  ctx.compileShader(shader);
  if (ctx.getShaderParameter(shader, ctx.COMPILE_STATUS) !== true) {
    console.error('Shader compile error:', ctx.getShaderInfoLog(shader));
    ctx.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(
  ctx: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string
): WebGLProgram | null {
  const vs = createShader(ctx, ctx.VERTEX_SHADER, vsSrc);
  const fs = createShader(ctx, ctx.FRAGMENT_SHADER, fsSrc);
  if (vs === null || fs === null) return null;

  const prog = ctx.createProgram() as WebGLProgram | null;
  if (prog === null) return null;
  ctx.attachShader(prog, vs);
  ctx.attachShader(prog, fs);
  ctx.linkProgram(prog);
  ctx.deleteShader(vs);
  ctx.deleteShader(fs);

  if (ctx.getProgramParameter(prog, ctx.LINK_STATUS) !== true) {
    console.error('Program link error:', ctx.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

function ensureFbo(w: number, h: number) {
  if (gl === null) return;
  if (fboWidth === w && fboHeight === h && fbo !== null) return;

  // Clean up old
  if (fbo !== null) gl.deleteFramebuffer(fbo);
  if (fboTexture !== null) gl.deleteTexture(fboTexture);

  fboTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, fboTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    w,
    h,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    fboTexture,
    0
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  fboWidth = w;
  fboHeight = h;
  needsNebulaUpdate = true;
}

function initGL(container: HTMLElement) {
  canvas = document.createElement('canvas');
  canvas.id = 'globe-bg';
  container.prepend(canvas);

  gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (gl === null) return false;

  canvas.addEventListener('webglcontextlost', (e) => {
    console.error('[GlobeBG] WebGL context LOST', e);
    // Stop animation loop — no point rendering with a dead context
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  });
  canvas.addEventListener('webglcontextrestored', () => {
    console.warn('[GlobeBG] WebGL context restored');
  });

  nebulaProgram = createProgram(gl, VERTEX_SRC, NEBULA_SRC);
  blitProgram = createProgram(gl, VERTEX_SRC, BLIT_SRC);
  if (nebulaProgram === null || blitProgram === null) return false;

  // Fullscreen quad (shared by both programs)
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // prettier-ignore
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1
  ]), gl.STATIC_DRAW);

  // Setup attribs for both programs
  for (const prog of [nebulaProgram, blitProgram]) {
    gl.useProgram(prog);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  }

  // Get uniform locations
  nebTimeLoc = gl.getUniformLocation(nebulaProgram, 'u_time');
  nebResolutionLoc = gl.getUniformLocation(nebulaProgram, 'u_resolution');

  blitTextureLoc = gl.getUniformLocation(blitProgram, 'u_nebulaTexture');
  blitResolutionLoc = gl.getUniformLocation(blitProgram, 'u_resolution');
  blitGlobeRadiusLoc = gl.getUniformLocation(blitProgram, 'u_globeRadius');

  return true;
}

function resize(): { w: number; h: number } {
  if (canvas === null || gl === null) return { w: 0, h: 0 };
  const dpr = window.devicePixelRatio * RESOLUTION_SCALE;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  return { w: pw, h: ph };
}

function renderNebulaToTexture(elapsed: number, w: number, h: number) {
  if (gl === null || nebulaProgram === null) return;

  ensureFbo(w, h);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, w, h);
  gl.useProgram(nebulaProgram);
  gl.uniform1f(nebTimeLoc, elapsed);
  gl.uniform2f(nebResolutionLoc, w, h);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  needsNebulaUpdate = false;
}

function blitToScreen(w: number, h: number) {
  if (gl === null || blitProgram === null || fboTexture === null) return;

  gl.viewport(0, 0, w, h);
  gl.useProgram(blitProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fboTexture);
  gl.uniform1i(blitTextureLoc, 0);
  gl.uniform2f(blitResolutionLoc, w, h);
  gl.uniform1f(blitGlobeRadiusLoc, currentGlobeRadius);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function render(now: number) {
  if (gl === null) return;
  animationId = requestAnimationFrame(render);

  // Skip when globe covers entire viewport
  if (currentGlobeRadius > 0.75) return;

  if (now - lastFrameTime < FRAME_INTERVAL) return;
  lastFrameTime = now;

  const { w, h } = resize();
  if (w === 0 || h === 0) return;

  const elapsed = (now - startTime - totalPausedMs) / 1000;

  // Only re-render the expensive nebula when idle and needed
  if (mapIdle || needsNebulaUpdate) {
    renderNebulaToTexture(elapsed, w, h);
  }

  // Always blit cached texture + live glow (cheap)
  blitToScreen(w, h);
}

function setIdle(idle: boolean) {
  const now = performance.now();
  if (!idle && mapIdle) {
    // Map interaction started — record pause start
    pausedAt = now;
  } else if (idle && !mapIdle && pausedAt > 0) {
    // Map interaction ended — accumulate paused duration
    totalPausedMs += now - pausedAt;
    pausedAt = 0;
    needsNebulaUpdate = true;
  }
  mapIdle = idle;
}

function setRadius(radiusPixels: number, viewportMinDim: number) {
  currentGlobeRadius = radiusPixels / viewportMinDim;
}

function start() {
  if (canvas !== null) {
    canvas.style.display = 'block';
  }
  if (animationId !== null) return;
  startTime = performance.now();
  lastFrameTime = 0;
  totalPausedMs = 0;
  pausedAt = 0;
  needsNebulaUpdate = true;
  animationId = requestAnimationFrame(render);
}

function stop() {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (canvas !== null) {
    canvas.style.display = 'none';
  }
}

function init(container: HTMLElement) {
  if (!initGL(container)) {
    console.warn('Globe background: WebGL2 not available');
    return;
  }

  resizeObserver = new ResizeObserver(() => {
    needsNebulaUpdate = true;
  });
  resizeObserver.observe(container);

  // Start hidden
  if (canvas !== null) {
    canvas.style.display = 'none';
  }
}

export default { setIdle, setRadius, start, stop, init };
