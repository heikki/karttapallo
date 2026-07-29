import type { CustomRenderMethodInput, Map as MapGL } from 'maplibre-gl';

export const MIP_LEVELS = 4;

// --- Shader wrapper ---

export class Shader {
  readonly program: WebGLProgram;
  private readonly _u: Record<string, WebGLUniformLocation | null> = {};
  private readonly _a: Record<string, number> = {};

  constructor(
    gl: WebGL2RenderingContext,
    vertSrc: string,
    fragSrc: string,
    opts: { u: string[]; a: string[] }
  ) {
    this.program = compile(gl, vertSrc, fragSrc);
    for (const n of opts.u) {
      this._u[n] = gl.getUniformLocation(this.program, n);
    }
    for (const n of opts.a) {
      this._a[n] = gl.getAttribLocation(this.program, n);
    }
  }

  u(name: string): WebGLUniformLocation | null {
    return this._u[name] ?? null;
  }
  a(name: string) {
    return this._a[name] ?? -1;
  }
}

// --- Compilation ---

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string
): WebGLShader {
  const s = gl.createShader(type);
  if (s === null) {
    throw new Error('createShader failed');
  }
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS) === false) {
    throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
  }
  return s;
}

function compile(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (gl.getProgramParameter(p, gl.LINK_STATUS) === false) {
    throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  }
  return p;
}

// --- Projection ---

type ShaderData = CustomRenderMethodInput['shaderData'];

const PROJ_U = [
  'u_matrix',
  'u_projection_matrix',
  'u_projection_fallback_matrix',
  'u_projection_tile_mercator_coords',
  'u_projection_clipping_plane',
  'u_projection_transition'
];

function projectionPrelude(shaderData: ShaderData) {
  if (shaderData.vertexShaderPrelude.length > 0) {
    return `${shaderData.vertexShaderPrelude}\n${shaderData.define}`;
  }
  return 'uniform mat4 u_matrix;\nvec4 projectTile(vec2 p){return u_matrix*vec4(p,0.,1.);}';
}

export function setProjectionUniforms(
  gl: WebGL2RenderingContext,
  s: Shader,
  map: MapGL,
  options: CustomRenderMethodInput
) {
  const t = map.transform as unknown as Record<string, unknown>;
  if (typeof t.getProjectionDataForCustomLayer !== 'function') {
    gl.uniformMatrix4fv(
      s.u('u_matrix'),
      false,
      options.modelViewProjectionMatrix as Float32Array
    );
    return;
  }
  const pd = (
    t.getProjectionDataForCustomLayer as (b: boolean) => {
      mainMatrix: Float32Array;
      fallbackMatrix: Float32Array;
      tileMercatorCoords: [number, number, number, number];
      clippingPlane: [number, number, number, number];
      projectionTransition: number;
    }
  )(true);
  gl.uniformMatrix4fv(s.u('u_projection_matrix'), false, pd.mainMatrix);
  gl.uniformMatrix4fv(
    s.u('u_projection_fallback_matrix'),
    false,
    pd.fallbackMatrix
  );
  gl.uniform4f(
    s.u('u_projection_tile_mercator_coords'),
    ...pd.tileMercatorCoords
  );
  gl.uniform4f(s.u('u_projection_clipping_plane'), ...pd.clippingPlane);
  gl.uniform1f(s.u('u_projection_transition'), pd.projectionTransition);
}

// --- Shader factories ---

export function createNightShader(
  gl: WebGL2RenderingContext,
  sd: ShaderData
): Shader {
  return new Shader(
    gl,
    `#version 300 es
precision highp float;
in vec2 a_pos; out vec2 v_pos;
${projectionPrelude(sd)}
uniform vec2 u_viewport;
void main(){
  vec4 p=projectTile(a_pos);
  vec2 dir=p.xy;
  float len=length(dir);
  if(len>0.0){p.xy+=dir/len*(2.0/min(u_viewport.x,u_viewport.y))*p.w;}
  gl_Position=p;v_pos=a_pos;
}`,
    `#version 300 es
precision highp float;
in vec2 v_pos; out vec4 fragColor;
uniform vec2 u_subsolar; uniform float u_opacity;
void main(){
  vec2 ll=vec2(v_pos.x*360.-180.,degrees(2.*atan(exp(${Math.PI}*(1.-2.*v_pos.y)))-${Math.PI / 2}));
  vec2 o=radians(ll),s=radians(u_subsolar);
  float alt=degrees(asin(sin(o.y)*sin(s.y)+cos(o.y)*cos(s.y)*cos(s.x-o.x)));
  fragColor=vec4(0.,0.,0.,(1.-clamp(pow(0.5,-alt/6.),0.,1.))*u_opacity);
}`,
    { u: ['u_subsolar', 'u_opacity', 'u_viewport', ...PROJ_U], a: ['a_pos'] }
  );
}

export function createPointShader(
  gl: WebGL2RenderingContext,
  sd: ShaderData
): Shader {
  return new Shader(
    gl,
    `#version 300 es
precision highp float;
in vec3 a_photo_pos; in vec2 a_lnglat;
uniform vec2 u_viewport; uniform float u_zoom; uniform float u_point_size;
uniform vec3 u_sun_dir; out float v_night;
${projectionPrelude(sd)}
void main(){
  gl_Position=projectTile(a_photo_pos.xy);
  vec3 d=vec3(cos(a_lnglat.y)*cos(a_lnglat.x),cos(a_lnglat.y)*sin(a_lnglat.x),sin(a_lnglat.y));
  v_night=smoothstep(.1,-.1,dot(d,u_sun_dir));
  gl_PointSize=max(2.,u_point_size*pow(1.5,u_zoom-8.)*a_photo_pos.z)*v_night;
}`,
    `#version 300 es
precision highp float;
uniform vec3 u_color; uniform float u_intensity; in float v_night; out vec4 fragColor;
void main(){
  if(v_night<.001)discard;
  float dist=length(gl_PointCoord*2.-1.);
  if(dist>1.)discard;
  fragColor=vec4(u_color*u_intensity*(1.-dist*dist)*v_night,1.);
}`,
    {
      u: [
        'u_viewport',
        'u_zoom',
        'u_point_size',
        'u_color',
        'u_intensity',
        'u_sun_dir',
        ...PROJ_U
      ],
      a: ['a_photo_pos', 'a_lnglat']
    }
  );
}

const QUAD_VERT = `#version 300 es
precision highp float;
in vec2 a_pos; out vec2 v_uv;
void main(){v_uv=a_pos*.5+.5;gl_Position=vec4(a_pos,0.,1.);}`;

const BLUR_W = [0.227027, 0.194595, 0.121622, 0.054054, 0.016216];

export function createBlurShader(gl: WebGL2RenderingContext): Shader {
  return new Shader(
    gl,
    QUAD_VERT,
    `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 fragColor;
uniform sampler2D u_tex; uniform vec2 u_dir; uniform vec2 u_res; uniform float u_spread;
void main(){
  float w[5]=float[](${BLUR_W.join(',')});
  vec2 ts=u_dir/u_res*u_spread;
  vec4 r=texture(u_tex,v_uv)*w[0];
  for(int i=1;i<5;i++){vec2 o=ts*float(i);r+=texture(u_tex,v_uv+o)*w[i]+texture(u_tex,v_uv-o)*w[i];}
  fragColor=r;
}`,
    { u: ['u_tex', 'u_dir', 'u_res', 'u_spread'], a: ['a_pos'] }
  );
}

export function createCompositeShader(gl: WebGL2RenderingContext): Shader {
  let samplers = '';
  let combine = 'vec3 b=vec3(0.);';
  for (let i = 0; i < MIP_LEVELS; i++) {
    samplers += `uniform sampler2D u_b${i};`;
    combine += `b+=texture(u_b${i},v_uv).rgb*u_w[${i}];`;
  }
  return new Shader(
    gl,
    QUAD_VERT,
    `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 fragColor;
${samplers} uniform float u_strength; uniform float u_w[${MIP_LEVELS}];
void main(){${combine}fragColor=vec4(b*u_strength,1.);}`,
    {
      u: [
        ...Array.from({ length: MIP_LEVELS }, (_, i) => `u_b${i}`),
        'u_strength',
        'u_w'
      ],
      a: ['a_pos']
    }
  );
}
