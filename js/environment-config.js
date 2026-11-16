// ============================================================================
// CUSTOM 3D TANK ENVIRONMENT CONFIGURATION (MAYA / BLENDER .GLB MODELS)
// ============================================================================
// Tank 3D Bounds Reference (Three.js units / meters):
//   X (Left <-> Right) : -15.0  to  +15.0  (Total visible width ~ 30 units)
//   Y (Floor <-> Top)  :  -5.6 (Sand Floor) to +7.2 (Water Surface)
//   Z (Back <-> Front) :  -8.0 (Back Horizon) to +4.5 (Front Glass; Camera at Z = +16.2)

export const ENVIRONMENT_CONFIG = {
  // Optional single-file full scene override (if ./models/tank.glb exists)
  fullScene: {
    enabled: false,
    url: './models/tank.glb',
    autoFitToTank: true,
    targetWidth: 28.0,
    floorY: -5.8,
    offsetZ: -1.2,
    position: [0, -5.6, -1.2],
    rotationY: 0,
    scale: 1.0,
    replaceDefaultRocksAndPlants: true,
    replaceDefaultSandFloor: true
  },

  // Keep the sculpted caustics sand floor, and replace old procedural rocks/corals/kelp
  // with Susantha's custom Maya 3D rocks & swaying aquatic plants in ./models/env/!
  showBuiltInSandFloor: true,
  showBuiltInRocksAndCorals: false,
  showBuiltInKelpPlants: false,

  // Each unique .glb URL is downloaded ONCE, cached, normalized (centered X/Z, bottom y=0),
  // snapped cleanly onto the sculpted sand floor at (x, z), and plants get smooth GPU underwater sway!
  props: [
    // ========================================================================
    // LEFT ROCK OUTCROP & LUSH PLANTED GROVE (X: -14.8 .. -5.2)
    // ========================================================================
    // Hero boulders & river stones
    { url: './models/env/rock_01.glb', type: 'rock', x: -11.4, z: -3.6, targetHeight: 5.3, rotationY: 0.45, sink: 0.25 },
    { url: './models/env/rock_01.glb', type: 'rock', x: -8.2,  z: -2.6, targetHeight: 3.9, rotationY: 2.15, sink: 0.22 },
    { url: './models/env/rock_01.glb', type: 'rock', x: -13.6, z: -1.2, targetHeight: 3.3, rotationY: -0.85, sink: 0.20 },
    { url: './models/env/rock_02.glb', type: 'rock', x: -6.2,  z: -1.6, targetHeight: 2.0, rotationY: 0.75, sink: 0.16 },
    { url: './models/env/rock_02.glb', type: 'rock', x: -9.6,  z: -0.4, targetHeight: 1.55, rotationY: 2.60, sink: 0.15 },
    { url: './models/env/rock_02.glb', type: 'rock', x: -11.8, z:  1.4, targetHeight: 1.25, rotationY: 1.10, sink: 0.14 },

    // Tall background swaying reeds (plant_03)
    { url: './models/env/plant_03.glb', type: 'plant', x: -13.9, z: -5.4, targetHeight: 10.4, rotationY: 0.2,  sway: 0.36, sink: 0.12 },
    { url: './models/env/plant_03.glb', type: 'plant', x: -11.6, z: -6.2, targetHeight: 9.6,  rotationY: 1.4,  sway: 0.34, sink: 0.12 },
    { url: './models/env/plant_03.glb', type: 'plant', x: -9.1,  z: -5.8, targetHeight: 8.4,  rotationY: 2.5,  sway: 0.30, sink: 0.12 },

    // Midground broad-leaf Amazon Sword plants (plant_01)
    { url: './models/env/plant_01.glb', type: 'plant', x: -12.8, z: -3.2, targetHeight: 6.9, rotationY: 0.35, sway: 0.24, sink: 0.12 },
    { url: './models/env/plant_01.glb', type: 'plant', x: -9.8,  z: -3.9, targetHeight: 6.0, rotationY: 1.90, sway: 0.22, sink: 0.12 },
    { url: './models/env/plant_01.glb', type: 'plant', x: -6.9,  z: -3.4, targetHeight: 4.8, rotationY: -0.7, sway: 0.20, sink: 0.12 },

    // Graceful ribbon rosette plants around rock bases (plant_02)
    { url: './models/env/plant_02.glb', type: 'plant', x: -10.5, z: -1.5, targetHeight: 4.3, rotationY: 0.6,  sway: 0.26, sink: 0.10 },
    { url: './models/env/plant_02.glb', type: 'plant', x: -7.4,  z: -0.9, targetHeight: 3.3, rotationY: 2.1,  sway: 0.22, sink: 0.10 },
    { url: './models/env/plant_02.glb', type: 'plant', x: -13.2, z:  0.4, targetHeight: 3.6, rotationY: 1.2,  sway: 0.24, sink: 0.10 },

    // ========================================================================
    // RIGHT ROCK RIDGE & LUSH BOTANICAL GROVE (X: +5.2 .. +14.8)
    // ========================================================================
    // Hero boulders & river stones
    { url: './models/env/rock_01.glb', type: 'rock', x:  11.2, z: -3.4, targetHeight: 5.0, rotationY: -0.65, sink: 0.25 },
    { url: './models/env/rock_01.glb', type: 'rock', x:   7.9, z: -2.8, targetHeight: 3.7, rotationY:  1.55, sink: 0.22 },
    { url: './models/env/rock_01.glb', type: 'rock', x:  13.7, z: -1.4, targetHeight: 3.1, rotationY:  2.75, sink: 0.20 },
    { url: './models/env/rock_02.glb', type: 'rock', x:   6.0, z: -1.5, targetHeight: 1.95, rotationY: -1.10, sink: 0.16 },
    { url: './models/env/rock_02.glb', type: 'rock', x:   9.5, z: -0.3, targetHeight: 1.50, rotationY:  0.40, sink: 0.15 },
    { url: './models/env/rock_02.glb', type: 'rock', x:  11.9, z:  1.5, targetHeight: 1.20, rotationY: -2.20, sink: 0.14 },

    // Tall background swaying reeds (plant_03)
    { url: './models/env/plant_03.glb', type: 'plant', x:  13.8, z: -5.4, targetHeight: 10.2, rotationY: 0.9,  sway: 0.36, sink: 0.12 },
    { url: './models/env/plant_03.glb', type: 'plant', x:  11.3, z: -6.1, targetHeight: 9.3,  rotationY: 2.2,  sway: 0.34, sink: 0.12 },
    { url: './models/env/plant_03.glb', type: 'plant', x:   8.8, z: -5.6, targetHeight: 8.1,  rotationY: -0.5, sway: 0.28, sink: 0.12 },

    // Midground broad-leaf Amazon Sword plants (plant_01)
    { url: './models/env/plant_01.glb', type: 'plant', x:  12.7, z: -3.0, targetHeight: 6.7, rotationY: -1.2, sway: 0.24, sink: 0.12 },
    { url: './models/env/plant_01.glb', type: 'plant', x:   9.6, z: -3.8, targetHeight: 5.8, rotationY:  0.8, sway: 0.22, sink: 0.12 },
    { url: './models/env/plant_01.glb', type: 'plant', x:   6.8, z: -3.5, targetHeight: 4.7, rotationY:  2.4, sway: 0.20, sink: 0.12 },

    // Graceful ribbon rosette plants around rock bases (plant_02)
    { url: './models/env/plant_02.glb', type: 'plant', x:  10.3, z: -1.4, targetHeight: 4.2, rotationY: -0.8, sway: 0.26, sink: 0.10 },
    { url: './models/env/plant_02.glb', type: 'plant', x:   7.2, z: -0.8, targetHeight: 3.2, rotationY:  1.5, sway: 0.22, sink: 0.10 },
    { url: './models/env/plant_02.glb', type: 'plant', x:  13.1, z:  0.5, targetHeight: 3.5, rotationY: -1.9, sway: 0.24, sink: 0.10 },

    // ========================================================================
    // DEEP CENTER HORIZON ACCENTS (Keeps center swimming stage wide open!)
    // ========================================================================
    { url: './models/env/rock_01.glb',  type: 'rock',  x: -2.6, z: -6.4, targetHeight: 3.1, rotationY:  1.05, sink: 0.22 },
    { url: './models/env/rock_02.glb',  type: 'rock',  x:  2.4, z: -6.0, targetHeight: 2.2, rotationY: -0.65, sink: 0.18 },
    { url: './models/env/rock_02.glb',  type: 'rock',  x:  0.2, z: -4.8, targetHeight: 1.35, rotationY: 2.10, sink: 0.16 },
    { url: './models/env/plant_03.glb', type: 'plant', x: -4.2, z: -6.8, targetHeight: 6.8, rotationY:  0.4,  sway: 0.28, sink: 0.12 },
    { url: './models/env/plant_03.glb', type: 'plant', x:  4.3, z: -6.7, targetHeight: 6.6, rotationY:  1.9,  sway: 0.28, sink: 0.12 },
    { url: './models/env/plant_01.glb', type: 'plant', x: -1.4, z: -6.6, targetHeight: 4.2, rotationY:  1.1,  sway: 0.20, sink: 0.12 },
    { url: './models/env/plant_02.glb', type: 'plant', x:  1.8, z: -6.3, targetHeight: 3.4, rotationY: -1.3,  sway: 0.22, sink: 0.10 }
  ]
};
