import { createTileMesh, MercatorCoordinate } from 'maplibre-gl';
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapGL
} from 'maplibre-gl';

import { toUtcSortKey } from '@common/utils';

import {
  buildMips,
  deleteMips,
  restoreGl,
  saveFbo,
  type MipLevel
} from './gl-utils';
import { computeTransition, getSubsolarPoint } from './night';
import {
  createBlurShader,
  createCompositeShader,
  createNightShader,
  createPointShader,
  MIP_LEVELS,
  setProjectionUniforms,
  type Shader
} from './shaders';

const BLUR_ITERATIONS = 2;
const STRIDE = 5 * 4;
const DEG2RAD = Math.PI / 180;
const MIP_W = new Float32Array([1.0, 0.8, 0.5, 0.3]);

export class BloomLayer implements CustomLayerInterface {
  readonly id = 'points-bloom';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private gl: WebGL2RenderingContext | null = null;
  private map: MapGL | null = null;
  private instanceBuf: WebGLBuffer | null = null;
  private quadBuf: WebGLBuffer | null = null;
  private readonly shaders = new Map<string, Shader>();
  private blur: Shader | null = null;
  private composite: Shader | null = null;

  private nightVB: WebGLBuffer | null = null;
  private nightIB: WebGLBuffer | null = null;
  private nightCount = 0;
  private nightBuilt = false;

  private brightFbo: WebGLFramebuffer | null = null;
  private brightTex: WebGLTexture | null = null;
  private fbW = 0;
  private fbH = 0;
  private mips: MipLevel[] = [];

  private instanceCount = 0;
  private readonly color: [number, number, number] = [1.0, 0.96, 0.88];
  private nightDate: Date | null = null;
  private readonly nightOpacity = 0.8;
  private nightAnimationId: number | null = null;
  private projectionHandler: (() => void) | null = null;

  private lastMatrix: Float32Array | null = null;
  private dataGeneration = 0;
  private renderedGeneration = -1;
  private hasCachedBlur = false;

  private instanceData: Float32Array | null = null;
  private cachedSun: { lng: number; lat: number } | null = null;
  private cachedSunTime: number | null = null;
  private mercatorCache = new Map<string, { x: number; y: number }>();

  setTime(dateStr: string, tz: string | null) {
    if (this.nightAnimationId !== null) {
      cancelAnimationFrame(this.nightAnimationId);
      this.nightAnimationId = null;
    }

    if (dateStr === '') {
      this.nightDate = null;
      this.map?.triggerRepaint();
      return;
    }

    const targetDate = new Date(toUtcSortKey(dateStr, tz));
    if (isNaN(targetDate.getTime())) return;

    if (this.nightDate === null) {
      this.nightDate = targetDate;
      this.map?.triggerRepaint();
      return;
    }

    const { startTime, endTime, duration } = computeTransition(
      this.nightDate,
      targetDate
    );
    this.animateNight(startTime, endTime, duration);
  }

  private animateNight(startTime: number, endTime: number, duration: number) {
    const animStart = performance.now();
    const animate = (now: number) => {
      const t = Math.min(1, (now - animStart) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      const interpolated = startTime + (endTime - startTime) * eased;
      this.nightDate = new Date(interpolated);
      this.map?.triggerRepaint();
      if (t < 1) {
        this.nightAnimationId = requestAnimationFrame(animate);
      } else {
        this.nightAnimationId = null;
      }
    };
    this.nightAnimationId = requestAnimationFrame(animate);
  }

  private getSubsolarPoint(): { lng: number; lat: number } {
    const t = this.nightDate?.getTime() ?? null;
    if (t === this.cachedSunTime && this.cachedSun !== null) {
      return this.cachedSun;
    }
    this.cachedSun = getSubsolarPoint(this.nightDate);
    this.cachedSunTime = t;
    return this.cachedSun;
  }

  onAdd(map: MapGL, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    this.instanceBuf = gl.createBuffer();
    this.brightFbo = gl.createFramebuffer();
    this.brightTex = gl.createTexture();
    this.nightVB = gl.createBuffer();
    this.nightIB = gl.createBuffer();
    this.blur = createBlurShader(gl);
    this.composite = createCompositeShader(gl);

    this.projectionHandler = () => {
      map.triggerRepaint();
    };
    map.on('projectiontransition', this.projectionHandler);
  }

  private getOrCreate(key: string, create: () => Shader): Shader {
    let s = this.shaders.get(key);
    if (s === undefined) {
      s = create();
      this.shaders.set(key, s);
    }
    return s;
  }

  private ensureFbos(gl: WebGL2RenderingContext, w: number, h: number) {
    if (w === this.fbW && h === this.fbH) return;
    this.fbW = w;
    this.fbH = h;
    this.mips = buildMips(gl, {
      sourceTex: this.brightTex!,
      sourceFbo: this.brightFbo!,
      oldMips: this.mips,
      w,
      h
    });
  }

  private buildNightMesh(gl: WebGL2RenderingContext) {
    if (this.nightBuilt || this.nightVB === null || this.nightIB === null) {
      return;
    }
    this.nightBuilt = true;
    const mesh = createTileMesh(
      {
        granularity: 100,
        generateBorders: false,
        extendToNorthPole: true,
        extendToSouthPole: true
      },
      '16bit'
    );
    const verts = new Float32Array(new Int16Array(mesh.vertices)).map(
      (v) => v / 8192
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nightVB);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.nightIB);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    this.nightCount = mesh.indices.byteLength / 2;
  }

  private drawNight(
    gl: WebGL2RenderingContext,
    options: CustomRenderMethodInput,
    sun: { lng: number; lat: number }
  ) {
    if (this.nightVB === null || this.nightIB === null) {
      return;
    }
    this.buildNightMesh(gl);
    const s = this.getOrCreate(`night-${options.shaderData.variantName}`, () =>
      createNightShader(gl, options.shaderData)
    );
    gl.useProgram(s.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.colorMask(true, true, true, false);
    setProjectionUniforms(gl, s, this.map!, options);
    const { width: nw, height: nh } = this.map!.getCanvas();
    gl.uniform2f(s.u('u_viewport'), nw, nh);
    gl.uniform2f(s.u('u_subsolar'), sun.lng, sun.lat);
    gl.uniform1f(s.u('u_opacity'), this.nightOpacity);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nightVB);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.nightIB);
    gl.enableVertexAttribArray(s.a('a_pos'));
    gl.vertexAttribPointer(s.a('a_pos'), 2, gl.FLOAT, false, 0, 0);
    gl.drawElements(gl.TRIANGLES, this.nightCount, gl.UNSIGNED_SHORT, 0);
    gl.colorMask(true, true, true, true);
    gl.disableVertexAttribArray(s.a('a_pos'));
  }

  private drawBright(
    gl: WebGL2RenderingContext,
    options: CustomRenderMethodInput,
    sun: { lng: number; lat: number }
  ) {
    const { width: w, height: h } = this.map!.getCanvas();
    const s = this.getOrCreate(`point-${options.shaderData.variantName}`, () =>
      createPointShader(gl, options.shaderData)
    );
    this.ensureFbos(gl, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.brightFbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(s.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    setProjectionUniforms(gl, s, this.map!, options);
    const zoom = this.map!.getZoom();
    const slng = sun.lng * DEG2RAD;
    const slat = sun.lat * DEG2RAD;
    gl.uniform2f(s.u('u_viewport'), w, h);
    gl.uniform1f(s.u('u_zoom'), zoom);
    gl.uniform1f(s.u('u_point_size'), 10.0);
    gl.uniform3fv(s.u('u_color'), this.color);
    gl.uniform1f(s.u('u_intensity'), 1.7);
    gl.uniform3f(
      s.u('u_sun_dir'),
      Math.cos(slat) * Math.cos(slng),
      Math.cos(slat) * Math.sin(slng),
      Math.sin(slat)
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.enableVertexAttribArray(s.a('a_photo_pos'));
    gl.vertexAttribPointer(s.a('a_photo_pos'), 3, gl.FLOAT, false, STRIDE, 0);
    const lnglat = s.a('a_lnglat');
    if (lnglat >= 0) {
      gl.enableVertexAttribArray(lnglat);
      gl.vertexAttribPointer(lnglat, 2, gl.FLOAT, false, STRIDE, 3 * 4);
    }
    gl.drawArrays(gl.POINTS, 0, this.instanceCount);
    gl.disableVertexAttribArray(s.a('a_photo_pos'));
    if (lnglat >= 0) {
      gl.disableVertexAttribArray(lnglat);
    }
  }

  private drawBlur(gl: WebGL2RenderingContext) {
    const b = this.blur!;
    gl.useProgram(b.program);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(b.a('a_pos'));
    gl.vertexAttribPointer(b.a('a_pos'), 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(b.u('u_tex'), 0);
    gl.uniform1f(
      b.u('u_spread'),
      Math.min(3.0, Math.max(0.1, 1.4 ** (this.map!.getZoom() - 4.0) * 0.3))
    );
    let src = this.brightTex!;
    for (const mip of this.mips) {
      gl.viewport(0, 0, mip.w, mip.h);
      gl.uniform2f(b.u('u_res'), mip.w, mip.h);
      let read = src;
      for (let j = 0; j < BLUR_ITERATIONS; j++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, mip.pingFbo);
        gl.bindTexture(gl.TEXTURE_2D, read);
        gl.uniform2f(b.u('u_dir'), 1, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, mip.fbo);
        gl.bindTexture(gl.TEXTURE_2D, mip.pingTex);
        gl.uniform2f(b.u('u_dir'), 0, 1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        read = mip.tex;
      }
      src = mip.tex;
    }
    gl.disableVertexAttribArray(b.a('a_pos'));
  }

  private drawComposite(
    gl: WebGL2RenderingContext,
    prevFbo: WebGLFramebuffer | null,
    w: number,
    h: number
  ) {
    const c = this.composite!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(c.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    gl.colorMask(true, true, true, false);
    for (let i = 0; i < MIP_LEVELS; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.mips[i]!.tex);
      gl.uniform1i(c.u(`u_b${i}`), i);
    }
    gl.uniform1f(
      c.u('u_strength'),
      1.2 / Math.max(1, (this.map!.getZoom() - 4) * 0.5)
    );
    gl.uniform1fv(c.u('u_w'), MIP_W);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(c.a('a_pos'));
    gl.vertexAttribPointer(c.a('a_pos'), 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.colorMask(true, true, true, true);
    gl.disableVertexAttribArray(c.a('a_pos'));
    for (let i = 0; i < MIP_LEVELS; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  private needsBlurUpdate(mvp: Float32Array, w: number, h: number) {
    return (
      this.matrixChanged(mvp) ||
      this.renderedGeneration !== this.dataGeneration ||
      w !== this.fbW ||
      h !== this.fbH ||
      !this.hasCachedBlur
    );
  }

  private matrixChanged(matrix: Float32Array) {
    if (this.lastMatrix === null) {
      this.lastMatrix = new Float32Array(matrix);
      return true;
    }
    for (let i = 0; i < matrix.length; i++) {
      if (this.lastMatrix[i] !== matrix[i]) {
        this.lastMatrix.set(matrix);
        return true;
      }
    }
    return false;
  }

  render(
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    options: CustomRenderMethodInput
  ) {
    if (this.map === null || this.quadBuf === null) {
      return;
    }
    const gl = _gl as WebGL2RenderingContext;
    const { width: w, height: h } = this.map.getCanvas();
    const prevFbo = saveFbo(gl);
    try {
      const sun = this.getSubsolarPoint();
      if (this.map.getProjection().type === 'globe') {
        this.drawNight(gl, options, sun);
      }
      this.renderBloom(gl, options, prevFbo);
    } catch (err) {
      console.error('[BloomLayer] render error:', err);
    }
    restoreGl(gl, prevFbo, w, h);
  }

  private renderBloom(
    gl: WebGL2RenderingContext,
    options: CustomRenderMethodInput,
    prevFbo: WebGLFramebuffer | null
  ) {
    const { width: w, height: h } = this.map!.getCanvas();
    if (
      this.instanceCount > 0 &&
      this.instanceBuf !== null &&
      this.brightFbo !== null &&
      this.blur !== null &&
      this.composite !== null
    ) {
      const mvp = options.modelViewProjectionMatrix as Float32Array;
      if (this.needsBlurUpdate(mvp, w, h)) {
        this.drawBright(gl, options, this.getSubsolarPoint());
        this.drawBlur(gl);
        this.renderedGeneration = this.dataGeneration;
        this.hasCachedBlur = true;
      }
      this.drawComposite(gl, prevFbo, w, h);
    }
  }

  updateData(
    positions: Array<{
      lng: number;
      lat: number;
      uuid: string;
      weight?: number;
    }>
  ) {
    const gl = this.gl;
    if (gl === null || this.instanceBuf === null) {
      return;
    }
    const needed = positions.length * 5;
    if (this.instanceData === null || this.instanceData.length < needed) {
      this.instanceData = new Float32Array(needed);
    }
    const data = this.instanceData;
    const newCache = new Map<string, { x: number; y: number }>();
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]!;
      const key = `${p.uuid}:${p.lng}:${p.lat}`;
      const cached =
        this.mercatorCache.get(key) ??
        MercatorCoordinate.fromLngLat([p.lng, p.lat]);
      const mx = cached.x;
      const my = cached.y;
      newCache.set(key, { x: mx, y: my });
      const o = i * 5;
      data[o] = mx;
      data[o + 1] = my;
      data[o + 2] = p.weight ?? 1.0;
      data[o + 3] = p.lng * DEG2RAD;
      data[o + 4] = p.lat * DEG2RAD;
    }
    this.mercatorCache = newCache;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, needed), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.instanceCount = positions.length;
    this.dataGeneration++;
  }

  onRemove(_map: MapGL, gl: WebGL2RenderingContext) {
    if (this.nightAnimationId !== null) {
      cancelAnimationFrame(this.nightAnimationId);
      this.nightAnimationId = null;
    }
    if (this.projectionHandler !== null) {
      _map.off('projectiontransition', this.projectionHandler);
      this.projectionHandler = null;
    }
    for (const s of this.shaders.values()) gl.deleteProgram(s.program);
    this.shaders.clear();
    if (this.blur !== null) gl.deleteProgram(this.blur.program);
    if (this.composite !== null) gl.deleteProgram(this.composite.program);
    for (const b of [
      this.quadBuf,
      this.instanceBuf,
      this.nightVB,
      this.nightIB
    ]) {
      if (b !== null) gl.deleteBuffer(b);
    }
    if (this.brightTex !== null) gl.deleteTexture(this.brightTex);
    if (this.brightFbo !== null) gl.deleteFramebuffer(this.brightFbo);
    deleteMips(gl, this.mips);
    this.mips = [];
    this.gl = null;
    this.map = null;
  }
}
