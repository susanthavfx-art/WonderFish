// ============================================================================
// CUSTOM 3D SEA CREATURES & PRINTABLE SHEET CONFIGURATION
// ============================================================================
// All creatures use custom 3D .glb models + 512x512 _template sheets
// located in ./models/creatures/!
//
// ORIENTATION CHEAT-SHEET (the tank always treats +X as "nose forward"):
//   model nose = +X  ->  facingOffsetDegY: 0
//   model nose = +Z  ->  facingOffsetDegY: 90    (R_y(90) maps +Z to +X)
//   model nose = -Z  ->  facingOffsetDegY: -90   (R_y(-90) maps -Z to +X)
//   model nose = -X  ->  facingOffsetDegY: 180
// The new Blender exports (My_clownfish / My_bluetang) come out of Blender with the
// nose on -Z, so they need -90. Fixed here in code instead of inside Blender.
// clipSpeed = multiplier for the embedded Blender animation clip rate (<1 = calmer).
// flatLight = true -> "paper cut-out" model. These Blender exports have inconsistent normals /
//   triangle winding, so tank lighting leaves one whole side dark green. Such species are drawn
//   unlit (texture as-is + distance fog) so the crayon colours stay even on both sides.
// flatLightTint = optional colour multiplier while drawing unlit (default 0xe8f4ff, cool water).

export const CREATURE_OVERRIDES = {
  clownfish: {
    glbUrl: './models/creatures/My_clownfish.glb',
    templateUrl: './models/creatures/My_clownfish_template.png',
    // coloredUrl intentionally omitted: clownfish_colored.png was painted for the OLD
    // UV layout; the new model is coloured procedurally from its own template sheet.
    facingOffsetDegY: -90, // My_clownfish.glb nose is -Z -> rotate -90 deg Y to face +X
    tiltOffsetDegX: 0,
    targetSize: 2.55,
    swimStyle: 'fish',
    autoSwimWave: true,
    clipSpeed: 1.0,
    flatLight: true // paper cut-out rig: draw unlit so both halves keep the crayon colour
  },
  angelfish: {
    glbUrl: './models/creatures/My_AngleFish.glb',
    templateUrl: './models/creatures/angelfish_template.png',
    coloredUrl: './models/creatures/angelfish_colored.png',
    facingOffsetDegY: 90, // In My_AngleFish.glb nose is +Z, dorsal is +Y -> +90 deg Y aligns nose to +X forward!
    tiltOffsetDegX: 0,
    targetSize: 2.75,
    swimStyle: 'fish',
    autoSwimWave: true
  },
  bluetang: {
    glbUrl: './models/creatures/My_bluetang.glb',
    templateUrl: './models/creatures/My_bluetang_template.png',
    facingOffsetDegY: -90, // My_bluetang.glb nose is -Z -> rotate -90 deg Y to face +X
    tiltOffsetDegX: 0,
    targetSize: 2.50,
    swimStyle: 'fish',
    autoSwimWave: true,
    clipSpeed: 1.0,
    flatLight: true // paper cut-out rig: draw unlit so both halves keep the crayon colour
  },
  seahorse: {
    glbUrl: './models/creatures/seahorse.glb',
    templateUrl: './models/creatures/seahorse_template.png',
    coloredUrl: './models/creatures/seahorse_colored.png',
    facingOffsetDegY: 180, // Faces LEFT (-X) on template -> rotated 180 deg to +X forward
    tiltOffsetDegX: 0,
    targetSize: 2.70,
    swimStyle: 'seahorse',
    autoSwimWave: true
  },
  starfish: {
    glbUrl: './models/creatures/starfish.glb',
    templateUrl: './models/creatures/starfish_template.png',
    coloredUrl: './models/creatures/starfish_colored.png',
    facingOffsetDegY: 0,
    tiltOffsetDegX: 0,
    targetSize: 2.35,
    swimStyle: 'starfish',
    autoSwimWave: true
  },
  crab: {
    // My_crabe.glb is a flat "paper cut-out" style rig (face plane normal = +/-X, legs down -Y).
    // -90 deg Y turns the drawn crab face toward +Z (the glass / camera). Template is a .jpg!
    glbUrl: './models/creatures/My_crabe.glb',
    templateUrl: './models/creatures/My_crabe_template.jpg',
    facingOffsetDegY: -90,
    tiltOffsetDegX: 0,
    targetSize: 1.85,
    swimStyle: 'crab',
    autoSwimWave: true,
    clipSpeed: 0.55, // lazy crab claw/leg flutter when idle
    flatLight: true // perfectly flat card: draw unlit so the face always shows the full colour
  }
};

// Want to add a 6th or 7th creature later? Add an entry here!
export const EXTRA_CUSTOM_SPECIES = [];
