function initTex(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  w: number,
  h: number
) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/** Save only the framebuffer binding (the only unpredictable state).
 *  Avoids 8× gl.getParameter() GPU-CPU sync stalls per frame. */
export function saveFbo(gl: WebGL2RenderingContext): WebGLFramebuffer | null {
  return gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
}

/** Restore framebuffer, viewport, and reset GL state to MapLibre defaults. */
export function restoreGl(
  gl: WebGL2RenderingContext,
  prevFbo: WebGLFramebuffer | null,
  w: number,
  h: number
) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
  gl.viewport(0, 0, w, h);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.colorMask(true, true, true, true);
  gl.activeTexture(gl.TEXTURE0);
}

export interface MipLevel {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  pingFbo: WebGLFramebuffer;
  pingTex: WebGLTexture;
  w: number;
  h: number;
}

export function deleteMips(gl: WebGL2RenderingContext, mips: MipLevel[]) {
  for (const m of mips) {
    gl.deleteFramebuffer(m.fbo);
    gl.deleteTexture(m.tex);
    gl.deleteFramebuffer(m.pingFbo);
    gl.deleteTexture(m.pingTex);
  }
}

export function buildMips(
  gl: WebGL2RenderingContext,
  opts: {
    sourceTex: WebGLTexture;
    sourceFbo: WebGLFramebuffer;
    oldMips: MipLevel[];
    w: number;
    h: number;
  }
): MipLevel[] {
  const { sourceTex, sourceFbo, oldMips, w, h } = opts;
  initTex(gl, sourceTex, w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, sourceFbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    sourceTex,
    0
  );
  deleteMips(gl, oldMips);
  const mips: MipLevel[] = [];
  let mw = Math.max(1, w >> 1);
  let mh = Math.max(1, h >> 1);
  for (let i = 0; i < 4; i++) {
    const tex = gl.createTexture();
    initTex(gl, tex, mw, mh);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0
    );
    const pingTex = gl.createTexture();
    initTex(gl, pingTex, mw, mh);
    const pingFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, pingFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      pingTex,
      0
    );
    mips.push({ fbo, tex, pingFbo, pingTex, w: mw, h: mh });
    mw = Math.max(1, mw >> 1);
    mh = Math.max(1, mh >> 1);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return mips;
}
