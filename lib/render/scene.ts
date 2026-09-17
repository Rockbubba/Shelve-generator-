/**
 * three.js-scene: fysiek gebaseerde materialen (MeshStandardMaterial) met
 * een neutrale studio-omgeving als omgevingslicht, ACES-tonemapping, één
 * schaduwwerpende zon met PCFSoft-schaduwen, edge lines op elk paneel en
 * render-on-demand (geen continue loop).
 *
 * Linksonder wordt een aanzichtenkubus meegerenderd (eigen mini-scene in
 * een scissor-viewport) die de oriëntatie van de camera volgt; een tik op
 * een vlak draait de camera geanimeerd naar dat aanzicht.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CabinetModel } from "../model";

/** Zijde van de aanzichtenkubus in CSS-pixels (incl. marge in de overlay). */
export const VIEW_CUBE_SIZE = 104;

/** Standaardaanzichten. De kast staat met de voorzijde naar wereld −Z. */
export type ViewName = "voor" | "achter" | "links" | "rechts" | "boven" | "onder" | "standaard";

/**
 * Kijkrichting per aanzicht als positie van de camera t.o.v. het doel
 * (genormaliseerd). Boven/onder krijgen een minieme kanteling naar voren
 * zodat de achterzijde van de kast bovenin het beeld komt en OrbitControls
 * een eenduidige draaihoek heeft.
 */
const VIEW_DIRECTIONS: Record<Exclude<ViewName, "standaard">, THREE.Vector3> = {
  voor: new THREE.Vector3(0, 0, -1),
  achter: new THREE.Vector3(0, 0, 1),
  links: new THREE.Vector3(1, 0, 0),
  rechts: new THREE.Vector3(-1, 0, 0),
  boven: new THREE.Vector3(0, 1, -0.002).normalize(),
  onder: new THREE.Vector3(0, -1, -0.002).normalize(),
};

/** Volgorde van BoxGeometry-materialen: +x, −x, +y, −y, +z, −z. */
const CUBE_FACE_VIEWS: Exclude<ViewName, "standaard">[] = [
  "links",
  "rechts",
  "boven",
  "onder",
  "achter",
  "voor",
];
const CUBE_FACE_LABELS: Record<Exclude<ViewName, "standaard">, string> = {
  voor: "Voor",
  achter: "Achter",
  links: "Links",
  rechts: "Rechts",
  boven: "Boven",
  onder: "Onder",
};

/** Alle levende scenes; de zichtbare (met afmeting) levert de snapshot. */
const liveScenes = new Set<CabinetScene>();

/** De scene die op dit moment zichtbaar is (mobiel of desktop), of null. */
export function activeScene(): CabinetScene | null {
  for (const s of liveScenes) if (s.isVisible()) return s;
  return null;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

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
  private cableMat: THREE.MeshBasicMaterial;
  private ledGlowMat: THREE.MeshBasicMaterial;
  private panelMatSelected: THREE.MeshStandardMaterial;
  private feetMat: THREE.MeshStandardMaterial;
  private panelMat: THREE.MeshStandardMaterial;
  private panelMatHdf: THREE.MeshStandardMaterial;
  private edgeMat: THREE.LineBasicMaterial;
  private dirLight: THREE.DirectionalLight;
  private ground: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private needsRender = true;
  private dampUntil = 0;
  /** Aanzichtenkubus: eigen scene, camera die de hoofdcamera volgt. */
  private cubeScene = new THREE.Scene();
  private cubeCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private cubeMesh: THREE.Mesh;
  private cubeFaceMats: THREE.MeshLambertMaterial[] = [];
  private cubeHover = -1;
  private cubeLight: THREE.DirectionalLight;
  /** Lopende camera-animatie naar een aanzicht (sferisch geïnterpoleerd). */
  private viewAnim: {
    start: number;
    duration: number;
    from: THREE.Spherical;
    to: THREE.Spherical;
  } | null = null;
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    // De achtergrond (zachte verloop) komt uit de CSS van de container; de
    // canvas zelf is transparant.
    this.renderer.setClearColor(0xffffff, 0);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    // Neutrale studio-omgeving als omgevingslicht: geeft zachte reflecties
    // en verloop op de vlakken, zodat wit MDF niet als plat papier oogt.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.feetMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.45,
      metalness: 0.4,
    });
    this.panelMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0,
    });
    this.panelMatHdf = new THREE.MeshStandardMaterial({
      color: 0xe8e4dc,
      roughness: 0.9,
      metalness: 0,
    });
    // Geselecteerde plank (bewerken in de indelingseditor).
    this.panelMatSelected = new THREE.MeshStandardMaterial({
      color: 0x93c5fd,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.12,
      roughness: 0.7,
      metalness: 0,
    });
    this.edgeMat = new THREE.LineBasicMaterial({
      color: 0x4b5563,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.ledMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
    // Kabelroute van de LED-verlichting: donkere lijn door de doorvoeren.
    // De kabelroute is een schematische overlay: altijd zichtbaar, ook waar
    // planken en staanders ervoor zitten, zodat de bedrading in één oogopslag
    // te volgen is.
    this.cableMat = new THREE.MeshBasicMaterial({
      color: 0xb45309,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    this.ledGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // Weggelaten planken: doorzichtig, aantikken zet ze terug.
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0x2563eb,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });

    // Zacht vullicht (lucht/vloer) naast de omgeving, plus één
    // schaduwwerpende zon van voren-boven, iets van links, zodat de vakken
    // van voren worden ingelicht en de schaduw naar rechtsachter valt.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d3cd, 0.35));
    this.dirLight = new THREE.DirectionalLight(0xfff7ec, 1.9);
    this.dirLight.position.set(-900, 2600, -1900);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(4096, 4096);
    // Scene staat in mm: bias in wereldeenheden, dus enkele mm normal-bias
    // tegen schaduw-acne op vlakken die evenwijdig aan het licht staan.
    this.dirLight.shadow.bias = -0.0002;
    this.dirLight.shadow.normalBias = 3;
    this.dirLight.shadow.radius = 3;
    this.scene.add(this.dirLight);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20000, 20000),
      new THREE.ShadowMaterial({ opacity: 0.17 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // Aanzichtenkubus.
    this.cubeMesh = this.buildViewCube();
    this.cubeScene.add(this.cubeMesh);
    this.cubeScene.add(new THREE.HemisphereLight(0xffffff, 0xd1d5db, 2.2));
    this.cubeLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.cubeScene.add(this.cubeLight);

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
    liveScenes.add(this);
    this.tick();
  }

  isVisible(): boolean {
    return !this.disposed && this.container.clientWidth > 0 && this.container.clientHeight > 0;
  }

  /**
   * PNG (data-URL, transparante achtergrond) van de kast vanuit het
   * standaardaanzicht, vierkant `px` × `px`, zonder aanzichtenkubus. De
   * viewer wordt daarna weer in zijn oude staat gerenderd.
   */
  snapshot(px = 800): string | null {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0 || !this.cabinetGroup) return null;
    const savedPos = this.camera.position.clone();
    const savedAspect = this.camera.aspect;
    const savedRatio = this.renderer.getPixelRatio();
    try {
      const dist = (this.lastMaxDim || 1000) * 2.65;
      this.camera.position.copy(this.defaultDirection()).multiplyScalar(dist).add(this.controls.target);
      this.camera.lookAt(this.controls.target);
      this.camera.aspect = 1;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(px, px, false);
      this.renderer.setViewport(0, 0, px, px);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL("image/png");
    } catch {
      return null;
    } finally {
      this.renderer.setPixelRatio(savedRatio);
      this.renderer.setSize(w, h);
      this.camera.position.copy(savedPos);
      this.camera.aspect = savedAspect;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.controls.target);
      this.controls.update();
      this.requestRender();
    }
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

  /** Kubus met zes gelabelde vlakken (canvas-texturen) en donkere ribben. */
  private buildViewCube(): THREE.Mesh {
    const mats = CUBE_FACE_VIEWS.map((view) => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = "#9ca3af";
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 250, 250);
      ctx.fillStyle = "#1f2937";
      ctx.font = "600 56px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(CUBE_FACE_LABELS[view], 128, 134);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      if (view === "boven") {
        // Bovenvlak: standaard staat de tekst met "boven" naar −Z (de
        // voorzijde); vanaf de voorkant gezien is dat op zijn kop.
        tex.center.set(0.5, 0.5);
        tex.rotation = Math.PI;
      }
      // Buiten de tonemapping, zodat de vlakken echt wit blijven.
      return new THREE.MeshLambertMaterial({ map: tex, toneMapped: false });
    });
    this.cubeFaceMats = mats;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geo, mats);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x374151, toneMapped: false }),
    );
    mesh.add(edges);
    return mesh;
  }

  /** Overlay-element dat bepaalt waar de kubus in de container staat. */
  private cubeElement: HTMLElement | null = null;

  setCubeElement(el: HTMLElement | null) {
    this.cubeElement = el;
    this.requestRender();
  }

  /** Hoek linksonder (CSS-px, y omhoog) van de kubus-viewport in de container. */
  private cubeViewport(): { x: number; y: number; size: number } {
    if (!this.cubeElement) return { x: 0, y: 0, size: VIEW_CUBE_SIZE };
    const c = this.container.getBoundingClientRect();
    const r = this.cubeElement.getBoundingClientRect();
    return { x: r.left - c.left, y: c.bottom - r.bottom, size: r.width };
  }

  /**
   * Welk kubusvlak ligt onder een punt in de kubus-overlay? `nx`, `ny` in
   * genormaliseerde coördinaten (−1…1, y omhoog) van de overlay.
   */
  private pickCubeFace(nx: number, ny: number): number {
    this.syncCubeCamera();
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.cubeCamera);
    const hits = this.raycaster.intersectObject(this.cubeMesh, false);
    if (hits.length === 0 || hits[0].face === null || hits[0].face === undefined) return -1;
    return hits[0].face.materialIndex;
  }

  /** Overlay meldt pointerbewegingen; hover licht het vlak op. */
  cubeHoverAt(nx: number, ny: number) {
    const idx = this.pickCubeFace(nx, ny);
    if (idx === this.cubeHover) return;
    this.cubeHover = idx;
    this.cubeFaceMats.forEach((m, i) => m.color.set(i === idx ? 0xbfdbfe : 0xffffff));
    this.requestRender();
  }

  cubeHoverEnd() {
    this.cubeHoverAt(NaN, NaN);
  }

  /** Tik op de overlay: vlak → aanzicht. Geeft het gekozen aanzicht terug. */
  cubeTapAt(nx: number, ny: number): ViewName | null {
    const idx = this.pickCubeFace(nx, ny);
    if (idx < 0) return null;
    const view = CUBE_FACE_VIEWS[idx];
    this.setView(view);
    return view;
  }

  /** Kijkrichting van het standaardaanzicht (schuin van voren, iets rechts). */
  private defaultDirection(): THREE.Vector3 {
    return new THREE.Vector3(-0.6, 0.28, -0.78).normalize();
  }

  /**
   * Draai de camera geanimeerd naar een aanzicht; de afstand tot het doel
   * blijft gelijk, zodat in- en uitzoomen bewaard blijft.
   */
  setView(view: ViewName, duration = 450) {
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const from = new THREE.Spherical().setFromVector3(offset);
    const dir = view === "standaard" ? this.defaultDirection() : VIEW_DIRECTIONS[view];
    const to = new THREE.Spherical().setFromVector3(dir.clone().multiplyScalar(offset.length()));
    to.makeSafe();
    // Kortste draai om de verticale as.
    let dTheta = to.theta - from.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    to.theta = from.theta + dTheta;
    if (duration <= 0) {
      this.applySpherical(to);
      this.viewAnim = null;
    } else {
      this.viewAnim = { start: performance.now(), duration, from, to };
    }
    this.requestRender();
  }

  private applySpherical(sph: THREE.Spherical) {
    const pos = new THREE.Vector3().setFromSpherical(sph).add(this.controls.target);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  private stepViewAnim(now: number): boolean {
    const a = this.viewAnim;
    if (!a) return false;
    const t = Math.min(1, (now - a.start) / a.duration);
    const k = easeInOut(t);
    const sph = new THREE.Spherical(
      a.from.radius + (a.to.radius - a.from.radius) * k,
      a.from.phi + (a.to.phi - a.from.phi) * k,
      a.from.theta + (a.to.theta - a.from.theta) * k,
    );
    this.applySpherical(sph);
    if (t >= 1) this.viewAnim = null;
    return true;
  }

  /** Kubuscamera kijkt uit dezelfde richting als de hoofdcamera. */
  private syncCubeCamera() {
    this.cubeCamera.quaternion.copy(this.camera.quaternion);
    this.cubeCamera.position
      .set(0, 0, 1)
      .applyQuaternion(this.camera.quaternion)
      .multiplyScalar(3.8);
    this.cubeCamera.updateMatrixWorld();
    this.cubeLight.position.copy(this.cubeCamera.position).add(new THREE.Vector3(1, 2, 0));
  }

  private renderViewCube() {
    const h = this.container.clientHeight;
    const { x, y, size } = this.cubeViewport();
    if (h <= 0 || size <= 0) return;
    this.syncCubeCamera();
    this.renderer.clearDepth();
    this.renderer.setScissorTest(true);
    this.renderer.setViewport(x, y, size, size);
    this.renderer.setScissor(x, y, size, size);
    this.renderer.render(this.cubeScene, this.cubeCamera);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.container.clientWidth, h);
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

    // Kleuren uit de configuratie (materialen worden hergebruikt). De ruwheid
    // volgt het plaatmateriaal: gespoten MDF is mat, multiplex met blanke lak
    // iets glanzender, betonplex (fenolfilm) duidelijk glanzend.
    this.panelMat.color.set(model.config.color);
    this.panelMat.roughness =
      model.config.materialId === "betonplex" ? 0.35 : model.config.materialId === "multiplex" ? 0.65 : 0.8;
    this.panelMatHdf.color.set(model.config.rugColor);
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
        (p.staanderKey && p.staanderKey === selectedShelfKey) ||
        (p.dividerKey && p.dividerKey === selectedShelfKey);
      const mat =
        selected
          ? this.panelMatSelected
          : p.material === "hdf4"
            ? this.panelMatHdf
            : this.panelMat;
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
      if (p.dividerKey) {
        mesh.userData.shelfKey = p.dividerKey;
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

    // Kabelroute: verticaal per kolom door de plankdoorvoeren, horizontaal
    // door de binnenstaanders en omlaag naar de driver in de plint.
    for (const route of model.ledRoutes) {
      for (let i = 1; i < route.length; i++) {
        const a = new THREE.Vector3(off.x + route[i - 1][0], off.y + route[i - 1][1], off.z + route[i - 1][2]);
        const b = new THREE.Vector3(off.x + route[i][0], off.y + route[i][1], off.z + route[i][2]);
        if (a.distanceTo(b) < 1) continue;
        // De route is asgericht, dus een balk per segment volstaat. De dikte
        // schaalt met de kastmaat zodat de streng ook bij een grote kast
        // zichtbaar blijft (schematisch, niet op ware kabeldikte).
        const r = Math.max(6, Math.max(W, H, D) / 220);
        const min = new THREE.Vector3(
          Math.min(a.x, b.x),
          Math.min(a.y, b.y),
          Math.min(a.z, b.z),
        );
        const max = new THREE.Vector3(
          Math.max(a.x, b.x),
          Math.max(a.y, b.y),
          Math.max(a.z, b.z),
        );
        const geo = new THREE.BoxGeometry(
          Math.max(max.x - min.x, r),
          Math.max(max.y - min.y, r),
          Math.max(max.z - min.z, r),
        );
        const mesh = new THREE.Mesh(geo, this.cableMat);
        mesh.position.copy(min).add(max).multiplyScalar(0.5);
        mesh.renderOrder = 999;
        group.add(mesh);
      }
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

    // Schaduwcamera strak om de kast (incl. slagschaduw op de vloer) zodat
    // de 4096-map maximale resolutie geeft; camera-afstand op de kastmaat.
    const maxDim = Math.max(W, H, D);
    const s = Math.max(W, H) * 0.8 + D;
    const cam = this.dirLight.shadow.camera as THREE.OrthographicCamera;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 100;
    cam.far = 12000;
    cam.updateProjectionMatrix();
    this.dirLight.target.position.set(0, H / 2, 0);
    this.scene.add(this.dirLight.target);
    // Lichtafstand meeschalen zodat de zon altijd buiten de kast staat.
    this.dirLight.position.set(-0.45 * maxDim - 300, 1.3 * maxDim + 800, -0.95 * maxDim - 600);

    if (Math.abs(maxDim - this.lastMaxDim) / (this.lastMaxDim || 1) > 0.2) {
      const dist = maxDim * 2.65;
      this.controls.target.set(0, H / 2, 0);
      this.camera.position.copy(this.defaultDirection()).multiplyScalar(dist).add(this.controls.target);
      this.controls.update();
      this.viewAnim = null;
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
    const now = performance.now();
    const animating = this.stepViewAnim(now);
    const damping = !animating && now < this.dampUntil;
    if (damping) this.controls.update();
    if (this.needsRender || damping || animating) {
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderViewCube();
      this.needsRender = false;
    }
  };

  dispose() {
    this.disposed = true;
    liveScenes.delete(this);
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
    this.cubeFaceMats.forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
