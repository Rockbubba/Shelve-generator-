/**
 * three.js-scene in palletstijl: witte achtergrond, MeshToonMaterial met
 * 2-staps gradient map, edge lines op elk paneel, PCFSoft-schaduwen en
 * render-on-demand (geen continue loop).
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CabinetModel } from "../model";

export class CabinetScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private cabinetGroup: THREE.Group | null = null;
  private cellProxies: THREE.Mesh[] = [];
  private shelfTargets: THREE.Mesh[] = [];
  private ghostMat: THREE.MeshBasicMaterial;
  private ledMat: THREE.MeshBasicMaterial;
  private ledGlowMat: THREE.MeshBasicMaterial;
  private toonMatSelected: THREE.MeshToonMaterial;
  private feetMat: THREE.MeshToonMaterial;
  private gradTex: THREE.CanvasTexture;
  private toonMat: THREE.MeshToonMaterial;
  private toonMatHdf: THREE.MeshToonMaterial;
  private edgeMat: THREE.LineBasicMaterial;
  private dirLight: THREE.DirectionalLight;
  private ground: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private needsRender = true;
  private dampUntil = 0;
  private rafId = 0;
  private lastMaxDim = 0;
  private pointerDown: { x: number; y: number } | null = null;
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private onCellTap: (cellKey: string) => void,
    private onShelfTap: (shelfKey: string) => void = () => {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);

    // 2-staps toon gradient via canvas.
    const gradCanvas = document.createElement("canvas");
    gradCanvas.width = 2;
    gradCanvas.height = 1;
    const gCtx = gradCanvas.getContext("2d")!;
    gCtx.fillStyle = "#383838";
    gCtx.fillRect(0, 0, 1, 1);
    gCtx.fillStyle = "#ffffff";
    gCtx.fillRect(1, 0, 1, 1);
    const gradTex = new THREE.CanvasTexture(gradCanvas);
    gradTex.minFilter = THREE.NearestFilter;
    gradTex.magFilter = THREE.NearestFilter;
    this.gradTex = gradTex;
    this.feetMat = new THREE.MeshToonMaterial({ color: 0x222222, gradientMap: gradTex });

    this.toonMat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      gradientMap: gradTex,
    });
    this.toonMatHdf = new THREE.MeshToonMaterial({
      color: 0xe8e4dc,
      gradientMap: gradTex,
    });
    // Geselecteerde plank (bewerken in de indelingseditor).
    this.toonMatSelected = new THREE.MeshToonMaterial({
      color: 0x93c5fd,
      gradientMap: gradTex,
    });
    this.edgeMat = new THREE.LineBasicMaterial({
      color: 0x555555,
      depthWrite: false,
    });
    // Weggelaten planken: doorzichtig, aantikken zet ze terug.
    this.ledMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
    this.ledGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0x2563eb,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
    this.dirLight.position.set(-600, 1875, -300);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.bias = -0.003;
    this.dirLight.shadow.normalBias = 0.02;
    this.scene.add(this.dirLight);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20000, 20000),
      new THREE.ShadowMaterial({ opacity: 0.12 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.camera = new THREE.PerspectiveCamera(40, 1, 10, 30000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.controls.addEventListener("change", () => {
      this.dampUntil = performance.now() + 700;
      this.requestRender();
    });

    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY };
    });
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      if (!this.pointerDown) return;
      const dx = e.clientX - this.pointerDown.x;
      const dy = e.clientY - this.pointerDown.y;
      this.pointerDown = null;
      if (dx * dx + dy * dy > 36) return; // sleep, geen tik
      this.handleTap(e);
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.tick();
  }

  private handleTap(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    // Planken (echte en ghost) en vak-volumes samen; het dichtstbijzijnde wint.
    const hits = this.raycaster.intersectObjects(
      [...this.shelfTargets, ...this.cellProxies],
      false,
    );
    if (hits.length === 0) return;
    const data = hits[0].object.userData;
    if (data.shelfKey) this.onShelfTap(data.shelfKey as string);
    else if (data.cellKey) this.onCellTap(data.cellKey as string);
  }

  /** Geometrie voor een paneel: doos, of extrusie van de vrije contour. */
  private panelGeometry(p: CabinetModel["panels"][number]): {
    geo: THREE.BufferGeometry;
    centered: boolean;
  } {
    if (!p.contour) {
      return {
        geo: new THREE.BoxGeometry(p.place.w, p.place.h, p.place.d),
        centered: true,
      };
    }
    if (p.type === "staander") {
      // Contour: u = hoogte, v = diepte; extruderen over de dikte (world x).
      const shape = new THREE.Shape();
      p.contour.forEach(([u, v], i) =>
        i === 0 ? shape.moveTo(u, v) : shape.lineTo(u, v),
      );
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: p.place.w,
        bevelEnabled: false,
      });
      // (u, v, e) → (e, u, v): X = dikte, Y = hoogte, Z = diepte (det +1).
      geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
      return { geo, centered: false };
    }
    // Plank: contour ligt in het (x, diepte)-vlak; extruderen over de dikte (y).
    const shape = new THREE.Shape();
    p.contour.forEach(([x, y], i) =>
      i === 0 ? shape.moveTo(x, -y) : shape.lineTo(x, -y),
    );
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: p.place.h,
      bevelEnabled: false,
    });
    // (x, y, z) → (x, z, -y): extrusie langs +y, shape-y (= -diepte) → +z.
    geo.rotateX(-Math.PI / 2);
    return { geo, centered: false };
  }

  updateModel(model: CabinetModel, selectedShelfKey: string | null = null) {
    if (this.cabinetGroup) {
      this.scene.remove(this.cabinetGroup);
      this.cabinetGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
        }
      });
    }
    this.cellProxies = [];
    this.shelfTargets = [];

    // Kleuren uit de configuratie (toon-materialen worden hergebruikt).
    this.toonMat.color.set(model.config.color);
    this.toonMatHdf.color.set(model.config.rugColor);
    this.feetMat.color.set(model.config.feet.color);

    const W = model.snappedWidth;
    const H = model.config.height;
    const D = model.config.depth;
    const group = new THREE.Group();

    // Kast gecentreerd op de origin (x/z); onderkant op de vloer (y = 0).
    // De groep is 180° gedraaid zodat de voorzijde naar het licht wijst en
    // de witte toon-stap krijgt.
    group.rotation.y = Math.PI;
    const off = new THREE.Vector3(-W / 2, 0, -D / 2);

    for (const p of model.panels) {
      const { geo, centered } = this.panelGeometry(p);
      const selected =
        (p.shelfKey && p.shelfKey === selectedShelfKey) ||
        (p.staanderKey && p.staanderKey === selectedShelfKey);
      const mat =
        selected
          ? this.toonMatSelected
          : p.material === "hdf4"
            ? this.toonMatHdf
            : this.toonMat;
      const mesh = new THREE.Mesh(geo, mat);
      if (centered) {
        mesh.position.set(
          off.x + p.place.x + p.place.w / 2,
          off.y + p.place.y + p.place.h / 2,
          off.z + p.place.z + p.place.d / 2,
        );
      } else {
        mesh.position.set(off.x + p.place.x, off.y + p.place.y, off.z + p.place.z);
      }
      if (p.yaw) mesh.rotation.y = p.yaw;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (p.shelfKey) {
        mesh.userData.shelfKey = p.shelfKey;
        this.shelfTargets.push(mesh);
      }
      if (p.staanderKey) {
        mesh.userData.shelfKey = p.staanderKey; // zelfde selectiekanaal
        this.shelfTargets.push(mesh);
      }
      group.add(mesh);

      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.edgeMat);
      edges.position.copy(mesh.position);
      edges.rotation.copy(mesh.rotation);
      group.add(edges);
    }

    // Pootjes.
    for (const f of model.feet) {
      const geo =
        f.type === "vierkant"
          ? new THREE.BoxGeometry(f.place.w, f.place.h, f.place.d)
          : new THREE.CylinderGeometry(
              f.place.w / 2,
              f.type === "conisch" ? f.place.w * 0.3 : f.place.w / 2,
              f.place.h,
              24,
            );
      const mesh = new THREE.Mesh(geo, this.feetMat);
      mesh.position.set(
        off.x + f.place.x + f.place.w / 2,
        off.y + f.place.y + f.place.h / 2,
        off.z + f.place.z + f.place.d / 2,
      );
      mesh.castShadow = true;
      group.add(mesh);
      if (f.type === "vierkant") {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.edgeMat);
        edges.position.copy(mesh.position);
        group.add(edges);
      }
    }

    // Weggelaten planken als doorzichtige ghost (tik = terugzetten).
    // Alleen het voorste deel, zodat de ghost niet over een rugpaneel valt.
    for (const g of model.ghostShelves) {
      const gd = g.place.d * 0.4;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(g.place.w, g.place.h, gd),
        this.ghostMat,
      );
      mesh.position.set(
        off.x + g.place.x + g.place.w / 2,
        off.y + g.place.y + g.place.h / 2,
        off.z + g.place.z + g.place.d - gd / 2,
      );
      mesh.userData.shelfKey = g.key;
      group.add(mesh);
      this.shelfTargets.push(mesh);
    }

    // LED-strips: lichtgevende strip achter-boven in elk vak, met een zachte
    // gloed over de achterwand van het vak.
    for (const cell of model.cells) {
      if (!cell.led) continue;
      const len = Math.max(0, cell.w - 60);
      if (len <= 0) continue;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 4, 10), this.ledMat);
      strip.position.set(
        off.x + cell.x + cell.w / 2,
        off.y + cell.y + cell.h - 2,
        off.z + cell.z + 28,
      );
      group.add(strip);
      const glowH = Math.min(cell.h * 0.6, 260);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(len, glowH), this.ledGlowMat);
      glow.position.set(
        off.x + cell.x + cell.w / 2,
        off.y + cell.y + cell.h - glowH / 2 - 4,
        off.z + cell.z + 6,
      );
      group.add(glow);
    }

    // Onzichtbare vak-volumes voor rug-toggles: alleen de achterste helft
    // van het vak, zodat planken (en ghost-planken) vóór het volume raakbaar
    // blijven en een tik "op de rug" het rugpaneel schakelt.
    for (const cell of model.cells) {
      const depth = cell.d * 0.55;
      const geo = new THREE.BoxGeometry(cell.w, cell.h, depth);
      const proxy = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      proxy.position.set(
        off.x + cell.x + cell.w / 2,
        off.y + cell.y + cell.h / 2,
        off.z + cell.z + depth / 2,
      );
      proxy.userData.cellKey = cell.key;
      group.add(proxy);
      this.cellProxies.push(proxy);
    }

    this.scene.add(group);
    this.cabinetGroup = group;

    // Schaduwcamera en camera-afstand op de kastmaat afstemmen.
    const maxDim = Math.max(W, H, D);
    const s = maxDim * 1.2;
    const cam = this.dirLight.shadow.camera as THREE.OrthographicCamera;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 100;
    cam.far = 8000;
    cam.updateProjectionMatrix();
    this.dirLight.target.position.set(0, H / 2, 0);
    this.scene.add(this.dirLight.target);

    if (Math.abs(maxDim - this.lastMaxDim) / (this.lastMaxDim || 1) > 0.2) {
      const dist = maxDim * 2.65;
      this.camera.position.set(-dist * 0.6, H * 0.55 + dist * 0.28, -dist * 0.78);
      this.controls.target.set(0, H / 2, 0);
      this.controls.update();
      this.lastMaxDim = maxDim;
    }

    this.requestRender();
  }

  requestRender() {
    this.needsRender = true;
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private tick = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.tick);
    const damping = performance.now() < this.dampUntil;
    if (damping) this.controls.update();
    if (this.needsRender || damping) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    if (this.cabinetGroup) {
      this.cabinetGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
        }
      });
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
