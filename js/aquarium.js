import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import {
  SPECIES_LIST,
  getSpeciesMeta,
  buildCreatureMesh,
  animateCreatureMesh,
  generateHandColoredCanvas,
  preloadCustomCreatureAssets
} from './creatures.js';
import {
  fetchInitialFishes,
  initLiveChannel,
  resetAllFishesInSupabase,
  deleteSingleFishInSupabase,
  getActiveRoomCode,
  normalizeRoomCode,
  generateRandomRoomCode,
  buildPageUrlWithRoom,
  registerOrFetchTank
} from './supabase-api.js';
import { makeQrPngDataUrl } from './qr.js';
import { ENVIRONMENT_CONFIG } from './environment-config.js';

// ============================================================================
// WEB AUDIO SYNTHESIZER (SPLASH, BUBBLES, CHIME, SHARK THEME - ZERO EXTERNAL MP3S)
// ============================================================================

class OceanAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  ensure() {
    if (this.muted) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playSplashArrival() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Water splash filtered noise burst
    const bufSize = ctx.sampleRate * 0.65;
    const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const out = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      out[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.18));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(950, now);
    filter.frequency.exponentialRampToValueAtTime(280, now + 0.6);
    filter.Q.value = 1.6;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.32, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
    noise.connect(filter).connect(nGain).connect(ctx.destination);
    noise.start(now);

    // Magical ascending arpeggio chime!
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      const t = now + 0.08 + idx * 0.085;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.65);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.7);
    });
  }

  playPop() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.11);
    g.gain.setValueAtTime(0.12, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  playSharkAlert() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    [130.81, 138.59, 130.81, 138.59].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      const t = now + i * 0.28;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }
}

// ============================================================================
// MAIN 3D DIGITAL AQUARIUM ENGINE
// ============================================================================

const TANK_BOUNDS = { x: 13.5, yMin: -4.6, yMax: 5.2, zMin: -7.5, zMax: 4.5 };

const STARTER_FISH_SPECS = [
  { id: 'demo-1', name: 'Kasun', species: 'clownfish', palette: ['#ff6b1a', '#ff8c42', '#ff4d00', '#ffffff'], isDemo: true },
  { id: 'demo-2', name: 'Kavindu', species: 'angelfish', palette: ['#00bbf9', '#fee440', '#ff9f1c', '#ffffff'], isDemo: true },
  { id: 'demo-3', name: 'Nethmi', species: 'bluetang', palette: ['#0077b6', '#00b4d8', '#48cae4', '#ffffff'], isDemo: true },
  { id: 'demo-4', name: 'Amaya', species: 'seahorse', palette: ['#ff9f1c', '#ffd166', '#2ec4b6', '#ff5d8f'], isDemo: true },
  { id: 'demo-5', name: 'Sahan', species: 'starfish', palette: ['#ff6b35', '#ffbe0b', '#fb5607', '#ffffff'], isDemo: true },
  { id: 'demo-6', name: 'Kani', species: 'crab', palette: ['#ff6b35', '#ffbe0b', '#fb5607', '#ffffff'], isDemo: true }
];

class DigitalAquariumApp {
  constructor() {
    this.container = document.getElementById('aquarium-canvas-wrap');
    this.audio = new OceanAudio();
    this.creatures = new Map(); // id -> creatureActor
    this.foodPellets = [];
    this.splashBursts = [];
    this.kelpBlades = [];
    this.godRays = [];
    this.gltfLoader = new GLTFLoader();
    this.gltfMixers = [];
    this.envTemplateCache = new Map();
    this.plantSwayUniform = { value: 0 };
    this.customEnvGroup = null;
    this.showLabels = true;
    this.showDemoFish = localStorage.getItem('aquarium_show_demo') !== '0';
    this.inspectedActorId = null;
    this.sharkActor = null;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.initScene();
    this.buildEnvironment();
    this.loadCustomModelsFromConfig();
    this.initUI();
    this.loadInitialFishes();
    this.connectRealtime();
    this.animate();
  }

  initScene() {
    this.scene = new THREE.Scene();
    // The tank is drawn as a SECOND pass on top of the parallax backdrop scene,
    // so this scene must never clear / paint its own background.
    this.scene.background = null;
    // Fog is tinted to the painted backdrop's mid-ocean blue so distant 3D
    // rocks/plants melt into the background instead of going navy-dark.
    this.scene.fog = new THREE.FogExp2(0x0a5b8c, 0.026);

    this.bgTextureLoader = new THREE.TextureLoader();
    this.backdropScene = null;
    this.backdropRig = null;
    this.backdropLayers = [];
    this.backdropPhotoLayer = null;
    this.backdropHomePos = null;
    this._bdDelta = new THREE.Vector3();
    this._bdRight = new THREE.Vector3();
    this._bdUp = new THREE.Vector3();

    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 120);
    this.camera.position.set(0, 0.7, 16.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxDistance = 25;
    this.controls.minDistance = 7;
    this.controls.maxPolarAngle = Math.PI * 0.56;
    this.controls.minPolarAngle = Math.PI * 0.32;
    this.controls.minAzimuthAngle = -0.55;
    this.controls.maxAzimuthAngle = 0.55;
    this.controls.target.set(0, -0.3, 0);

    // Rich Underwater Lighting
    const hemi = new THREE.HemisphereLight(0x6be6ff, 0x0b2545, 1.35);
    this.scene.add(hemi);

    const sunLight = new THREE.DirectionalLight(0xa8f5ff, 1.65);
    sunLight.position.set(4, 16, 8);
    this.scene.add(sunLight);

    const frontFill = new THREE.DirectionalLight(0xffffff, 0.65);
    frontFill.position.set(0, 2, 16);
    this.scene.add(frontFill);

    const reefGlowL = new THREE.PointLight(0x52f2d6, 2.0, 18);
    reefGlowL.position.set(-9.5, -2.5, -1.5);
    const reefGlowR = new THREE.PointLight(0x64d8ff, 2.0, 18);
    reefGlowR.position.set(9.5, -2.5, -1.5);
    this.scene.add(reefGlowL, reefGlowR);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.layoutBackdropLayers();
    });

    // Click tank to inspect creature OR drop fish food pellets!
    let downPos = { x: 0, y: 0 };
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      downPos = { x: e.clientX, y: e.clientY };
      this.audio.ensure();
    });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 8) return;
      this.handleTankTap(e);
    });

    // Parallax underwater backdrop (photo + painted silhouettes)
    this.buildParallaxBackdrop();
  }

  // ==========================================================================
  // PARALLAX UNDERWATER BACKDROP  •  assets/underwater-bg.jpg + painted layers
  // ==========================================================================
  // Four camera-locked layers are rendered BEFORE the tank (a second render
  // pass), so they always sit behind every fish, rock and plant:
  //
  //   gradient   (far)   painted water gradient  -> instant paint + fallback
  //   photo      (far)   assets/underwater-bg.jpg -> the artwork itself
  //   midground  (mid)   painted distant rock & kelp silhouettes
  //   foreground (near)  dark, soft kelp framing the left/right edges
  //
  // Every layer slides by a different amount while the visitor orbits the
  // tank, which creates real depth (parallax) instead of a flat poster.
  buildParallaxBackdrop() {
    this.backdropScene = new THREE.Scene();
    this.backdropScene.background = new THREE.Color(0x062c52);

    // Layers are children of the camera, so they always fill the frame.
    this.backdropRig = new THREE.Group();
    this.backdropRig.name = 'parallax-backdrop-rig';
    this.camera.add(this.backdropRig);
    this.backdropScene.add(this.camera);
    this.backdropHomePos = this.camera.position.clone();

    // 1. Painted deep-water gradient (instant paint + graceful fallback)
    this.addBackdropLayer({
      name: 'backdrop-gradient',
      dist: 90,
      virtualDepth: 900,
      map: this.createBackdropGradientTexture(),
      stretch: true,
      margin: 1.04,
      renderOrder: 0
    });

    // 2. The underwater artwork itself (fades in once decoded)
    this.backdropPhotoLayer = this.addBackdropLayer({
      name: 'backdrop-photo',
      dist: 60,
      virtualDepth: 260,
      opacity: 0,
      margin: 1.12,
      renderOrder: 1
    });

    // 3. Painted mid-ground silhouettes (distant rocks, kelp, coral)
    this.addBackdropLayer({
      name: 'backdrop-midground',
      dist: 34,
      virtualDepth: 62,
      map: this.createMidgroundSilhouetteTexture(),
      stretch: true,
      margin: 1.22,
      renderOrder: 2
    });

    // 4. Near foreground kelp framing the edges — strongest parallax
    this.addBackdropLayer({
      name: 'backdrop-foreground',
      dist: 16,
      virtualDepth: 40,
      map: this.createForegroundKelpTexture(),
      opacity: 0.8,
      stretch: true,
      margin: 1.0,
      renderOrder: 3
    });

    this.layoutBackdropLayers();
    this.loadBackdropPhoto();
  }

  addBackdropLayer({ name, dist, virtualDepth, map = null, opacity = 1, stretch = false, margin = 1.3, renderOrder = 0 }) {
    const material = new THREE.MeshBasicMaterial({
      map,
      color: 0xffffff,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.name = name;
    mesh.position.set(0, 0, -dist);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    this.backdropRig.add(mesh);

    const layer = { name, mesh, dist, virtualDepth, margin, stretch, imageAspect: null, fadeIn: false };
    this.backdropLayers.push(layer);
    return layer;
  }

  // Size every layer so it covers the current viewport at its own distance.
  layoutBackdropLayers() {
    if (!this.backdropLayers || !this.backdropLayers.length || !this.camera) return;

    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = this.camera.aspect || window.innerWidth / window.innerHeight;

    for (const layer of this.backdropLayers) {
      const viewHeight = 2 * Math.tan(vFov / 2) * layer.dist;
      const viewWidth = viewHeight * aspect;

      if (layer.stretch || !layer.imageAspect) {
        // Soft painted layers just fill the frame (stretching is invisible).
        layer.mesh.scale.set(viewWidth * layer.margin, viewHeight * layer.margin, 1);
      } else {
        // The photo keeps its own aspect ratio while covering the viewport
        // (same idea as CSS `background-size: cover`).
        const k = Math.max((viewWidth * layer.margin) / layer.imageAspect, viewHeight * layer.margin);
        layer.mesh.scale.set(layer.imageAspect * k, k, 1);
      }
    }
  }

  // Slide each layer a different fraction of the camera movement -> parallax.
  updateBackdropParallax(dt) {
    if (!this.backdropRig || !this.backdropLayers.length || !this.backdropHomePos) return;

    const cam = this.camera;
    cam.updateMatrixWorld();
    this._bdDelta.copy(cam.position).sub(this.backdropHomePos);
    this._bdRight.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    this._bdUp.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const dx = this._bdDelta.dot(this._bdRight);
    const dy = this._bdDelta.dot(this._bdUp);

    for (const layer of this.backdropLayers) {
      // Nearer layers move more; far layers barely drift.
      const k = layer.dist / layer.virtualDepth;
      layer.mesh.position.x = -dx * k;
      layer.mesh.position.y = -dy * k;

      if (layer.fadeIn) {
        const mat = layer.mesh.material;
        mat.opacity = Math.min(1, mat.opacity + dt * 0.9);
        if (mat.opacity >= 1) layer.fadeIn = false;
      }
    }
  }

  loadBackdropPhoto() {
    const tryLoad = (urls) => {
      const url = urls.shift();
      if (!url) return;

      this.bgTextureLoader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          const layer = this.backdropPhotoLayer;
          if (!layer) return;

          const img = tex.image || {};
          layer.mesh.material.map = tex;
          layer.mesh.material.opacity = 0;
          layer.mesh.material.needsUpdate = true;
          layer.imageAspect = img.width && img.height ? img.width / img.height : 16 / 9;
          layer.fadeIn = true;
          this.layoutBackdropLayers();
        },
        undefined,
        () => {
          // JPG missing -> PNG fallback -> painted gradient stays visible.
          tryLoad(urls);
        }
      );
    };

    tryLoad(['./assets/underwater-bg.jpg', './assets/underwater-bg.png']);
  }

  // --------------------------------------------------------------------------
  // Procedural painted textures for the parallax layers
  // --------------------------------------------------------------------------
  createBackdropGradientTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, '#1696c8');
    grad.addColorStop(0.28, '#0a5b8c');
    grad.addColorStop(0.68, '#052c54');
    grad.addColorStop(1.0, '#021329');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 512);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  makeSeededRandom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  blurCanvasTexture(sourceCanvas, radius) {
    let out = sourceCanvas;
    try {
      const blurred = document.createElement('canvas');
      blurred.width = sourceCanvas.width;
      blurred.height = sourceCanvas.height;
      const ctx = blurred.getContext('2d');
      ctx.filter = `blur(${radius}px)`;
      ctx.drawImage(sourceCanvas, 0, 0);
      out = blurred;
    } catch (e) {
      out = sourceCanvas;
    }
    const tex = new THREE.CanvasTexture(out);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // A single soft, wavy plant blade (silhouette used for the painted layers).
  drawSilhouetteKelp(ctx, x, baseY, height, width, color, phase, lean) {
    const left = [];
    const right = [];
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = baseY - height * t;
      // gentle S-curve so the blade looks like flowing kelp, not a stick
      const sway = Math.sin(t * 2.3 + phase) * width * 1.15 * t + lean * t * t;
      const halfW = Math.max(1.5, width * Math.pow(1 - t, 0.5));
      left.push([x + sway - halfW, y]);
      right.push([x + sway + halfW * 0.86, y]);
    }
    ctx.beginPath();
    left.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // A leafy plant cluster: a few broad blades fanning out of one spot.
  drawSilhouettePlantCluster(ctx, x, baseY, height, spread, color, rand, leafHalfWidth = 42, leafJitter = 18) {
    const blades = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < blades; i++) {
      const bladeHeight = height * (0.68 + rand() * 0.5);
      const bladeHalfWidth = leafHalfWidth * (0.7 + rand()) + rand() * leafJitter;
      this.drawSilhouetteKelp(
        ctx,
        x + (rand() - 0.5) * spread,
        baseY,
        bladeHeight,
        bladeHalfWidth,
        color,
        rand() * Math.PI * 2,
        (rand() - 0.5) * height * 0.28
      );
    }
  }

  createMidgroundSilhouetteTexture() {
    const W = 2048;
    const H = 768;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const rand = this.makeSeededRandom(20261116);

    // Hazy distant rock ridges
    const drawRidge = (baseY, amp, color, seed) => {
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 24) {
        const y =
          baseY -
          Math.sin(x * 0.0031 + seed) * amp * 0.55 -
          Math.sin(x * 0.0107 + seed * 2.3) * amp * 0.3 -
          Math.sin(x * 0.0203 + seed * 4.1) * amp * 0.15;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    drawRidge(H * 0.8, 95, 'rgba(24, 104, 142, 0.3)', 1.1);
    drawRidge(H * 0.89, 80, 'rgba(17, 82, 120, 0.38)', 3.3);
    drawRidge(H * 0.98, 60, 'rgba(12, 62, 96, 0.5)', 5.7);

    // Bluish, hazy planted background — reads as "deep in the tank"
    const haze = ['rgba(38, 132, 168, 0.34)', 'rgba(29, 112, 148, 0.4)', 'rgba(22, 92, 126, 0.46)'];
    for (let i = 0; i < 16; i++) {
      const x = W * (0.02 + 0.96 * (i / 15)) + (rand() - 0.5) * 80;
      this.drawSilhouettePlantCluster(ctx, x, H * 1.0, H * (0.42 + rand() * 0.2), 110, haze[i % 3], rand);
    }

    return this.blurCanvasTexture(canvas, 4);
  }

  createForegroundKelpTexture() {
    const W = 2048;
    const H = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const rand = this.makeSeededRandom(777123);
    const color = 'rgba(5, 38, 52, 0.9)';

    // Out-of-focus plants hugging the left & right edges only — the centre
    // stage stays clear for the fish. These slide the most while orbiting.
    const edgeSpots = [
      [W * 0.005, 1.0],
      [W * 0.055, 0.82],
      [W * 0.115, 0.66],
      [W * 0.995, 1.0],
      [W * 0.945, 0.82],
      [W * 0.885, 0.66]
    ];
    for (const [x, scale] of edgeSpots) {
      this.drawSilhouettePlantCluster(
        ctx,
        x,
        H * 1.03,
        H * 0.52 * scale,
        70,
        color,
        rand,
        34 * scale,
        16
      );
    }

    return this.blurCanvasTexture(canvas, 9);
  }

  buildEnvironment() {
    // 1. The deep-water backdrop now lives in its own parallax scene
    //    (see buildParallaxBackdrop) which is rendered behind the tank.


    // 2. Shimmering Water Surface above
    const surfGeom = new THREE.PlaneGeometry(60, 38, 36, 24);
    surfGeom.rotateX(Math.PI / 2);
    const surfMat = new THREE.MeshStandardMaterial({
      color: 0x5ce1e6,
      emissive: 0x168aad,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.36,
      roughness: 0.15,
      side: THREE.DoubleSide
    });
    this.waterSurface = new THREE.Mesh(surfGeom, surfMat);
    this.waterSurface.position.y = 7.2;
    this.scene.add(this.waterSurface);

    // 3. Animated Caustics Sandy Seabed
    this.causticsCanvas = document.createElement('canvas');
    this.causticsCanvas.width = 256;
    this.causticsCanvas.height = 256;
    this.causticsTexture = new THREE.CanvasTexture(this.causticsCanvas);
    this.causticsTexture.wrapS = THREE.RepeatWrapping;
    this.causticsTexture.wrapT = THREE.RepeatWrapping;
    this.causticsTexture.repeat.set(5, 3);
    this.updateCausticsCanvas(0);

    const floorGeom = new THREE.PlaneGeometry(54, 34, 64, 40);
    floorGeom.rotateX(-Math.PI / 2);
    const fPos = floorGeom.attributes.position;
    for (let i = 0; i < fPos.count; i++) {
      const x = fPos.getX(i);
      const z = fPos.getZ(i);
      const dune = Math.sin(x * 0.28) * 0.38 + Math.cos(z * 0.36) * 0.32 + (z < -4 ? (-z - 4) * 0.18 : 0);
      fPos.setY(i, dune);
    }
    floorGeom.computeVertexNormals();

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xd9be93,
      emissive: 0x38bdf8,
      emissiveMap: this.causticsTexture,
      emissiveIntensity: 0.32,
      roughness: 0.88
    });
    const seabed = new THREE.Mesh(floorGeom, floorMat);
    seabed.position.y = -5.6;
    seabed.visible = ENVIRONMENT_CONFIG.showBuiltInSandFloor !== false;
    this.defaultSandFloor = seabed;
    this.scene.add(seabed);

    // 4. Volumetric Sunlight God Rays
    const rayCanvas = document.createElement('canvas');
    rayCanvas.width = 64;
    rayCanvas.height = 256;
    const rctx = rayCanvas.getContext('2d');
    const rg = rctx.createLinearGradient(0, 0, 0, 256);
    rg.addColorStop(0, 'rgba(180, 248, 255, 0.28)');
    rg.addColorStop(0.55, 'rgba(110, 225, 250, 0.09)');
    rg.addColorStop(1, 'rgba(56, 189, 248, 0)');
    rctx.fillStyle = rg;
    rctx.fillRect(0, 0, 64, 256);
    const rayTex = new THREE.CanvasTexture(rayCanvas);

    for (let i = 0; i < 7; i++) {
      const topR = 0.7 + Math.random() * 0.7;
      const botR = 2.2 + Math.random() * 1.4;
      const rayGeom = new THREE.CylinderGeometry(topR, botR, 15, 16, 1, true);
      const rayMat = new THREE.MeshBasicMaterial({
        map: rayTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const ray = new THREE.Mesh(rayGeom, rayMat);
      ray.position.set(-12 + i * 4.2, 0.8, -3.5 - (i % 3) * 1.8);
      ray.rotation.z = -0.22 + (i % 2) * 0.08;
      this.scene.add(ray);
      this.godRays.push({ mesh: ray, baseX: ray.position.x, phase: i * 1.1 });
    }

    // 5. Lush 3D Coral Reef Clusters, Rocks & Swaying Kelp Forest
    this.buildCoralReefs();

    // 6. Rising Ambient 3D Bubbles + Floating Plankton
    this.buildAmbientBubbles();
  }

  updateCausticsCanvas(time) {
    const ctx = this.causticsCanvas.getContext('2d');
    ctx.fillStyle = '#031526';
    ctx.fillRect(0, 0, 256, 256);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(110, 235, 255, 0.28)';
    ctx.lineWidth = 3;

    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      const yBase = (i / 14) * 256;
      for (let x = 0; x <= 256; x += 16) {
        const y =
          (yBase +
            Math.sin(x * 0.05 + time * 1.8 + i) * 18 +
            Math.cos(x * 0.03 - time * 1.3 + i * 2) * 14 +
            256) %
          256;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    this.causticsTexture.needsUpdate = true;
  }

  buildCoralReefs() {
    this.defaultReefGroup = new THREE.Group();
    this.defaultReefGroup.visible = ENVIRONMENT_CONFIG.showBuiltInRocksAndCorals !== false;
    this.scene.add(this.defaultReefGroup);

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x334e68, roughness: 0.92, flatShading: true });
    const coralPalette = [0xff5d8f, 0xff85a1, 0xff9e00, 0x00f5d4, 0x9b5de5, 0xf15bb5, 0xfee440];

    const reefSpots = [
      [-10.5, -5.2, -2.5, 1.3],
      [-6.2, -5.3, -4.2, 1.0],
      [0.4, -5.5, -5.2, 1.4],
      [6.8, -5.3, -3.5, 1.15],
      [10.8, -5.1, -2.0, 1.25],
      [-12.2, -5.2, 1.2, 0.85],
      [12.2, -5.2, 1.0, 0.9]
    ];

    reefSpots.forEach(([rx, ry, rz, s], idx) => {
      const cluster = new THREE.Group();
      cluster.position.set(rx, ry, rz);

      // Base rocks
      for (let r = 0; r < 3; r++) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry((1.2 + r * 0.35) * s, 1), rockMat);
        rock.position.set((r - 1) * 0.9 * s, 0.2, (r % 2) * 0.6);
        rock.scale.set(1.3, 0.68, 1.1);
        rock.rotation.set(r, r * 1.2, 0);
        cluster.add(rock);
      }

      // Brain coral / glowing anemone dome
      const cColor1 = coralPalette[idx % coralPalette.length];
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.75 * s, 18, 14),
        new THREE.MeshStandardMaterial({
          color: cColor1,
          emissive: cColor1,
          emissiveIntensity: 0.18,
          roughness: 0.55
        })
      );
      dome.position.set(-0.3 * s, 0.65 * s, 0.3);
      dome.scale.set(1.1, 0.82, 1.1);
      cluster.add(dome);

      // Branching Staghorn Coral tubes
      const cColor2 = coralPalette[(idx + 2) % coralPalette.length];
      const branchMat = new THREE.MeshStandardMaterial({
        color: cColor2,
        emissive: cColor2,
        emissiveIntensity: 0.16,
        roughness: 0.45
      });
      for (let b = 0; b < 5; b++) {
        const h = (1.1 + (b % 3) * 0.45) * s;
        const cyl = new THREE.Mesh(new THREE.CapsuleGeometry(0.11 * s, h, 4, 8), branchMat);
        const ang = (b / 5) * Math.PI * 2;
        cyl.position.set(0.45 * s + Math.cos(ang) * 0.35, h * 0.5 + 0.3, Math.sin(ang) * 0.35);
        cyl.rotation.z = Math.cos(ang) * 0.38;
        cyl.rotation.x = Math.sin(ang) * 0.38;
        cluster.add(cyl);
      }

      this.defaultReefGroup.add(cluster);
    });

    // Swaying Kelp Seaweed Forest
    this.defaultKelpGroup = new THREE.Group();
    this.defaultKelpGroup.visible = ENVIRONMENT_CONFIG.showBuiltInKelpPlants !== false;
    this.scene.add(this.defaultKelpGroup);

    const kelpMat = new THREE.MeshStandardMaterial({
      color: 0x2ec4b6,
      emissive: 0x0b525b,
      emissiveIntensity: 0.25,
      roughness: 0.5,
      side: THREE.DoubleSide
    });

    const kelpLocations = [
      [-13.2, -2.5], [-12.6, -3.2], [-8.8, -5.2], [-3.5, -5.8],
      [3.8, -5.6], [9.2, -4.8], [13.0, -2.8], [12.4, -3.6]
    ];

    kelpLocations.forEach(([kx, kz], idx) => {
      for (let strand = 0; strand < 3; strand++) {
        const height = 3.2 + Math.random() * 2.6;
        const geom = new THREE.PlaneGeometry(0.32, height, 2, 14);
        geom.translate(0, height / 2, 0);
        const base = geom.attributes.position.array.slice();
        const mesh = new THREE.Mesh(geom, kelpMat);
        mesh.position.set(kx + (strand - 1) * 0.4, -5.6, kz + (strand % 2) * 0.35);
        mesh.rotation.y = strand * 0.8;
        this.defaultKelpGroup.add(mesh);
        this.kelpBlades.push({ mesh, base, height, phase: idx + strand * 1.3 });
      }
    });
  }


  // ==========================================================================
  // CUSTOM 3D .GLB TANK ENVIRONMENT & PROPS LOADER (BLENDER / MAYA / C4D)
  // ==========================================================================

  getSeabedY(x, z) {
    const dune =
      Math.sin(x * 0.28) * 0.38 +
      Math.cos(z * 0.36) * 0.32 +
      (z < -4 ? (-z - 4) * 0.18 : 0);
    return -5.6 + dune;
  }

  loadNormalizedEnvTemplate(url, propType = 'rock') {
    const cacheKey = `${url}::${propType}`;
    if (this.envTemplateCache.has(cacheKey)) {
      return this.envTemplateCache.get(cacheKey);
    }

    const promise = new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          gltf.scene.updateMatrixWorld(true);
          const worldBox = new THREE.Box3().setFromObject(gltf.scene);
          const worldSize = new THREE.Vector3();
          const worldCenter = new THREE.Vector3();
          worldBox.getSize(worldSize);
          worldBox.getCenter(worldCenter);

          const nativeHeight = Math.max(worldSize.y, 0.001);
          const invH = 1.0 / nativeHeight;
          const templateGroup = new THREE.Group();

          gltf.scene.traverse((child) => {
            if (!child.isMesh || !child.geometry) return;

            // Bake node rotations/scales into cloned geometry and normalize:
            // X/Z centered at 0, bottom resting at y=0, total height = 1.0 (+Y Up)
            const geom = child.geometry.clone();
            geom.applyMatrix4(child.matrixWorld);
            geom.translate(-worldCenter.x, -worldBox.min.y, -worldCenter.z);
            geom.scale(invH, invH, invH);
            geom.computeVertexNormals();
            geom.computeBoundingSphere();

            const srcMat = Array.isArray(child.material) ? child.material[0] : child.material;
            let mat;

            if (propType === 'plant') {
              // Fix Maya Lambert KHR_materials_transmission=1 & add lush underwater leaf shading + GPU current sway!
              mat = new THREE.MeshStandardMaterial({
                map: srcMat?.map || null,
                color: new THREE.Color(1.12, 1.18, 1.08),
                emissive: new THREE.Color(0x0c381f),
                emissiveIntensity: 0.22,
                roughness: 0.52,
                metalness: 0.0,
                side: THREE.DoubleSide
              });
              if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;

              const swayUniform = this.plantSwayUniform;
              mat.onBeforeCompile = (shader) => {
                shader.uniforms.uSwayTime = swayUniform;
                shader.vertexShader = shader.vertexShader
                  .replace(
                    '#include <common>',
                    `#include <common>
                    uniform float uSwayTime;`
                  )
                  .replace(
                    '#include <begin_vertex>',
                    `#include <begin_vertex>
                    float hNorm = clamp(transformed.y, 0.0, 1.0);
                    float bend = hNorm * hNorm;
                    float wPhase = modelMatrix[3].x * 0.42 + modelMatrix[3].z * 0.33;
                    transformed.x += sin(uSwayTime * 1.35 + wPhase + hNorm * 2.1) * 0.042 * bend;
                    transformed.z += cos(uSwayTime * 1.08 + wPhase * 1.25 + hNorm * 1.7) * 0.028 * bend;`
                  );
              };
            } else {
              // Sculpted PBR River Rocks: preserve BaseColor + Normal + Roughness maps & lift underwater contrast
              mat = new THREE.MeshStandardMaterial({
                map: srcMat?.map || null,
                normalMap: srcMat?.normalMap || null,
                roughnessMap: srcMat?.roughnessMap || null,
                metalnessMap: srcMat?.metalnessMap || null,
                color: new THREE.Color(1.36, 1.40, 1.44),
                emissive: new THREE.Color(0x0d2638),
                emissiveIntensity: 0.15,
                roughness: srcMat?.roughness ?? 0.85,
                metalness: 0.05,
                side: THREE.DoubleSide
              });
              if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
            }

            const cleanMesh = new THREE.Mesh(geom, mat);
            templateGroup.add(cleanMesh);
          });

          resolve({ templateGroup, nativeHeight });
        },
        undefined,
        reject
      );
    });

    this.envTemplateCache.set(cacheKey, promise);
    return promise;
  }

  async loadCustomModelsFromConfig() {
    this.customEnvGroup = new THREE.Group();
    this.scene.add(this.customEnvGroup);

    const fsCfg = ENVIRONMENT_CONFIG.fullScene;
    if (fsCfg && fsCfg.enabled && fsCfg.url) {
      try {
        const headRes = await fetch(fsCfg.url, { method: 'HEAD' });
        if (headRes.ok) {
          this.loadGlbIntoTank(fsCfg.url, fsCfg);
        }
      } catch (_) {}
    }

    if (Array.isArray(ENVIRONMENT_CONFIG.props) && ENVIRONMENT_CONFIG.props.length > 0) {
      for (const prop of ENVIRONMENT_CONFIG.props) {
        if (!prop?.url) continue;
        const propType = prop.type || (prop.url.toLowerCase().includes('plant') ? 'plant' : 'rock');
        this.loadNormalizedEnvTemplate(prop.url, propType)
          .then(({ templateGroup, nativeHeight }) => {
            const instance = templateGroup.clone(true);
            const x = prop.x ?? prop.position?.[0] ?? 0;
            const z = prop.z ?? prop.position?.[2] ?? -2;
            const sink = prop.sink ?? 0.14;
            const y = prop.y ?? prop.position?.[1] ?? (this.getSeabedY(x, z) - sink);

            const targetH = prop.targetHeight ?? (nativeHeight * (prop.scale ?? 1.0));
            instance.position.set(x, y, z);
            instance.scale.setScalar(targetH);
            instance.rotation.y = prop.rotationY ?? 0;
            this.customEnvGroup.add(instance);
          })
          .catch((err) => console.warn('Failed to load custom prop:', prop.url, err));
      }
    }
  }

  loadGlbIntoTank(urlOrBlobUrl, cfg = {}) {
    this.gltfLoader.load(
      urlOrBlobUrl,
      (gltf) => {
        // Clear previous custom full scene if previewing another .glb
        while (this.customEnvGroup.children.length > 0) {
          this.customEnvGroup.remove(this.customEnvGroup.children[0]);
        }
        this.gltfMixers = [];

        const model = gltf.scene;

        if (cfg.autoFitToTank !== false) {
          const box = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);

          const maxHoriz = Math.max(size.x, size.z, 0.001);
          const targetW = cfg.targetWidth || 28.0;
          const fitScale = (targetW / maxHoriz) * (cfg.scale || 1.0);
          model.scale.setScalar(fitScale);

          const scaledBox = new THREE.Box3().setFromObject(model);
          const scaledCenter = new THREE.Vector3();
          scaledBox.getCenter(scaledCenter);

          const floorY = cfg.floorY ?? -5.8;
          const offsetZ = cfg.offsetZ ?? -1.2;
          model.position.set(
            -scaledCenter.x,
            floorY - scaledBox.min.y,
            -scaledCenter.z + offsetZ
          );
        } else {
          const p = cfg.position || [0, -5.6, -1.2];
          model.position.set(p[0], p[1], p[2]);
          model.scale.setScalar(cfg.scale || 1.0);
          model.rotation.y = cfg.rotationY || 0;
        }

        this.customEnvGroup.add(model);
        this.registerGltfAnimations(gltf);

        if (cfg.replaceDefaultRocksAndPlants !== false) {
          if (this.defaultReefGroup) this.defaultReefGroup.visible = false;
          if (this.defaultKelpGroup) this.defaultKelpGroup.visible = false;
        }
        if (cfg.replaceDefaultSandFloor) {
          if (this.defaultSandFloor) this.defaultSandFloor.visible = false;
        }
      },
      undefined,
      (err) => {
        console.warn('GLB load failed:', err);
        alert('3D .glb file එක load කරන්න බැරි වුණා. Blender වලින් glTF Binary (.glb) විදියට export කරලා බලන්න.');
      }
    );
  }

  registerGltfAnimations(gltf) {
    if (gltf.animations && gltf.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        mixer.clipAction(clip).play();
      }
      this.gltfMixers.push(mixer);
    }
  }

  buildAmbientBubbles() {
    const count = 160;
    const geom = new THREE.SphereGeometry(0.085, 10, 8);
    // Natural underwater bubbles: milky translucent white with a cool blue tint & bright highlight
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xe9f4fb,
      transmission: 0.92,
      transparent: true,
      opacity: 0.42,
      roughness: 0.14,
      metalness: 0.04,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12
    });
    this.bubbleInst = new THREE.InstancedMesh(geom, mat, count);
    this.bubbleData = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const b = {
        x: (Math.random() - 0.5) * 28,
        y: -5.5 + Math.random() * 12.5,
        z: -7 + Math.random() * 11,
        speed: 0.6 + Math.random() * 1.1,
        scale: 0.45 + Math.random() * 1.35,
        phase: Math.random() * Math.PI * 2
      };
      this.bubbleData.push(b);
      dummy.position.set(b.x, b.y, b.z);
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      this.bubbleInst.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(this.bubbleInst);
  }

  // ==========================================================================
  // CREATURE SPAWNING & LIFELIKE SWIMMING AI
  // ==========================================================================

  async loadInitialFishes() {
    // Preload any custom Blender .glb / _template.png creature overrides first
    await preloadCustomCreatureAssets(GLTFLoader);

    // Spawn starter demo fishes first so tank is immediately vibrant
    this.syncDemoFishes();

    try {
      const fishes = await fetchInitialFishes();
      for (const f of fishes) {
        await this.spawnCreatureFromRecord(f, false);
      }
      this.updateFishCounter();
    } catch (err) {
      console.warn('Could not load initial fishes from Supabase:', err);
    }
  }

  syncDemoFishes() {
    if (this.showDemoFish) {
      for (const spec of STARTER_FISH_SPECS) {
        if (!this.creatures.has(spec.id)) {
          const canvas = generateHandColoredCanvas(spec.species, spec.palette, false);
          const tex = new THREE.CanvasTexture(canvas);
          this.registerCreatureActor({
            id: spec.id,
            name: spec.name,
            species: spec.species,
            texture: tex,
            previewUrl: canvas.toDataURL('image/png'),
            isDemo: true,
            celebrate: false
          });
        }
      }
    } else {
      for (const spec of STARTER_FISH_SPECS) {
        this.removeCreature(spec.id);
      }
    }
    this.updateFishCounter();
  }

  spawnCreatureFromRecord(fish, celebrate = true) {
    return new Promise((resolve) => {
      if (this.creatures.has(fish.id)) return resolve();
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      loader.load(
        fish.textureUrl,
        (tex) => {
          this.registerCreatureActor({
            id: fish.id,
            name: fish.name,
            species: fish.species,
            texture: tex,
            previewUrl: fish.textureUrl,
            createdAt: fish.createdAt,
            isDemo: false,
            celebrate
          });
          this.updateFishCounter();
          resolve();
        },
        undefined,
        () => resolve()
      );
    });
  }

  registerCreatureActor({ id, name, species, texture, previewUrl, createdAt, isDemo, celebrate }) {
    const meta = getSpeciesMeta(species);
    const meshGroup = buildCreatureMesh(THREE, species, texture);
    meshGroup.scale.setScalar(meta.baseScale);
    meshGroup.userData.creatureId = id;

    // Create floating Artist Name Badge Sprite
    const labelSprite = this.createNameBadgeSprite(`${meta.emoji} ${name}`, isDemo);
    labelSprite.position.set(0, species === 'seahorse' ? 1.52 : species === 'jellyfish' ? 1.32 : species === 'crab' ? 0.95 : 1.08, 0);
    labelSprite.visible = this.showLabels;

    const root = new THREE.Group();
    root.add(meshGroup);
    root.add(labelSprite);

    // Initial position & target steering state
    const actor = {
      id,
      name,
      species,
      previewUrl,
      createdAt: createdAt || new Date().toISOString(),
      isDemo: !!isDemo,
      root,
      meshGroup,
      labelSprite,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      target: new THREE.Vector3(),
      speed:
        species === 'jellyfish' ? 1.05
        : species === 'starfish' ? 0.55
        : species === 'crab' ? 1.25
        : 2.15 + Math.random() * 0.75,
      phase: Math.random() * 100,
      heroTimer: celebrate ? 4.8 : 0,
      retargetTimer: 0
    };

    if (celebrate) {
      // Dramatic dive from top center water surface!
      actor.pos.set(0, 6.8, 3.2);
      actor.vel.set(0, -3.5, 0.8);
      actor.target.set(0, 0.8, 6.2); // Spotlight front-and-center near glass!
      this.triggerArrivalSplash(name, meta);
    } else {
      actor.pos.copy(this.pickRandomZoneTarget(species));
      actor.target.copy(this.pickRandomZoneTarget(species));
      const dir = Math.random() > 0.5 ? 1 : -1;
      actor.vel.set(dir * actor.speed, 0, 0);
    }

    root.position.copy(actor.pos);
    this.scene.add(root);
    this.creatures.set(id, actor);
  }

  pickRandomZoneTarget(species) {
    const x = (Math.random() - 0.5) * (TANK_BOUNDS.x * 1.75);
    const z = TANK_BOUNDS.zMin + 1.2 + Math.random() * (TANK_BOUNDS.zMax - TANK_BOUNDS.zMin - 2.0);
    let y = (Math.random() - 0.5) * 6.5;

    if (species === 'turtle') y = 0.8 + Math.random() * 3.8;
    else if (species === 'jellyfish') y = -1.5 + Math.random() * 5.8;
    else if (species === 'starfish') {
      // Starfish glide along the front sandy foreground or front glass!
      return new THREE.Vector3(x * 0.72, -4.3 + Math.random() * 2.2, 2.1 + Math.random() * 2.1);
    } else if (species === 'crab') {
      // Crabs scuttle sideways along the sandy seabed just behind the front glass
      return new THREE.Vector3(x * 0.8, -4.45 + Math.random() * 0.55, 0.6 + Math.random() * 2.6);
    }

    // Keep swim targets cleanly above the left/right rock outcrops
    if (Math.abs(x) > 5.6 && z < 0.8) {
      y = Math.max(y, 0.2 + Math.random() * 3.8);
    }
    return new THREE.Vector3(x, y, z);
  }

  createNameBadgeSprite(text, isDemo) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');

    ctx.font = '600 28px system-ui, -apple-system, sans-serif';
    const textW = Math.min(270, ctx.measureText(text).width + 44);
    const rx = (320 - textW) / 2;

    ctx.fillStyle = isDemo ? 'rgba(8, 28, 52, 0.68)' : 'rgba(6, 78, 98, 0.84)';
    ctx.strokeStyle = isDemo ? 'rgba(125, 211, 252, 0.45)' : 'rgba(45, 212, 191, 0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(rx, 12, textW, 48, 24);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 160, 37);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.15, 0.48, 1);
    return sprite;
  }

  triggerArrivalSplash(artistName, meta) {
    this.audio.playSplashArrival();

    // 3D Splash bubble burst from top center!
    const burstGroup = new THREE.Group();
    const bGeom = new THREE.SphereGeometry(0.12, 8, 8);
    const bMat = new THREE.MeshBasicMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.85 });
    const particles = [];
    for (let i = 0; i < 55; i++) {
      const m = new THREE.Mesh(bGeom, bMat);
      m.position.set((Math.random() - 0.5) * 2.2, 6.2, 3.2 + (Math.random() - 0.5) * 1.8);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 4.5,
        -2.5 - Math.random() * 4.5,
        (Math.random() - 0.5) * 3.5
      );
      burstGroup.add(m);
      particles.push({ m, v });
    }
    this.scene.add(burstGroup);
    this.splashBursts.push({ group: burstGroup, mat: bMat, particles, age: 0 });

    // Show celebratory toast banner
    const banner = document.getElementById('arrival-toast');
    if (banner) {
      banner.innerHTML = `
        <span class="toast-emoji">${meta.emoji}</span>
        <div>
          <div class="toast-title">අලුත් මාළුවෙක් Aquarium එකට ආවා! 🎉</div>
          <div class="toast-sub"><strong>${this.escapeHtml(artistName)}</strong> ගේ <strong>${meta.name}</strong> දැන් පීනනවා!</div>
        </div>
      `;
      banner.classList.add('visible');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => banner.classList.remove('visible'), 5200);
    }
  }

  removeCreature(id) {
    const actor = this.creatures.get(id);
    if (!actor) return;
    this.scene.remove(actor.root);
    this.creatures.delete(id);
  }

  // ==========================================================================
  // INTERACTIVE SHARK VISIT & FOOD DROP & CREATURE CLICK SPOTLIGHT
  // ==========================================================================

  triggerSharkVisit() {
    if (this.sharkActor) return;
    this.audio.playSharkAlert();

    const sharkGroup = new THREE.Group();
    const sharkMat = new THREE.MeshStandardMaterial({ color: 0x4a6fa5, roughness: 0.38, metalness: 0.08 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.45 });

    // Sleek 3D Reef Shark body
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.68, 2.8, 8, 18), sharkMat);
    torso.rotation.z = Math.PI / 2;
    torso.scale.set(1, 1.15, 0.82);
    sharkGroup.add(torso);

    const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.56, 2.4, 6, 14), bellyMat);
    belly.rotation.z = Math.PI / 2;
    belly.position.set(0.1, -0.22, 0);
    sharkGroup.add(belly);

    // Iconic Dorsal Fin
    const dorsalShape = new THREE.Shape();
    dorsalShape.moveTo(0.4, 0.55);
    dorsalShape.quadraticCurveTo(-0.1, 1.75, -0.65, 1.65);
    dorsalShape.quadraticCurveTo(-0.35, 1.0, -0.55, 0.52);
    const dorsal = new THREE.Mesh(
      new THREE.ExtrudeGeometry(dorsalShape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03 }),
      sharkMat
    );
    dorsal.position.z = -0.05;
    sharkGroup.add(dorsal);

    // Pectoral fins
    const pecGeom = new THREE.ConeGeometry(0.45, 1.45, 4);
    const pecL = new THREE.Mesh(pecGeom, sharkMat);
    pecL.position.set(0.35, -0.35, 0.85);
    pecL.rotation.set(1.15, 0, -0.35);
    const pecR = pecL.clone();
    pecR.position.z = -0.85;
    pecR.rotation.x = -1.15;
    sharkGroup.add(pecL, pecR);

    // Wagging Shark Tail
    const tailPivot = new THREE.Group();
    tailPivot.position.set(-2.05, 0, 0);
    const upperTail = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.7, 5), sharkMat);
    upperTail.position.set(-0.45, 0.55, 0);
    upperTail.rotation.z = 0.75;
    const lowerTail = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.1, 5), sharkMat);
    lowerTail.position.set(-0.35, -0.45, 0);
    lowerTail.rotation.z = 2.35;
    tailPivot.add(upperTail, lowerTail);
    sharkGroup.add(tailPivot);

    // Friendly Shark Eyes
    const eyeGeom = new THREE.SphereGeometry(0.1, 10, 10);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
    const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
    eyeL.position.set(1.45, 0.18, 0.46);
    const eyeR = eyeL.clone();
    eyeR.position.z = -0.46;
    sharkGroup.add(eyeL, eyeR);

    sharkGroup.scale.setScalar(1.35);
    sharkGroup.position.set(-22, 1.2, -1.5);
    this.scene.add(sharkGroup);
    this.sharkActor = { group: sharkGroup, tailPivot };
  }

  dropFoodAtWorld(wx, wy, wz) {
    this.audio.playPop();
    const geom = new THREE.SphereGeometry(0.11, 10, 10);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffbe0b,
      emissive: 0xfb8500,
      emissiveIntensity: 0.45
    });
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geom, mat);
      m.position.set(
        wx + (Math.random() - 0.5) * 1.4,
        wy + (Math.random() - 0.5) * 0.6,
        wz + (Math.random() - 0.5) * 1.2
      );
      this.scene.add(m);
      this.foodPellets.push({ mesh: m, age: 0 });
    }
  }

  handleTankTap(e) {
    // Ignore clicks on UI controls
    if (e.target !== this.renderer.domElement) return;

    this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const meshList = [];
    for (const actor of this.creatures.values()) {
      meshList.push(actor.meshGroup);
    }
    const hits = this.raycaster.intersectObjects(meshList, true);
    if (hits.length > 0) {
      let obj = hits[0].object;
      while (obj && !obj.userData.creatureId) obj = obj.parent;
      if (obj && obj.userData.creatureId) {
        const actor = this.creatures.get(obj.userData.creatureId);
        if (actor) {
          this.showCreatureSpotlightModal(actor);
          return;
        }
      }
    }

    // Otherwise drop fish food pellets at z = 0 plane!
    const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hitPt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(planeZ, hitPt)) {
      const clampedX = Math.max(-11, Math.min(11, hitPt.x));
      const clampedY = Math.max(-3, Math.min(5.2, hitPt.y));
      this.dropFoodAtWorld(clampedX, clampedY, 0.5);
    }
  }

  showCreatureSpotlightModal(actor) {
    this.audio.playPop();
    this.inspectedActorId = actor.id;
    const meta = getSpeciesMeta(actor.species);
    const modal = document.getElementById('fish-inspect-card');
    if (!modal) return;
    document.getElementById('inspect-img').src = actor.previewUrl;
    document.getElementById('inspect-title').textContent = `${meta.emoji} ${actor.name}'s ${meta.name}`;
    document.getElementById('inspect-sub').textContent = actor.isDemo
      ? 'Starter Demo Creature • Toggle "Demo Fish" on top bar to hide'
      : `Scanned & Colored Paper Sheet • ${new Date(actor.createdAt).toLocaleTimeString()}`;

    const delBtn = document.getElementById('btn-delete-single-fish');
    if (delBtn) delBtn.classList.toggle('hidden', !!actor.isDemo);
    modal.classList.remove('hidden');
  }

  clearAllUserFishesLocally(hideDemo = false) {
    for (const [id, actor] of [...this.creatures.entries()]) {
      if (!actor.isDemo) this.removeCreature(id);
    }
    if (hideDemo) {
      this.showDemoFish = false;
      localStorage.setItem('aquarium_show_demo', '0');
      this.syncDemoFishes();
      document.getElementById('btn-demo-toggle')?.classList.remove('active-pill');
    }
    this.updateFishCounter();
  }

  // ==========================================================================
  // SUPABASE REALTIME SYNC (POSTGRES CHANGES + BROADCAST)
  // ==========================================================================

  connectRealtime() {
    const statusDot = document.getElementById('live-status-dot');
    initLiveChannel({
      onFishAdded: (fish) => {
        if (fish) this.spawnCreatureFromRecord(fish, true);
      },
      onFishDeleted: (fishId) => {
        this.removeCreature(fishId);
        this.updateFishCounter();
      },
      onTankCleared: (payload) => {
        this.clearAllUserFishesLocally(!!payload?.hideDemo);
      },
      onTankEvent: (payload) => {
        if (payload?.action === 'shark') this.triggerSharkVisit();
        else if (payload?.action === 'feed') this.dropFoodAtWorld(0, 4.2, 0.5);
      },
      onStatusChange: (online) => {
        if (statusDot) statusDot.classList.toggle('online', !!online);
      }
    });
  }

  // ==========================================================================
  // UI BINDINGS & PURE CLIENT-SIDE QR CODE GENERATION
  // ==========================================================================

  initUI() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('embed') === '1') {
      document.body.classList.add('embedded-preview');
      if (this.audio) this.audio.muted = true;
    }

    window.addEventListener('message', (ev) => {
      const cmd = ev.data?.type;
      if (cmd === 'aquarium:feed') {
        this.dropFoodAtWorld((Math.random() - 0.5) * 6, 4.4, 0.8);
      } else if (cmd === 'aquarium:shark') {
        this.triggerSharkVisit();
      } else if (cmd === 'aquarium:labels') {
        this.showLabels = !this.showLabels;
        for (const actor of this.creatures.values()) {
          actor.labelSprite.visible = this.showLabels;
        }
      }
    });

    const activeRoom = getActiveRoomCode();
    const scanUrl = buildPageUrlWithRoom('./scan.html', activeRoom);
    const sheetsUrl = buildPageUrlWithRoom('./sheets.html', activeRoom);

    const roomPill = document.getElementById('btn-room-pill');
    if (roomPill) roomPill.textContent = `🔑 Tank: ${activeRoom}`;
    const qrRoomBadge = document.getElementById('qr-room-badge');
    if (qrRoomBadge) qrRoomBadge.textContent = `🔑 Code: ${activeRoom}`;
    const resetRoomLbl = document.getElementById('reset-room-label');
    if (resetRoomLbl) resetRoomLbl.textContent = activeRoom;

    registerOrFetchTank(activeRoom).then((meta) => {
      const titleEl = document.getElementById('tank-title-label');
      if (titleEl && meta?.title && meta.title !== `Tank ${activeRoom}`) {
        titleEl.textContent = `🐠 ${meta.title}`;
      }
      const titleInp = document.getElementById('room-title-modal-input');
      if (titleInp && meta?.title && meta.title !== `Tank ${activeRoom}`) {
        titleInp.value = meta.title;
      }
    }).catch(() => {});

    const qrImg = document.getElementById('qr-code-img');
    if (qrImg) {
      qrImg.src = makeQrPngDataUrl(scanUrl, 260, '#062038', '#ffffff');
    }
    const urlLabel = document.getElementById('scan-url-text');
    if (urlLabel) urlLabel.textContent = scanUrl.replace(/^https?:\/\//, '');

    const fullTabLink = document.getElementById('link-drawer-fulltab');
    if (fullTabLink) fullTabLink.href = scanUrl;

    // Room Switcher Modal Bindings
    const roomModal = document.getElementById('room-switch-modal');
    const roomInp = document.getElementById('room-code-modal-input');
    document.getElementById('btn-room-pill')?.addEventListener('click', () => {
      if (roomInp) roomInp.value = activeRoom;
      roomModal?.classList.remove('hidden');
      roomInp?.focus();
    });
    document.getElementById('btn-close-room-modal')?.addEventListener('click', () => {
      roomModal?.classList.add('hidden');
    });
    document.getElementById('btn-random-room')?.addEventListener('click', () => {
      if (roomInp) roomInp.value = generateRandomRoomCode('REEF');
      const titleInp = document.getElementById('room-title-modal-input');
      if (titleInp) titleInp.value = '';
    });
    document.getElementById('btn-copy-room-scanner')?.addEventListener('click', (e) => {
      const targetCode = normalizeRoomCode(roomInp?.value || activeRoom);
      const link = buildPageUrlWithRoom('./scan.html', targetCode);
      navigator.clipboard?.writeText(link).catch(() => {});
      const btn = e.currentTarget;
      const old = btn.textContent;
      btn.textContent = '✅ Link Copied!';
      setTimeout(() => { btn.textContent = old; }, 1800);
    });
    document.getElementById('btn-apply-room')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const nextCode = normalizeRoomCode(roomInp?.value || generateRandomRoomCode('REEF'));
      const nextTitle = document.getElementById('room-title-modal-input')?.value?.trim() || '';
      btn.disabled = true;
      btn.textContent = '⏳ Opening...';
      try {
        if (nextTitle) {
          await registerOrFetchTank(nextCode, nextTitle);
        }
      } catch (_) {}
      window.location.href = buildPageUrlWithRoom('./aquarium.html', nextCode);
    });

    document.getElementById('btn-demo-toggle')?.classList.toggle('active-pill', this.showDemoFish);

    document.getElementById('btn-feed')?.addEventListener('click', () => {
      this.dropFoodAtWorld((Math.random() - 0.5) * 6, 4.4, 0.8);
    });

    document.getElementById('btn-shark')?.addEventListener('click', () => {
      this.triggerSharkVisit();
    });

    document.getElementById('btn-labels')?.addEventListener('click', (e) => {
      this.showLabels = !this.showLabels;
      for (const actor of this.creatures.values()) {
        actor.labelSprite.visible = this.showLabels;
      }
      e.currentTarget.classList.toggle('active-pill', this.showLabels);
    });

    document.getElementById('btn-demo-toggle')?.addEventListener('click', (e) => {
      this.showDemoFish = !this.showDemoFish;
      localStorage.setItem('aquarium_show_demo', this.showDemoFish ? '1' : '0');
      this.syncDemoFishes();
      e.currentTarget.classList.toggle('active-pill', this.showDemoFish);
    });

    // Reset Tank Modal & PIN-Protected Clear All
    const resetModal = document.getElementById('reset-tank-modal');
    document.getElementById('btn-reset-tank')?.addEventListener('click', () => {
      resetModal?.classList.remove('hidden');
      document.getElementById('reset-pin-input')?.focus();
    });
    document.getElementById('btn-cancel-reset')?.addEventListener('click', () => {
      resetModal?.classList.add('hidden');
    });
    document.getElementById('btn-confirm-reset')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const pin = document.getElementById('reset-pin-input')?.value || '';
      const hideDemo = !!document.getElementById('chk-reset-hide-demo')?.checked;
      btn.disabled = true;
      btn.textContent = '⏳ ඉවත් කරමින්...';
      try {
        await resetAllFishesInSupabase(pin, hideDemo);
        this.clearAllUserFishesLocally(hideDemo);
        resetModal?.classList.add('hidden');
        document.getElementById('reset-pin-input').value = '';
      } catch (err) {
        alert('PIN අංකය වැරදියි හෝ Reset කළ නොහැක (Default PIN: 1234)');
      } finally {
        btn.disabled = false;
        btn.textContent = '🧹 ඔක්කොම මාළු ඉවත් කරන්න';
      }
    });

    // Delete a single scanned fish from spotlight card
    document.getElementById('btn-delete-single-fish')?.addEventListener('click', async () => {
      if (!this.inspectedActorId) return;
      const pin = prompt('මේ මාළුවා අයින් කරන්න Admin PIN එක ගහන්න (Default: 1234):', '');
      if (!pin) return;
      try {
        await deleteSingleFishInSupabase(this.inspectedActorId, pin);
        this.removeCreature(this.inspectedActorId);
        this.updateFishCounter();
        document.getElementById('fish-inspect-card')?.classList.add('hidden');
      } catch (_) {
        alert('PIN අංකය වැරදියි! (Default PIN: 1234)');
      }
    });

    document.getElementById('btn-sound')?.addEventListener('click', (e) => {
      this.audio.muted = !this.audio.muted;
      if (!this.audio.muted) this.audio.playPop();
      e.currentTarget.textContent = this.audio.muted ? '🔇 Muted' : '🔊 Sound';
    });

    document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });

    // Minimize / Collapse the top menu bar for a clean tank view
    document.getElementById('btn-collapse-hud')?.addEventListener('click', (e) => {
      const hud = document.getElementById('top-hud');
      if (hud) {
        hud.classList.toggle('collapsed');
        e.currentTarget.textContent = hud.classList.contains('collapsed') ? '▴' : '▾';
        e.currentTarget.title = hud.classList.contains('collapsed')
          ? 'Expand menu bar'
          : 'Minimize menu bar';
      }
    });

    document.getElementById('btn-toggle-qr')?.addEventListener('click', () => {
      document.getElementById('qr-card')?.classList.toggle('minimized');
    });

    document.getElementById('close-inspect')?.addEventListener('click', () => {
      document.getElementById('fish-inspect-card')?.classList.add('hidden');
    });

    // Built-in Split-Screen Studio Drawer (test Scanner or Printable Sheets right next to the 3D Tank!)
    const drawer = document.getElementById('studio-drawer');
    const iframe = document.getElementById('studio-iframe');

    document.getElementById('btn-open-scanner-drawer')?.addEventListener('click', () => {
      if (iframe && drawer) {
        if (!iframe.src.includes('scan.html')) iframe.src = scanUrl;
        drawer.classList.remove('hidden');
      }
    });

    document.getElementById('btn-open-sheets-drawer')?.addEventListener('click', () => {
      if (iframe && drawer) {
        if (!iframe.src.includes('sheets.html')) iframe.src = sheetsUrl;
        drawer.classList.remove('hidden');
      }
    });

    document.getElementById('btn-drawer-tab-sheets')?.addEventListener('click', () => {
      if (iframe) iframe.src = sheetsUrl;
    });

    document.getElementById('btn-drawer-tab-scan')?.addEventListener('click', () => {
      if (iframe) iframe.src = scanUrl;
    });

    document.getElementById('btn-close-drawer')?.addEventListener('click', () => {
      drawer?.classList.add('hidden');
    });

    // Live .GLB File Picker & Drag-and-Drop Previewer for 3D Artists!
    document.getElementById('glb-test-input')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const blobUrl = URL.createObjectURL(file);
        this.loadGlbIntoTank(blobUrl, ENVIRONMENT_CONFIG.fullScene);
      }
    });

    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && /\.(glb|gltf)$/i.test(file.name)) {
        const blobUrl = URL.createObjectURL(file);
        this.loadGlbIntoTank(blobUrl, ENVIRONMENT_CONFIG.fullScene);
      }
    });
  }

  updateFishCounter() {
    const el = document.getElementById('fish-count-badge');
    if (el) el.textContent = `${this.creatures.size} Sea Creatures`;
  }

  escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ==========================================================================
  // MAIN RENDER & SIMULATION LOOP (60 FPS)
  // ==========================================================================

  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.elapsedTime;

    this.controls.update();

    // Parallax backdrop follows the camera (photo drifts, kelp layers slide)
    this.updateBackdropParallax(dt);

    this.plantSwayUniform.value = elapsed;
    for (const mixer of this.gltfMixers) {
      mixer.update(dt);
    }

    // Update animated caustics every 2nd frame
    if ((Math.floor(elapsed * 60) & 1) === 0) {
      this.updateCausticsCanvas(elapsed);
    }

    // Sway God Rays & Kelp Forest
    for (const r of this.godRays) {
      r.mesh.position.x = r.baseX + Math.sin(elapsed * 0.45 + r.phase) * 0.65;
    }
    for (const k of this.kelpBlades) {
      const pos = k.mesh.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        const yNorm = k.base[i + 1] / k.height;
        arr[i] = k.base[i] + Math.sin(elapsed * 1.6 - yNorm * 2.5 + k.phase) * 0.35 * yNorm;
        arr[i + 2] = k.base[i + 2] + Math.cos(elapsed * 1.2 - yNorm * 2.0 + k.phase) * 0.2 * yNorm;
      }
      pos.needsUpdate = true;
    }

    // Update Ambient Rising Bubbles
    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.bubbleData.length; i++) {
      const b = this.bubbleData[i];
      b.y += b.speed * dt;
      if (b.y > 7.0) {
        b.y = -5.5;
        b.x = (Math.random() - 0.5) * 28;
      }
      const wobble = Math.sin(elapsed * 2.4 + b.phase) * 0.18;
      dummy.position.set(b.x + wobble, b.y, b.z);
      dummy.scale.setScalar(b.scale);
      dummy.updateMatrix();
      this.bubbleInst.setMatrixAt(i, dummy.matrix);
    }
    this.bubbleInst.instanceMatrix.needsUpdate = true;

    // Update Food Pellets
    for (let i = this.foodPellets.length - 1; i >= 0; i--) {
      const p = this.foodPellets[i];
      p.age += dt;
      p.mesh.position.y -= 0.85 * dt;
      p.mesh.position.x += Math.sin(elapsed * 3 + i) * 0.2 * dt;
      if (p.mesh.position.y < -5.1 || p.age > 12) {
        this.scene.remove(p.mesh);
        this.foodPellets.splice(i, 1);
      }
    }

    // Update Splash Bursts
    for (let i = this.splashBursts.length - 1; i >= 0; i--) {
      const sb = this.splashBursts[i];
      sb.age += dt;
      sb.mat.opacity = Math.max(0, 0.85 * (1 - sb.age / 2.2));
      for (const pt of sb.particles) {
        pt.m.position.addScaledVector(pt.v, dt);
        pt.v.y += 4.2 * dt; // buoyancy upward!
        pt.v.multiplyScalar(0.96);
      }
      if (sb.age > 2.2) {
        this.scene.remove(sb.group);
        this.splashBursts.splice(i, 1);
      }
    }

    // Update Visiting Reef Shark
    if (this.sharkActor) {
      const sh = this.sharkActor;
      sh.group.position.x += 4.8 * dt;
      sh.group.position.y = 1.0 + Math.sin(elapsed * 1.4) * 0.55;
      sh.tailPivot.rotation.y = Math.sin(elapsed * 5.2) * 0.38;
      sh.group.rotation.y = Math.sin(elapsed * 2.6) * 0.06;
      if (sh.group.position.x > 24) {
        this.scene.remove(sh.group);
        this.sharkActor = null;
      }
    }

    // Update All Swimming User & Demo Creatures!
    for (const actor of this.creatures.values()) {
      this.stepCreatureAI(actor, dt, elapsed);
    }

    // Pass 1: parallax underwater backdrop (clears + paints the background)
    // Pass 2: the 3D tank on top of it, without clearing again.
    if (this.backdropScene) {
      this.renderer.autoClear = true;
      this.renderer.render(this.backdropScene, this.camera);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = true;
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // Velocity direction becomes pure noise when a creature almost stops: atan2 flips by
  // 180 degrees between frames and the model visibly spins. Freeze the heading while the
  // creature is hovering and ease towards the new heading otherwise (no more snap turns).
  stableYaw(actor, dt) {
    const horiz = Math.hypot(actor.vel.x, actor.vel.z);
    const raw = Math.atan2(-actor.vel.z, actor.vel.x);
    const prev = actor.lastYaw;
    if (typeof prev !== 'number') {
      actor.lastYaw = raw;
      return raw;
    }
    if (horiz < 0.22) return prev;

    let delta = raw - prev;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const yaw = prev + delta * Math.min(1, dt * 7);
    actor.lastYaw = yaw;
    return yaw;
  }

  stepCreatureAI(actor, dt, elapsed) {
    const sp = actor.species;

    // 1. Hero Arrival Spotlight Moment (spins happily near front glass for 4.5s!)
    if (actor.heroTimer > 0) {
      actor.heroTimer -= dt;
      actor.pos.lerp(actor.target, dt * 2.6);
      actor.root.position.copy(actor.pos);
      actor.meshGroup.rotation.set(0, Math.sin(elapsed * 2.2) * 0.85, 0);
      animateCreatureMesh(actor.meshGroup, elapsed + actor.phase, 1.35);
      if (actor.heroTimer <= 0) {
        actor.target.copy(this.pickRandomZoneTarget(sp));
        actor.vel.set(actor.speed, 0, 0);
      }
      return;
    }

    // 2. Seeking Food Pellets (for fish & turtles)
    let chasingFood = false;
    if (this.foodPellets.length > 0 && sp !== 'jellyfish' && sp !== 'starfish') {
      let nearest = null;
      let minDist = 8.5;
      for (let i = 0; i < this.foodPellets.length; i++) {
        const fp = this.foodPellets[i];
        const d = actor.pos.distanceTo(fp.mesh.position);
        if (d < minDist) {
          minDist = d;
          nearest = { fp, idx: i };
        }
      }
      if (nearest) {
        actor.target.copy(nearest.fp.mesh.position);
        chasingFood = true;
        if (minDist < 0.75) {
          // Eat pellet!
          this.scene.remove(nearest.fp.mesh);
          this.foodPellets.splice(nearest.idx, 1);
          this.audio.playPop();
        }
      }
    }

    // 3. Scatter playfully away from Visiting Shark!
    let fleeImpulse = new THREE.Vector3();
    if (this.sharkActor) {
      const diff = actor.pos.clone().sub(this.sharkActor.group.position);
      const dist = diff.length();
      if (dist < 5.5 && dist > 0.01) {
        fleeImpulse.copy(diff.normalize()).multiplyScalar((5.5 - dist) * 2.4);
      }
    }

    // 4. Wander target retargeting
    actor.retargetTimer -= dt;
    if (!chasingFood && (actor.pos.distanceTo(actor.target) < 1.6 || actor.retargetTimer <= 0)) {
      actor.target.copy(this.pickRandomZoneTarget(sp));
      actor.retargetTimer = 4 + Math.random() * 5;
    }

    const desired = actor.target.clone().sub(actor.pos);
    if (desired.lengthSq() > 0.001) desired.normalize();
    const activeSpeed = actor.speed * (chasingFood ? 1.65 : 1.0);
    desired.multiplyScalar(activeSpeed).add(fleeImpulse);

    // Smoothly arc over the left/right rock outcrops instead of clipping boulders
    if (sp !== 'starfish' && sp !== 'crab' && Math.abs(actor.pos.x) > 5.4 && actor.pos.z < 0.8 && actor.pos.y < 0.0) {
      desired.y += (0.2 - actor.pos.y) * 1.6;
    }

    actor.vel.lerp(desired, dt * (sp === 'starfish' ? 1.2 : sp === 'crab' ? 1.6 : 1.8));

    // Species-specific motion & orientation
    if (sp === 'jellyfish') {
      // Jellyfish bob vertically with pulse thrust!
      const bob = Math.sin((elapsed + actor.phase) * 2.8) * 0.45;
      actor.pos.x += actor.vel.x * 0.45 * dt;
      actor.pos.y += (actor.vel.y * 0.4 + bob) * dt;
      actor.pos.z += actor.vel.z * 0.45 * dt;
      actor.pos.y = Math.max(-3.6, Math.min(5.2, actor.pos.y));
      actor.root.position.copy(actor.pos);
      actor.meshGroup.rotation.z = -actor.vel.x * 0.14;
      actor.meshGroup.rotation.x = actor.vel.z * 0.14;
      actor.meshGroup.rotation.y += dt * 0.35;
    } else if (sp === 'starfish') {
      // Starfish faces camera smoothly while gliding across reef/glass
      actor.pos.addScaledVector(actor.vel, dt);
      actor.pos.y = Math.max(-4.7, Math.min(-1.4, actor.pos.y));
      actor.root.position.copy(actor.pos);
      actor.meshGroup.rotation.set(0, Math.sin(elapsed * 0.6 + actor.phase) * 0.2, Math.sin(elapsed * 0.5 + actor.phase) * 0.15);
    } else if (sp === 'seahorse') {
      // Seahorse glides upright with gentle vertical bobbing & slight forward bow!
      const bob = Math.sin((elapsed + actor.phase) * 2.2) * 0.35;
      actor.pos.x += actor.vel.x * 0.72 * dt;
      actor.pos.y += (actor.vel.y * 0.65 + bob) * dt;
      actor.pos.z += actor.vel.z * 0.72 * dt;
      actor.pos.x = Math.max(-TANK_BOUNDS.x, Math.min(TANK_BOUNDS.x, actor.pos.x));
      actor.pos.y = Math.max(TANK_BOUNDS.yMin + 0.6, Math.min(TANK_BOUNDS.yMax - 0.3, actor.pos.y));
      actor.pos.z = Math.max(TANK_BOUNDS.zMin, Math.min(TANK_BOUNDS.zMax, actor.pos.z));
      actor.root.position.copy(actor.pos);

      const yaw = this.stableYaw(actor, dt);
      actor.meshGroup.rotation.order = 'YXZ';
      actor.meshGroup.rotation.y = yaw;
      actor.meshGroup.rotation.z = -0.10 + Math.sin((elapsed + actor.phase) * 2.2) * 0.08;
      actor.meshGroup.rotation.x = 0;
    } else if (sp === 'crab') {
      // Crab: sideways scuttle across the sand, always showing its face to the glass
      actor.pos.addScaledVector(actor.vel, dt * 0.55);
      actor.pos.x = Math.max(-TANK_BOUNDS.x + 0.8, Math.min(TANK_BOUNDS.x - 0.8, actor.pos.x));
      actor.pos.y = Math.max(-4.55, Math.min(-3.85, actor.pos.y)); // hug the sand (seabed ~ -5.6 + dunes)
      actor.pos.z = Math.max(-0.6, Math.min(3.2, actor.pos.z));
      actor.root.position.copy(actor.pos);

      // Face the camera (+Z) with a slow curious sway; body leans into the sidestep
      const swayY = Math.sin((elapsed + actor.phase) * 0.45) * 0.20;
      const lean = Math.max(-0.14, Math.min(0.14, -actor.vel.x * 0.07));
      actor.meshGroup.rotation.order = 'YXZ';
      actor.meshGroup.rotation.y = swayY;
      actor.meshGroup.rotation.z = lean + Math.sin((elapsed + actor.phase) * 0.8) * 0.02;
      actor.meshGroup.rotation.x = 0;
    } else {
      // Fish & Sea Turtles orient smoothly along their 3D velocity vector (+X is nose forward!)
      actor.pos.addScaledVector(actor.vel, dt);
      actor.pos.x = Math.max(-TANK_BOUNDS.x, Math.min(TANK_BOUNDS.x, actor.pos.x));
      actor.pos.y = Math.max(TANK_BOUNDS.yMin, Math.min(TANK_BOUNDS.yMax, actor.pos.y));
      actor.pos.z = Math.max(TANK_BOUNDS.zMin, Math.min(TANK_BOUNDS.zMax, actor.pos.z));
      actor.root.position.copy(actor.pos);

      const horizLen = Math.hypot(actor.vel.x, actor.vel.z) || 0.001;
      const yaw = this.stableYaw(actor, dt);
      const pitch = Math.atan2(actor.vel.y, horizLen) * 0.55;
      actor.meshGroup.rotation.order = 'YXZ';
      actor.meshGroup.rotation.y = yaw;
      actor.meshGroup.rotation.z = pitch;
      actor.meshGroup.rotation.x = 0;
    }

    // Animation clip tempo follows the live swim speed: slow flutter when hovering,
    // faster beats while sprinting for food or darting away from a tap.
    const liveSpeed = actor.vel.length();
    const speedRatio = Math.max(0.45, Math.min(1.65, liveSpeed / Math.max(actor.speed, 0.001)));
    animateCreatureMesh(actor.meshGroup, elapsed + actor.phase, speedRatio * (chasingFood ? 1.25 : 1.0));
  }
}

new DigitalAquariumApp();
