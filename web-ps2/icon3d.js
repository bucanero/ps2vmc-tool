/*
 * icon3d.js - WebGL renderer for PS2 save icons.
 *
 * Draws the textured 3D model parsed by ps2icon.js, morphing between its
 * animation shapes and lit by the three directional lights + ambient term from
 * icon.sys, over the card's four-corner background gradient. Drag to orbit.
 *
 * One renderer owns one WebGL context; browsers cap the number of live
 * contexts, so the app keeps a single instance and re-points it at whichever
 * save is selected.
 *
 * GPLv3, same as the rest of the repository.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PS2Icon3D = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------- minimal mat4 ---------------- */

  function identity() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  }

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  function multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++)
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                       a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }

  function translate(x, y, z) {
    const m = identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  }

  function scale(s) {
    const m = identity();
    m[0] = m[5] = m[10] = s;
    return m;
  }

  function rotateY(a) {
    const m = identity(), c = Math.cos(a), s = Math.sin(a);
    m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
    return m;
  }

  function rotateX(a) {
    const m = identity(), c = Math.cos(a), s = Math.sin(a);
    m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
    return m;
  }

  /* ---------------- shaders ---------------- */

  const VERT = `
    attribute vec3 aPosA;
    attribute vec3 aPosB;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    attribute vec4 aColor;

    uniform mat4 uMVP;
    uniform mat4 uModel;
    uniform float uMorph;
    uniform vec3 uLightDir[3];
    uniform vec3 uLightCol[3];
    uniform vec3 uAmbient;

    varying vec2 vUV;
    varying vec4 vColor;

    void main() {
      vec3 pos = mix(aPosA, aPosB, uMorph);
      gl_Position = uMVP * vec4(pos, 1.0);

      vec3 n = normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal);

      vec3 light = uAmbient;
      for (int i = 0; i < 3; i++)
        light += uLightCol[i] * max(dot(n, normalize(uLightDir[i])), 0.0);

      /* PS2 vertex colours are 0x80-centred: 128 means "unmodified".
       * Vertex alpha is NOT a transparency channel here - roughly a third of
       * real save icons store 0 in it and are still drawn solid on console,
       * so it is deliberately ignored. */
      vColor = vec4(clamp(light, 0.0, 2.0) * (aColor.rgb / 128.0), 1.0);
      vUV = aUV;
    }
  `;

  const FRAG = `
    precision mediump float;
    uniform sampler2D uTex;
    uniform float uAlpha;
    varying vec2 vUV;
    varying vec4 vColor;

    void main() {
      vec4 t = texture2D(uTex, vUV);
      gl_FragColor = vec4(t.rgb * vColor.rgb, uAlpha);
    }
  `;

  /* Fullscreen gradient built from the four icon.sys corner colours. */
  const BG_VERT = `
    attribute vec2 aPos;
    attribute vec3 aCol;
    varying vec3 vCol;
    void main() { vCol = aCol; gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const BG_FRAG = `
    precision mediump float;
    varying vec3 vCol;
    void main() { gl_FragColor = vec4(vCol, 1.0); }
  `;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error("shader: " + gl.getShaderInfoLog(s));
    return s;
  }

  function link(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error("link: " + gl.getProgramInfoLog(p));
    return p;
  }

  /* ---------------- animation (pure, unit-testable) ---------------- */

  /**
   * Work out the shape sequence and loop duration for a parsed icon.
   * frame_length is the loop length in 60Hz display frames and anim_speed
   * scales playback; both are undocumented in the format notes, so the result
   * is clamped to something watchable.
   */
  function animationPlan(icon) {
    let order = icon.frames && icon.frames.length
      ? icon.frames.map(f => Math.min(f.shapeId, icon.shapeCount - 1))
      : icon.shapes.map((_, i) => i);
    if (order.length < 2) order = [0];

    const loopSeconds = icon.frameLength
      ? Math.min(10, Math.max(0.3, icon.frameLength / (60 * (icon.animSpeed || 1))))
      : order.length * 0.15;

    return { order, loopSeconds, animated: order.length > 1 };
  }

  /**
   * Which two shapes is the icon between at time t (seconds), and how far?
   * Returns { a, b, morph } with morph in [0,1).
   */
  function morphAt(plan, t) {
    if (plan.order.length < 2) return { a: plan.order[0] || 0, b: plan.order[0] || 0, morph: 0 };
    const n = plan.order.length;
    let pos = (t / plan.loopSeconds) * n;
    pos = pos - Math.floor(pos / n) * n;              /* wrap into [0,n) */
    const i = Math.floor(pos) % n;
    return { a: plan.order[i], b: plan.order[(i + 1) % n], morph: pos - Math.floor(pos) };
  }

  /* ---------------- renderer ---------------- */

  function create(canvas) {
    const gl = canvas.getContext("webgl", { alpha: false, antialias: true, depth: true });
    if (!gl) throw new Error("WebGL is not available in this browser");

    const prog = link(gl, VERT, FRAG);
    const bgProg = link(gl, BG_VERT, BG_FRAG);

    const loc = {
      posA: gl.getAttribLocation(prog, "aPosA"),
      posB: gl.getAttribLocation(prog, "aPosB"),
      normal: gl.getAttribLocation(prog, "aNormal"),
      uv: gl.getAttribLocation(prog, "aUV"),
      color: gl.getAttribLocation(prog, "aColor"),
      mvp: gl.getUniformLocation(prog, "uMVP"),
      model: gl.getUniformLocation(prog, "uModel"),
      morph: gl.getUniformLocation(prog, "uMorph"),
      lightDir: gl.getUniformLocation(prog, "uLightDir"),
      lightCol: gl.getUniformLocation(prog, "uLightCol"),
      ambient: gl.getUniformLocation(prog, "uAmbient"),
      tex: gl.getUniformLocation(prog, "uTex"),
      alpha: gl.getUniformLocation(prog, "uAlpha")
    };
    const bgLoc = {
      pos: gl.getAttribLocation(bgProg, "aPos"),
      col: gl.getAttribLocation(bgProg, "aCol")
    };

    const buffers = {
      shapes: [], normal: gl.createBuffer(), uv: gl.createBuffer(),
      color: gl.createBuffer(), bg: gl.createBuffer()
    };
    let texture = gl.createTexture();
    let icon = null, sys = null;
    let vertexCount = 0, plan = { order: [0], loopSeconds: 1, animated: false };
    let lastFrame = null;
    let radius = 1, center = [0, 0, 0];
    let raf = 0, t0 = 0;

    const state = { yaw: 0.0, pitch: 0.0, autoRotate: true, dragging: false, paused: false };

    /* ---- input: drag to orbit ---- */
    let lastX = 0, lastY = 0;
    const down = e => {
      state.dragging = true;
      const p = e.touches ? e.touches[0] : e;
      lastX = p.clientX; lastY = p.clientY;
      e.preventDefault();
    };
    const move = e => {
      if (!state.dragging) return;
      const p = e.touches ? e.touches[0] : e;
      state.yaw += (p.clientX - lastX) * 0.01;
      state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch + (p.clientY - lastY) * 0.01));
      lastX = p.clientX; lastY = p.clientY;
      state.autoRotate = false;
      e.preventDefault();
    };
    const up = () => { state.dragging = false; };

    canvas.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    canvas.addEventListener("touchstart", down, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", up);

    function uploadShapes() {
      for (const b of buffers.shapes) gl.deleteBuffer(b);
      buffers.shapes = icon.shapes.map(s => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, s, gl.STATIC_DRAW);
        return b;
      });

      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
      gl.bufferData(gl.ARRAY_BUFFER, icon.normals, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv);
      gl.bufferData(gl.ARRAY_BUFFER, icon.uvs, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
      gl.bufferData(gl.ARRAY_BUFFER, icon.colors, gl.STATIC_DRAW);
    }

    function uploadTexture() {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const px = icon.texture
        ? new Uint8Array(icon.texture.buffer)
        : new Uint8Array([255, 255, 255, 255]);
      const size = icon.texture ? 128 : 1;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    function computeBounds() {
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const s of icon.shapes)
        for (let i = 0; i < s.length; i += 3)
          for (let k = 0; k < 3; k++) {
            if (s[i + k] < mn[k]) mn[k] = s[i + k];
            if (s[i + k] > mx[k]) mx[k] = s[i + k];
          }
      center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
      radius = Math.max(
        Math.hypot(mx[0] - center[0], mx[1] - center[1], mx[2] - center[2]), 0.001);
    }

    function uploadBackground() {
      /* icon.sys order: upper-left, upper-right, lower-left, lower-right */
      const c = (sys && sys.background) || [[0.1,0.1,0.12,1],[0.1,0.1,0.12,1],[0.05,0.05,0.07,1],[0.05,0.05,0.07,1]];
      const q = new Float32Array([
        -1,  1, c[0][0], c[0][1], c[0][2],
         1,  1, c[1][0], c[1][1], c[1][2],
        -1, -1, c[2][0], c[2][1], c[2][2],
         1,  1, c[1][0], c[1][1], c[1][2],
         1, -1, c[3][0], c[3][1], c[3][2],
        -1, -1, c[2][0], c[2][1], c[2][2]
      ]);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.bg);
      gl.bufferData(gl.ARRAY_BUFFER, q, gl.STATIC_DRAW);
    }

    function draw(now) {
      raf = requestAnimationFrame(draw);
      if (!icon) return;

      const w = canvas.clientWidth || 320, h = canvas.clientHeight || 320;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== (w * dpr | 0) || canvas.height !== (h * dpr | 0)) {
        canvas.width = w * dpr | 0;
        canvas.height = h * dpr | 0;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);

      if (!t0) t0 = now;
      const t = state.paused ? 0 : (now - t0) / 1000;

      /* background gradient */
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(bgProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.bg);
      gl.enableVertexAttribArray(bgLoc.pos);
      gl.vertexAttribPointer(bgLoc.pos, 2, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(bgLoc.col);
      gl.vertexAttribPointer(bgLoc.col, 3, gl.FLOAT, false, 20, 8);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      /* model */
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.useProgram(prog);

      /* which two shapes are we between? */
      const m = morphAt(plan, t);
      const a = m.a, b = m.b, morph = m.morph;
      lastFrame = { t, a, b, morph, yaw: state.yaw };

      const bindShape = (slot, index) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.shapes[index] || buffers.shapes[0]);
        gl.enableVertexAttribArray(slot);
        gl.vertexAttribPointer(slot, 3, gl.FLOAT, false, 0, 0);
      };
      bindShape(loc.posA, a);
      bindShape(loc.posB, b);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
      gl.enableVertexAttribArray(loc.normal);
      gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv);
      gl.enableVertexAttribArray(loc.uv);
      gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
      gl.enableVertexAttribArray(loc.color);
      gl.vertexAttribPointer(loc.color, 4, gl.UNSIGNED_BYTE, false, 0, 0);

      if (state.autoRotate && !state.paused) state.yaw = t * 0.5;

      /* PS2 model space is Y-down; flip Y and Z into WebGL's convention */
      const flip = identity();
      flip[5] = -1; flip[10] = -1;
      const model = multiply(
        multiply(multiply(rotateX(state.pitch), rotateY(state.yaw)), scale(1 / radius)),
        multiply(flip, translate(-center[0], -center[1], -center[2])));

      const view = translate(0, 0, -3.2);
      const proj = perspective(0.7, canvas.width / canvas.height, 0.1, 100);
      const mvp = multiply(proj, multiply(view, model));

      gl.uniformMatrix4fv(loc.mvp, false, mvp);
      gl.uniformMatrix4fv(loc.model, false, model);
      gl.uniform1f(loc.morph, morph);

      const dirs = (sys && sys.lightDirections) || [[0.5,0.5,0.5,0],[-0.5,0.5,0.5,0],[0,-0.5,0.5,0]];
      const cols = (sys && sys.lightColors) || [[1,1,1,0],[0.6,0.6,0.6,0],[0.4,0.4,0.4,0]];
      const amb = (sys && sys.ambient) || [0.4, 0.4, 0.4, 0];
      gl.uniform3fv(loc.lightDir, new Float32Array([
        dirs[0][0], dirs[0][1], dirs[0][2],
        dirs[1][0], dirs[1][1], dirs[1][2],
        dirs[2][0], dirs[2][1], dirs[2][2]]));
      gl.uniform3fv(loc.lightCol, new Float32Array([
        cols[0][0], cols[0][1], cols[0][2],
        cols[1][0], cols[1][1], cols[1][2],
        cols[2][0], cols[2][1], cols[2][2]]));
      gl.uniform3fv(loc.ambient, new Float32Array([amb[0], amb[1], amb[2]]));

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(loc.tex, 0);
      gl.uniform1f(loc.alpha, 1.0);

      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    }

    return {
      state,

      /** Point the renderer at a parsed icon (from PS2Icon.parseIco) + icon.sys. */
      setIcon(parsedIcon, iconSys) {
        icon = parsedIcon;
        sys = iconSys || null;
        vertexCount = icon.vertexCount;

        plan = animationPlan(icon);

        computeBounds();
        uploadShapes();
        uploadTexture();
        uploadBackground();
        t0 = 0;
        state.yaw = 0;
        state.pitch = 0;
        state.autoRotate = true;
      },

      start() { if (!raf) raf = requestAnimationFrame(draw); },
      stop() { cancelAnimationFrame(raf); raf = 0; },
      resetView() { state.yaw = 0; state.pitch = 0; state.autoRotate = true; },
      isAnimated() { return plan.animated; },
      loopSeconds() { return plan.loopSeconds; },
      plan() { return plan; },
      /** State of the most recently drawn frame; null until the first draw. */
      lastFrame() { return lastFrame; },

      dispose() {
        this.stop();
        canvas.removeEventListener("mousedown", down);
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      }
    };
  }

  return { create, animationPlan, morphAt };
});
