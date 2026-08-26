// Classic (non-module) script — expects window.THREE to already be loaded
// (see index.html: three.min.js is loaded via a plain <script> tag before this file,
// so everything here works from file:// too, unlike ES module imports).
(function () {
  const M = 0.001;

  // Paints the REAL computed tile layout (whole + cut pieces) onto a canvas so the
  // 3D view shows exactly what the drawings show, cut tiles highlighted.
  function layoutTexture({ wmm, hmm, polys, colors, flipCanvas }) {
    const s = Math.min(1400 / Math.max(wmm, 1), 1400 / Math.max(hmm, 1), 0.6);
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(wmm * s));
    c.height = Math.max(8, Math.round(hmm * s));
    const g = c.getContext('2d');
    g.fillStyle = colors.grout;
    g.fillRect(0, 0, c.width, c.height);
    g.lineWidth = 1;
    g.strokeStyle = colors.grout;
    polys.forEach((p) => {
      g.fillStyle = p.full ? colors.tile : colors.cut;
      g.beginPath();
      p.pts.forEach((q, i) => {
        const x = q[0] * s;
        const y = (flipCanvas ? hmm - q[1] : q[1]) * s;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      });
      g.closePath();
      g.fill();
      g.stroke();
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }

  // Minimal drag-to-orbit / wheel-to-zoom controller — stands in for
  // three/examples/jsm/controls/OrbitControls, which only ships as an ES module
  // and can't be loaded as a classic script.
  function makeOrbitControls(camera, domElement) {
    const target = new THREE.Vector3();
    const spherical = new THREE.Spherical();
    const sphericalDelta = new THREE.Spherical(0, 0, 0);
    const offset = new THREE.Vector3();
    const rotateSpeed = 0.006;
    const minPhi = 0.06, maxPhi = Math.PI - 0.06;
    const minRadius = 0.4, maxRadius = 40;
    let dragging = false;
    let lastX = 0, lastY = 0;
    let dollyDelta = 1;

    function onPointerDown(e) {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
    }
    function onPointerMove(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      sphericalDelta.theta -= dx * rotateSpeed;
      sphericalDelta.phi -= dy * rotateSpeed;
    }
    function onPointerUp() { dragging = false; }
    function onWheel(e) {
      e.preventDefault();
      dollyDelta *= Math.pow(0.95, -e.deltaY * 0.01);
    }

    domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });

    const controls = {
      target,
      enableDamping: true,
      dampingFactor: 0.09,
      update() {
        offset.copy(camera.position).sub(target);
        spherical.setFromVector3(offset);
        spherical.theta += sphericalDelta.theta;
        spherical.phi = Math.max(minPhi, Math.min(maxPhi, spherical.phi + sphericalDelta.phi));
        spherical.radius = Math.max(minRadius, Math.min(maxRadius, spherical.radius * dollyDelta));
        offset.setFromSpherical(spherical);
        camera.position.copy(target).add(offset);
        camera.lookAt(target);
        if (controls.enableDamping) {
          sphericalDelta.theta *= (1 - controls.dampingFactor);
          sphericalDelta.phi *= (1 - controls.dampingFactor);
          dollyDelta = 1 + (dollyDelta - 1) * (1 - controls.dampingFactor);
        } else {
          sphericalDelta.theta = 0; sphericalDelta.phi = 0; dollyDelta = 1;
        }
      },
      dispose() {
        domElement.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        domElement.removeEventListener('wheel', onWheel);
      }
    };
    return controls;
  }

  function createRoomView(container) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    const controls = makeOrbitControls(camera, renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6d80, 1.15));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(3, 6, 2);
    scene.add(dir);

    let group = null;
    let raf = 0;

    function resize() {
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 420;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    function clear() {
      if (!group) return;
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
      scene.remove(group);
      group = null;
    }

    function update(spec) {
      clear();
      group = new THREE.Group();
      scene.background = new THREE.Color(spec.colors.bg);

      const poly = spec.poly;
      const xs = poly.map((p) => p[0]);
      const ys = poly.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const bw = maxX - minX, bh = maxY - minY;

      const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0] * M, p[1] * M)));
      const fg = new THREE.ShapeGeometry(shape);
      fg.rotateX(-Math.PI / 2);
      const fTex = layoutTexture({
        wmm: bw, hmm: bh,
        polys: spec.floor.polys.map((p) => ({ full: p.full, pts: p.pts.map((q) => [q[0] - minX, q[1] - minY]) })),
        colors: { tile: spec.colors.floorTile, cut: spec.colors.cutTile, grout: spec.colors.grout },
        flipCanvas: true
      });
      fTex.repeat.set(1 / (bw * M), 1 / (bh * M));
      fTex.offset.set(-(minX * M) / (bw * M), -(minY * M) / (bh * M));
      group.add(new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: fTex, side: THREE.DoubleSide })));

      const H = spec.H * M;

      spec.walls.forEach((w) => {
        const a = new THREE.Vector3(w.a[0] * M, 0, -w.a[1] * M);
        const b = new THREE.Vector3(w.b[0] * M, 0, -w.b[1] * M);
        const len = a.distanceTo(b);
        const sh = new THREE.Shape([
          new THREE.Vector2(0, 0), new THREE.Vector2(len, 0),
          new THREE.Vector2(len, H), new THREE.Vector2(0, H)
        ]);
        (w.op || []).forEach((o) => {
          const x0 = o.off * M, x1 = (o.off + o.w) * M;
          const y0 = o.sill * M, y1 = (o.sill + o.h) * M;
          sh.holes.push(new THREE.Path([
            new THREE.Vector2(x0, y0), new THREE.Vector2(x0, y1),
            new THREE.Vector2(x1, y1), new THREE.Vector2(x1, y0)
          ]));
        });
        const geo = new THREE.ShapeGeometry(sh);
        const X = b.clone().sub(a).normalize();
        const Y = new THREE.Vector3(0, 1, 0);
        const Z = X.clone().cross(Y);
        geo.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(a));

        const tex = layoutTexture({
          wmm: w.len, hmm: spec.H, polys: w.polys,
          colors: { tile: spec.colors.wallTile, cut: spec.colors.cutTile, grout: spec.colors.grout },
          flipCanvas: true
        });
        tex.repeat.set(1 / (w.len * M), 1 / (spec.H * M));
        // BackSide keeps the near walls from hiding the room interior.
        group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.BackSide })));
      });

      scene.add(group);

      const cx = ((minX + maxX) / 2) * M;
      const cz = -((minY + maxY) / 2) * M;
      const span = Math.max(bw, bh) * M;
      controls.target.set(cx, H * 0.3, cz);
      if (!update._framed) {
        camera.position.set(cx + span * 0.7, H * 1.9, cz + span * 0.85);
        update._framed = true;
      }
      controls.update();
    }

    function loop() {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    }
    resize();
    loop();

    return {
      update,
      dispose() {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        clear();
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }

  window.createRoomView = createRoomView;
})();
