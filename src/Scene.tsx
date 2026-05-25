/* eslint-disable react/no-unknown-property */
import { useEffect, useMemo, useRef } from "react";
import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  GestureTracker,
  ScreenSpaceUI,
  ScreenTransform,
  XRModel,
  useXRContext,
  useScreenRectAspect,
  computeContainScale,
} from "@vincentt-sdks/xr-sdk";
import * as THREE from "three";
import logoShape from "./logoShape.json";

// TEMP: when true, skip the hand-tracking intro (hand sprite + "show your hand"
// prompt + wave/sync) and jump straight to the celebration. Flip back to false
// to restore the full first-scene flow.
const DEBUG_SKIP_INTRO = false;

const LOGO_BOUNCE_AMPLITUDE = 0.025;
const LOGO_BOUNCE_FREQUENCY = 0.35;
const LOGO_TILT_AMPLITUDE = (25 * Math.PI) / 180; // ±25° oscillating tilt
const LOGO_TILT_FREQUENCY = 0.22;
const LOGO_DEPTH = 0.06; // extrusion thickness (in unit-width shape space)
const LOGO_EDGE_COLOR = "#ffffff"; // sides/back of the extruded badge
const LOGO_SIZE = 0.82; // overall scale within the contained anchor box

/** Builds the extruded badge geometry once from the traced silhouette,
 *  normalized to unit width, with front-cap UVs matching the logo texture. */
function useLogoGeometry() {
  return useMemo(() => {
    const raw = logoShape.points as [number, number][];
    // Normalize to unit width (source is wider than tall) before extruding.
    const xs = raw.map((p) => p[0]);
    const w = Math.max(...xs) - Math.min(...xs) || 1;
    const pts = raw.map(([x, y]) => new THREE.Vector2(x / w, y / w));
    const shape = new THREE.Shape(pts);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: LOGO_DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.01,
      bevelSegments: 3,
      curveSegments: 4,
    });
    geo.center();

    // Front-cap UVs from the now-centered geometry's own XY bounds so the
    // logo art maps 1:1 across the silhouette. V is not flipped (texture
    // origin already top-left via flipY default).
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const sx = bb.max.x - bb.min.x || 1;
    const sy = bb.max.y - bb.min.y || 1;
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) - bb.min.x) / sx;
      const v = (pos.getY(i) - bb.min.y) / sy;
      uv.setXY(i, u, v);
    }
    uv.needsUpdate = true;
    return geo;
  }, []);
}

function Logo3D({ tex, aspect }: { tex: THREE.Texture; aspect: number }) {
  const rectAspect = useScreenRectAspect();
  const geo = useLogoGeometry();
  const groupRef = useRef<THREE.Group>(null);
  const phaseRef = useRef(0);
  const tiltRef = useRef(0);

  // White slab body (caps + sides). Light standard material so the edges
  // still catch a soft shade as it tilts, but stays bright/white.
  const bodyMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(LOGO_EDGE_COLOR), roughness: 0.5, metalness: 0.0,
      emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.35,
    }),
    [],
  );
  // Logo art on the front face: rendered on a flat plane whose UVs are remapped
  // so the texture covers exactly the silhouette's XY bounds (matches the slab,
  // no rectangular overhang). Unlit so it stays bright over the white badge.
  const artMat = useMemo(
    () => new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, alphaTest: 0.04,
    }),
    [tex],
  );
  // Art plane at the texture's own aspect, centered on the badge, just in front.
  const artSize = useMemo(() => {
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const w = bb.max.x - bb.min.x;
    const img = tex.image as { width: number; height: number } | undefined;
    const texAspect = img && img.width ? img.width / img.height : 1.8;
    return { w, h: w / texAspect, z: bb.max.z + 0.002 };
  }, [geo, tex]);

  useFrame((_s, delta) => {
    phaseRef.current += delta * LOGO_BOUNCE_FREQUENCY * Math.PI * 2;
    tiltRef.current += delta * LOGO_TILT_FREQUENCY * Math.PI * 2;
    const g = groupRef.current;
    if (g) {
      g.position.y = Math.sin(phaseRef.current) * LOGO_BOUNCE_AMPLITUDE;
      g.rotation.y = Math.sin(tiltRef.current) * LOGO_TILT_AMPLITUDE;
    }
  });

  // Contain a unit plane in the anchor box, then scale down for the 3D badge.
  // The geometry is normalized to unit *width* at build time, and the source
  // art is wider than tall, so fit against the width component (sx).
  const [sx, sy] = computeContainScale(rectAspect, aspect);
  const fit = Math.min(sx, sy) * LOGO_SIZE;
  return (
    <group ref={groupRef} name="logo" scale={[fit, fit, fit]} renderOrder={20}>
      {/* White extruded badge body */}
      <mesh geometry={geo} material={bodyMat} renderOrder={20} />
      {/* Logo art on the front face */}
      <mesh position={[0, 0, artSize.z]} renderOrder={21}>
        <planeGeometry args={[artSize.w, artSize.h]} />
        <primitive object={artMat} attach="material" />
      </mesh>
    </group>
  );
}

const PALETTE = ["#ff6f91", "#ff9aa2", "#3fb8af", "#ffc857", "#ff5d8f", "#7ad7d0"];

type Burst = {
  balloons: {
    x: number; baseY: number; rise: number; sway: number; phase: number;
    scale: number; color: THREE.Color; tilt: number; delay: number;
  }[];
};

const BURST_DURATION_MS = 6800;
const DISMISS_FADE_MS = 300; // fade-out of hand + prompt after celebration fires
const BALLOON_RISE_SECS = 4.2; // higher = slower balloon ascent
const BALLOON_WAVE_GAP_SECS = 0.7; // delay between successive balloon waves

function makeBurst(): Burst {
  const c = (i: number) => new THREE.Color(PALETTE[i % PALETTE.length]).convertSRGBToLinear();
  const BALLOON_WAVES = 4;
  const balloons = Array.from({ length: 38 }, (_, i) => {
    const wave = i % BALLOON_WAVES; // round-robin so each wave is spread across screen
    return {
      x: (Math.random() * 2 - 1) * 0.8,
      baseY: -1.3 - Math.random() * 0.3,
      rise: 1.9 + Math.random() * 0.8,
      sway: 0.06 + Math.random() * 0.08,
      phase: Math.random() * Math.PI * 2,
      scale: 0.16 + Math.random() * 0.08,
      color: c(i + Math.floor(Math.random() * 6)),
      tilt: (Math.random() * 2 - 1) * 0.25,
      delay: wave * BALLOON_WAVE_GAP_SECS + Math.random() * 0.08,
    };
  });
  return { balloons };
}

const PEACE_ARM_DELAY_MS = 4200; // don't accept peace until the prompt is fully up
const PEACE_HOLD_MS = 300; // peace sign must be held this long to trigger
const THANKYOU_DELAY_MS = 3000; // wait for confetti rain to finish
const THANKYOU_ENTER_MS = 550; // entrance (scale + fade) duration
const THANKYOU_BASE_SCALE = 1.0; // resting scale within its anchor box
const THANKYOU_ENTER_FROM = 0.4; // entrance start scale
const THANKYOU_BEAT_PERIOD_MS = 1100; // heartbeat cycle
const THANKYOU_BEAT_AMP = 0.03; // heartbeat scale amplitude

// Heartbeat curve: two quick thumps per cycle, then rest. p in [0,1).
function heartbeat(p: number): number {
  const a = Math.exp(-Math.pow((p - 0.12) / 0.06, 2));      // first (bigger) thump
  const b = 0.7 * Math.exp(-Math.pow((p - 0.30) / 0.06, 2)); // second thump
  return a + b;
}

const THANKYOU_ASPECT = 1200 / 1459; // portrait
const THANKYOU_FIT = 0.42; // fraction of the contained anchor box to occupy
const THANKYOU_LOWER_Y = -0.28; // screen-space y it slides to after the peace sign
const THANKYOU_MOVE_MS = 600; // center -> lower transition duration

/** "Thank you" card: appears center after the confetti, animates in, heartbeats,
 *  then slides down to the lower position once `peaceRef` flips. */
function ThankYou({
  tex, fireRef, peaceRef, resetToken,
}: {
  tex: THREE.Texture;
  fireRef: React.MutableRefObject<boolean>;
  peaceRef: React.MutableRefObject<boolean>;
  resetToken: number;
}) {
  const rectAspect = useScreenRectAspect();
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const elapsedRef = useRef(-1); // -1 = waiting for trigger
  const moveRef = useRef(0); // 0 = center, 1 = lower position

  void resetToken; // reset is driven by peaceRef flipping false (animates back)

  useFrame((_s, delta) => {
    const mesh = meshRef.current;
    const group = groupRef.current;
    if (!mesh || !group) return;
    if (elapsedRef.current < 0) {
      if (!fireRef.current) return;
      elapsedRef.current = 0;
    }
    elapsedRef.current += delta * 1000;
    const t = elapsedRef.current;

    if (t < THANKYOU_DELAY_MS) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const local = t - THANKYOU_DELAY_MS;

    if (local < THANKYOU_ENTER_MS) {
      const p = local / THANKYOU_ENTER_MS;
      const ease = 1 - Math.pow(1 - p, 3);
      const overshoot = Math.sin(p * Math.PI) * 0.06; // pop past target then settle
      const s = THANKYOU_ENTER_FROM + (THANKYOU_BASE_SCALE - THANKYOU_ENTER_FROM) * ease + overshoot;
      mesh.scale.setScalar(s);
      if (matRef.current) matRef.current.opacity = Math.min(1, p * 1.4);
    } else {
      if (matRef.current) matRef.current.opacity = 1;
      const beatP = ((local - THANKYOU_ENTER_MS) % THANKYOU_BEAT_PERIOD_MS) / THANKYOU_BEAT_PERIOD_MS;
      mesh.scale.setScalar(THANKYOU_BASE_SCALE + heartbeat(beatP) * THANKYOU_BEAT_AMP);
    }

    // Center <-> lower slide, driven by the peace sign (animates both ways).
    const moveTarget = peaceRef.current ? 1 : 0;
    const moveStep = (delta * 1000) / THANKYOU_MOVE_MS;
    if (moveRef.current < moveTarget) moveRef.current = Math.min(1, moveRef.current + moveStep);
    else if (moveRef.current > moveTarget) moveRef.current = Math.max(0, moveRef.current - moveStep);
    const m = moveRef.current;
    const ease = m < 0.5 ? 2 * m * m : 1 - Math.pow(-2 * m + 2, 2) / 2;
    group.position.y = ease * THANKYOU_LOWER_Y;
  });

  const [sx, sy] = computeContainScale(rectAspect, THANKYOU_ASPECT);
  return (
    <group ref={groupRef}>
      <group scale={[sx * THANKYOU_FIT, sy * THANKYOU_FIT, 1]}>
        <mesh ref={meshRef} name="thank-you" visible={false} renderOrder={6000}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial ref={matRef} map={tex} transparent opacity={0} depthTest={false} />
        </mesh>
      </group>
    </group>
  );
}

const PHOTO_PROMPT_ASPECT = 1200 / 665; // landscape
const PHOTO_PROMPT_FIT = 0.42; // fraction of contained box; tune size here
const PHOTO_PROMPT_REST_Y = -0.32; // screen-space y when resting at the bottom
const PHOTO_PROMPT_SLIDE_MS = 450;
const PHOTO_PROMPT_BOUNCE_AMP = 0.02;

/** "Peace sign to take photo" prompt. Full-screen-anchored and sized with
 *  computeContainScale (aspect-correct, no stretch); slides up, then out on peace. */
function PhotoPrompt({
  tex, fireRef, peaceRef, resetToken,
}: {
  tex: THREE.Texture;
  fireRef: React.MutableRefObject<boolean>;
  peaceRef: React.MutableRefObject<boolean>;
  resetToken: number;
}) {
  const rectAspect = useScreenRectAspect();
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const elapsedRef = useRef(-1);
  const inRef = useRef(0);  // 0 -> 1 slide up
  const outRef = useRef(0); // 0 -> 1 slide out the bottom

  void resetToken; // reset is driven by peaceRef flipping false (animates back)

  useFrame((_s, delta) => {
    const group = groupRef.current;
    if (!group) return;
    if (elapsedRef.current < 0) {
      if (!fireRef.current) return;
      elapsedRef.current = 0;
    }
    elapsedRef.current += delta * 1000;
    const t = elapsedRef.current;
    const showAt = THANKYOU_DELAY_MS + THANKYOU_ENTER_MS;
    if (t < showAt) { group.visible = false; return; }
    group.visible = true;

    if (inRef.current < 1) {
      inRef.current = Math.min(1, inRef.current + (delta * 1000) / PHOTO_PROMPT_SLIDE_MS);
    }
    // Slide out on peace, slide back in on retake (peaceRef flips false) — both animated.
    const outTarget = peaceRef.current ? 1 : 0;
    const outStep = (delta * 1000) / PHOTO_PROMPT_SLIDE_MS;
    if (outRef.current < outTarget) outRef.current = Math.min(1, outRef.current + outStep);
    else if (outRef.current > outTarget) outRef.current = Math.max(0, outRef.current - outStep);
    const inEase = 1 - Math.pow(1 - inRef.current, 3);
    const outEase = outRef.current * outRef.current;
    group.position.y = PHOTO_PROMPT_REST_Y + (1 - inEase) * -0.35 + outEase * -0.9
      + Math.sin((t / 1000) * BOUNCE_FREQUENCY * Math.PI * 2) * PHOTO_PROMPT_BOUNCE_AMP;
    if (matRef.current) matRef.current.opacity = inEase * (1 - outEase);
  });

  const [sx, sy] = computeContainScale(rectAspect, PHOTO_PROMPT_ASPECT);
  return (
    <group ref={groupRef} visible={false}>
      <mesh name="photo-prompt" renderOrder={6001} scale={[sx * PHOTO_PROMPT_FIT, sy * PHOTO_PROMPT_FIT, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={matRef} map={tex} transparent opacity={0} depthTest={false} />
      </mesh>
    </group>
  );
}

const COUNTDOWN_FRAMES = 3; // sprite sheet rows: 3, 2, 1
const COUNTDOWN_FRAME_MS = 800; // time each number shows
const COUNTDOWN_END_HOLD_MS = 1000; // pause after "1" before the photo is taken
const COUNTDOWN_FRAME_ASPECT = 600 / (1075 / 3); // single frame aspect (~1.67)
const COUNTDOWN_FIT = 0.45;

/** 3-2-1 countdown from a vertical sprite sheet. Starts when `startRef` flips,
 *  pops each number with a quick scale-in, then calls onDone (to trigger capture). */
function Countdown({
  tex, startRef, onDone, resetToken,
}: {
  tex: THREE.Texture;
  startRef: React.MutableRefObject<boolean>;
  onDone: () => void;
  resetToken: number;
}) {
  const rectAspect = useScreenRectAspect();
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const elapsedRef = useRef(-1);
  const doneRef = useRef(false);

  // Retake: re-arm so a new peace sign runs the countdown again.
  useEffect(() => {
    if (resetToken) { elapsedRef.current = -1; doneRef.current = false; }
  }, [resetToken]);
  // Per-frame texture clones with UV window for each sprite row (top row = "3").
  const frames = useMemo(() => {
    return Array.from({ length: COUNTDOWN_FRAMES }, (_, i) => {
      const f = tex.clone();
      f.colorSpace = THREE.SRGBColorSpace;
      f.repeat.set(1, 1 / COUNTDOWN_FRAMES);
      f.offset.set(0, 1 - (i + 1) / COUNTDOWN_FRAMES); // row 0 at top
      f.needsUpdate = true;
      return f;
    });
  }, [tex]);

  const [csx, csy] = computeContainScale(rectAspect, COUNTDOWN_FRAME_ASPECT);
  const baseSX = csx * COUNTDOWN_FIT;
  const baseSY = csy * COUNTDOWN_FIT;

  useFrame((_s, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (elapsedRef.current < 0) {
      if (!startRef.current) return;
      elapsedRef.current = 0;
    }
    elapsedRef.current += delta * 1000;
    const t = elapsedRef.current;
    const idx = Math.floor(t / COUNTDOWN_FRAME_MS);
    if (idx >= COUNTDOWN_FRAMES) {
      // Hold a beat after "1" finishes before capturing.
      mesh.visible = false;
      if (t >= COUNTDOWN_FRAMES * COUNTDOWN_FRAME_MS + COUNTDOWN_END_HOLD_MS) {
        if (!doneRef.current) { doneRef.current = true; onDone(); }
      }
      return;
    }
    mesh.visible = true;
    if (matRef.current && matRef.current.map !== frames[idx]) {
      matRef.current.map = frames[idx];
      matRef.current.needsUpdate = true;
    }
    // Pop: quick scale-in at the start of each number, gentle ease after.
    const fp = (t % COUNTDOWN_FRAME_MS) / COUNTDOWN_FRAME_MS;
    const pop = 1 + 0.25 * Math.max(0, 1 - fp * 6);
    mesh.scale.set(baseSX * pop, baseSY * pop, 1);
    if (matRef.current) matRef.current.opacity = Math.min(1, (1 - fp) * 4);
  });

  return (
    <mesh ref={meshRef} name="countdown" visible={false} renderOrder={6100} scale={[baseSX, baseSY, 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial ref={matRef} map={frames[0]} transparent opacity={0} depthTest={false} />
    </mesh>
  );
}

const CONFETTI_COUNT = 1500;
const CONFETTI_GRID = 4; // 4x4 sprite sheet
const CONFETTI_DURATION_MS = 3000; // sustained spawn window (matches the prior rain)
const CONFETTI_LIFETIME = 4.0; // seconds a piece lives
const CONFETTI_GRAVITY = -1.4;
const CONFETTI_SIZE = 0.075;

type Particle = {
  active: boolean;
  born: number; // emission time (s since start)
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;
  vrx: number; vry: number; vrz: number;
  cell: number;
};

/** Sprite-sheet confetti as a single InstancedMesh: textured pieces sampled from a
 *  4x4 sheet, emitted from a bottom fountain + top rain, tumbling in 3D. Per-instance
 *  UV cell + alpha are fed via instanced attributes (one draw call for all pieces). */
function ConfettiSprites({ tex, fireRef }: { tex: THREE.Texture; fireRef: React.MutableRefObject<boolean> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const startRef = useRef(-1);
  const spawnedRef = useRef(0);

  const parts = useMemo<Particle[]>(
    () => Array.from({ length: CONFETTI_COUNT }, () => ({
      active: false, born: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      rx: 0, ry: 0, rz: 0, vrx: 0, vry: 0, vrz: 0, cell: 0,
    })),
    [],
  );

  // Per-instance UV offset (which sheet cell) and alpha, as instanced attributes.
  const uvOffset = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(CONFETTI_COUNT * 2), 2), []);
  const alphaAttr = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(CONFETTI_COUNT), 1), []);

  // Basic material windowed to one cell, extended with per-instance UV offset + alpha.
  const material = useMemo(() => {
    const t = tex.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(1 / CONFETTI_GRID, 1 / CONFETTI_GRID); // each instance samples a 1/grid window
    t.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map: t, transparent: true, side: THREE.DoubleSide, depthTest: false,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "attribute vec2 instanceUvOffset;\nattribute float instanceAlpha;\n" +
        "varying vec2 vUvOff;\nvarying float vAlpha;\n" +
        shader.vertexShader.replace(
          "#include <uv_vertex>",
          "#include <uv_vertex>\nvUvOff = instanceUvOffset;\nvAlpha = instanceAlpha;",
        );
      shader.fragmentShader =
        "varying vec2 vUvOff;\nvarying float vAlpha;\n" +
        shader.fragmentShader
          .replace(
            "#include <map_fragment>",
            "vec4 sampledDiffuseColor = texture2D( map, vMapUv + vUvOff );\n" +
              "diffuseColor *= sampledDiffuseColor;",
          )
          .replace(
            "#include <opaque_fragment>",
            "gl_FragColor.a *= vAlpha;\n#include <opaque_fragment>",
          );
    };
    return mat;
  }, [tex]);

  const spawn = (p: Particle, now: number) => {
    p.active = true;
    p.born = now;
    p.cell = Math.floor(Math.random() * (CONFETTI_GRID * CONFETTI_GRID));
    const fromTop = Math.random() < 0.45;
    if (fromTop) {
      p.x = (Math.random() * 2 - 1) * 1.1; p.y = 1.2; p.z = (Math.random() * 2 - 1) * 0.3;
      p.vx = (Math.random() * 2 - 1) * 0.2; p.vy = -0.1 - Math.random() * 0.3;
    } else {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.2;
      p.x = (Math.random() * 2 - 1) * 0.2; p.y = -1.3; p.z = (Math.random() * 2 - 1) * 0.3;
      p.vx = Math.cos(a) * sp * 0.7; p.vy = 1.6 + Math.random() * 1.2;
    }
    p.vz = (Math.random() * 2 - 1) * 0.3;
    p.rx = Math.random() * 6.28; p.ry = Math.random() * 6.28; p.rz = Math.random() * 6.28;
    p.vrx = (Math.random() * 2 - 1) * 5; p.vry = (Math.random() * 2 - 1) * 5; p.vrz = (Math.random() * 2 - 1) * 4;
  };

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const euler = useMemo(() => new THREE.Euler(), []);

  useFrame((_s, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (startRef.current < 0) {
      if (!fireRef.current) return;
      startRef.current = 0;
      mesh.visible = true;
      mesh.renderOrder = 4500;
    }
    startRef.current += delta;
    const now = startRef.current;

    if (now < CONFETTI_DURATION_MS / 1000) {
      const want = Math.floor((now / (CONFETTI_DURATION_MS / 1000)) * CONFETTI_COUNT);
      while (spawnedRef.current < want && spawnedRef.current < CONFETTI_COUNT) {
        const p = parts[spawnedRef.current];
        spawn(p, now);
        // write this instance's UV cell offset once
        const cx = p.cell % CONFETTI_GRID;
        const cy = Math.floor(p.cell / CONFETTI_GRID);
        uvOffset.setXY(spawnedRef.current, cx / CONFETTI_GRID, 1 - (cy + 1) / CONFETTI_GRID);
        uvOffset.needsUpdate = true;
        spawnedRef.current++;
      }
    }

    let anyActive = false;
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const p = parts[i];
      if (!p.active) {
        dummy.scale.setScalar(0); // collapse hidden instances
        dummy.position.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        alphaAttr.setX(i, 0);
        continue;
      }
      const age = now - p.born;
      if (age > CONFETTI_LIFETIME) {
        p.active = false;
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        alphaAttr.setX(i, 0);
        continue;
      }
      anyActive = true;
      const x = p.x + p.vx * age;
      const y = p.y + p.vy * age + 0.5 * CONFETTI_GRAVITY * age * age;
      const z = p.z + p.vz * age;
      euler.set(p.rx + p.vrx * age, p.ry + p.vry * age, p.rz + p.vrz * age);
      dummy.position.set(x, y, z);
      dummy.rotation.copy(euler);
      dummy.scale.setScalar(CONFETTI_SIZE);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      alphaAttr.setX(i, age > CONFETTI_LIFETIME - 0.6 ? Math.max(0, (CONFETTI_LIFETIME - age) / 0.6) : 1);
    }
    mesh.instanceMatrix.needsUpdate = true;
    alphaAttr.needsUpdate = true;

    if (!anyActive && now > CONFETTI_DURATION_MS / 1000) mesh.visible = false;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, CONFETTI_COUNT]}
      material={material}
      visible={false}
      renderOrder={4500}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]}>
        <primitive object={uvOffset} attach="attributes-instanceUvOffset" />
        <primitive object={alphaAttr} attach="attributes-instanceAlpha" />
      </planeGeometry>
    </instancedMesh>
  );
}

const BALLOON_COUNT = 40;
const BALLOON_GRID = 4; // 4x4 sheet
const BALLOON_ASPECT = 1; // each cell is square; balloon art is taller-than-wide within it
const BALLOON_SIZE = 0.34; // on-screen size of a balloon
const BALLOON_SPAWN_MS = 2600; // emit window
const BALLOON_LIFETIME = 6.5; // long enough to rise off-screen
const BALLOON_RISE = 0.42; // upward speed (units/s)
const BALLOON_WAVES = 5;

type Balloon = {
  active: boolean; born: number;
  x: number; baseSpeed: number; sway: number; swayPhase: number;
  tilt: number; cell: number; delay: number;
};

/** Balloon sprite-sheet rise. Single InstancedMesh; balloons spawn in waves from
 *  the bottom, rise with a gentle sway, stay upright, and fade as they exit. */
function BalloonSprites({ tex, fireRef }: { tex: THREE.Texture; fireRef: React.MutableRefObject<boolean> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const startRef = useRef(-1);
  const spawnedRef = useRef(0);

  const balloons = useMemo<Balloon[]>(
    () => Array.from({ length: BALLOON_COUNT }, (_, i) => ({
      active: false, born: 0,
      x: (Math.random() * 2 - 1) * 1.0,
      baseSpeed: BALLOON_RISE * (0.8 + Math.random() * 0.5),
      sway: 0.04 + Math.random() * 0.06,
      swayPhase: Math.random() * Math.PI * 2,
      tilt: (Math.random() * 2 - 1) * 0.12,
      cell: Math.floor(Math.random() * (BALLOON_GRID * BALLOON_GRID)),
      delay: (i % BALLOON_WAVES) * (BALLOON_SPAWN_MS / 1000 / BALLOON_WAVES) + Math.random() * 0.1,
    })),
    [],
  );

  const uvOffset = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(BALLOON_COUNT * 2), 2), []);
  const alphaAttr = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(BALLOON_COUNT), 1), []);

  const material = useMemo(() => {
    const t = tex.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(1 / BALLOON_GRID, 1 / BALLOON_GRID);
    t.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "attribute vec2 instanceUvOffset;\nattribute float instanceAlpha;\n" +
        "varying vec2 vUvOff;\nvarying float vAlpha;\n" +
        shader.vertexShader.replace(
          "#include <uv_vertex>",
          "#include <uv_vertex>\nvUvOff = instanceUvOffset;\nvAlpha = instanceAlpha;",
        );
      shader.fragmentShader =
        "varying vec2 vUvOff;\nvarying float vAlpha;\n" +
        shader.fragmentShader
          .replace(
            "#include <map_fragment>",
            "vec4 sampledDiffuseColor = texture2D( map, vMapUv + vUvOff );\ndiffuseColor *= sampledDiffuseColor;",
          )
          .replace("#include <opaque_fragment>", "gl_FragColor.a *= vAlpha;\n#include <opaque_fragment>");
    };
    return mat;
  }, [tex]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((_s, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (startRef.current < 0) {
      if (!fireRef.current) return;
      startRef.current = 0;
      mesh.visible = true;
      mesh.renderOrder = 1; // ensure behind frame + thank-you/prompt
    }
    startRef.current += delta;
    const now = startRef.current;

    if (now < BALLOON_SPAWN_MS / 1000) {
      const want = Math.floor((now / (BALLOON_SPAWN_MS / 1000)) * BALLOON_COUNT);
      while (spawnedRef.current < want && spawnedRef.current < BALLOON_COUNT) {
        const b = balloons[spawnedRef.current];
        b.active = true;
        b.born = now;
        const cx = b.cell % BALLOON_GRID;
        const cy = Math.floor(b.cell / BALLOON_GRID);
        uvOffset.setXY(spawnedRef.current, cx / BALLOON_GRID, 1 - (cy + 1) / BALLOON_GRID);
        uvOffset.needsUpdate = true;
        spawnedRef.current++;
      }
    }

    let anyActive = false;
    for (let i = 0; i < BALLOON_COUNT; i++) {
      const b = balloons[i];
      if (!b.active) {
        dummy.scale.setScalar(0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        alphaAttr.setX(i, 0); continue;
      }
      const age = now - b.born;
      if (age > BALLOON_LIFETIME) {
        b.active = false; dummy.scale.setScalar(0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        alphaAttr.setX(i, 0); continue;
      }
      anyActive = true;
      const y = -1.35 + b.baseSpeed * age;          // rise from below the frame
      const x = b.x + Math.sin(age * 1.4 + b.swayPhase) * b.sway;
      const rz = b.tilt + Math.sin(age * 1.1 + b.swayPhase) * 0.06;
      dummy.position.set(x, y, 0);
      dummy.rotation.set(0, 0, rz);
      dummy.scale.set(BALLOON_SIZE, BALLOON_SIZE, BALLOON_SIZE);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // fade in on launch, fade out near end of life
      const fadeIn = Math.min(1, age / 0.3);
      const fadeOut = age > BALLOON_LIFETIME - 1.0 ? Math.max(0, (BALLOON_LIFETIME - age) / 1.0) : 1;
      alphaAttr.setX(i, fadeIn * fadeOut);
    }
    mesh.instanceMatrix.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    if (!anyActive && now > BALLOON_SPAWN_MS / 1000) mesh.visible = false;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, BALLOON_COUNT]}
      material={material}
      visible={false}
      renderOrder={1}
      frustumCulled={false}
    >
      <planeGeometry args={[BALLOON_ASPECT, 1]}>
        <primitive object={uvOffset} attach="attributes-instanceUvOffset" />
        <primitive object={alphaAttr} attach="attributes-instanceAlpha" />
      </planeGeometry>
    </instancedMesh>
  );
}

/** One-shot balloons, mounted in screen space. `fireRef` flips true once. */
function CelebrationBurst({ fireRef }: { fireRef: React.MutableRefObject<boolean> }) {
  const groupRef = useRef<THREE.Group>(null);
  const balloonRefs = useRef<THREE.Group[]>([]);
  const burst = useMemo(makeBurst, []);
  const elapsedRef = useRef(-1); // -1 = not started

  useFrame((_s, delta) => {
    const g = groupRef.current;
    if (!g) return;
    if (elapsedRef.current < 0) {
      if (!fireRef.current) return;
      elapsedRef.current = 0;
      g.visible = true;
    }
    elapsedRef.current += delta * 1000;
    const t = elapsedRef.current / 1000;
    const life = elapsedRef.current / BURST_DURATION_MS;
    if (life >= 1) {
      g.visible = false;
      return;
    }
    const fade = life < 0.8 ? 1 : 1 - (life - 0.8) / 0.2;

    burst.balloons.forEach((b, i) => {
      const node = balloonRefs.current[i];
      if (!node) return;
      const lt = t - b.delay; // local time since this balloon's wave launched
      if (lt <= 0) {
        node.visible = false;
        return;
      }
      node.visible = true;
      const rise = 1 - Math.pow(1 - Math.min(1, lt / BALLOON_RISE_SECS), 2);
      node.position.x = b.x + Math.sin(lt * 1.6 + b.phase) * b.sway;
      node.position.y = b.baseY + b.rise * rise;
      node.rotation.z = b.tilt + Math.sin(lt * 1.2 + b.phase) * 0.08;
      const op = fade * Math.min(1, lt / 0.12); // brief fade-in on launch
      (node.children as THREE.Object3D[]).forEach((c) => {
        const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
        if (m) m.opacity = c === node.children[1] ? op * 0.6 : op;
      });
    });
  });

  return (
    <group ref={groupRef} visible={false} renderOrder={5000}>
      {burst.balloons.map((b, i) => (
        <group
          key={`bal-${i}`}
          ref={(el) => { if (el) balloonRefs.current[i] = el; }}
          scale={[b.scale, b.scale, b.scale]}
        >
          <mesh scale={[0.85, 1.1, 1]} renderOrder={5000}>
            <circleGeometry args={[0.5, 24]} />
            <meshBasicMaterial color={b.color} transparent depthTest={false} />
          </mesh>
          <mesh position={[0, -0.62, 0]} renderOrder={5000}>
            <planeGeometry args={[0.012, 0.5]} />
            <meshBasicMaterial color={b.color} transparent opacity={0.6} depthTest={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const HAND_POSITION: [number, number, number] = [0, -1.249096889082566, -1.5];
const HAND_SCALE: [number, number, number] = [
  0.4265489517115532,
  0.9776900394274674,
  1,
];

const PULSE_SCALE_PEAK = 2.2;
const PULSE_RAMP_MS = 220;
const WAVE_AMPLITUDE_IDLE = 0.35;
const WAVE_AMPLITUDE_PULSED = 0.105;
const WAVE_AMPLITUDE_SETTLE_MS = 1000;
const HAND_SYNC_DELAY_MS = 1500; // settle (1s) + extra 0.5s of slowing
const HAND_SYNC_RAMP_MS = 400;   // ramp from wave -> synced over this
const HAND_SYNC_SMOOTHING = 0.18; // exponential smoothing factor per frame
const LABEL_FLIP_MS = 500; // duration of the vertical-flip swap
const HAND_SWAP_AFTER_SYNCED_MS = 1500; // after sync engaged this long, swap to release-hand
const RELEASE_HAND_ASPECT = 4096 / 2232; // ~1.836 (horizontal)
const PALM_ASPECT = 2286 / 4096; // ~0.558 (portrait)
const WAVE_FREQUENCY_IDLE = 0.8;
const WAVE_FREQUENCY_PULSED = 0.3;
const BOUNCE_AMPLITUDE = 0.025;
const BOUNCE_FREQUENCY = 0.35;

export const Scene = ({
  onCelebrate, onCapture, resetToken = 0,
}: {
  onCelebrate?: () => void;
  onCapture?: () => void;
  resetToken?: number;
}) => {
  const palmTex = useTexture("/assets/palm.webp");
  const frameTex = useTexture("/assets/frame.webp");
  const showHandTex = useTexture("/assets/show-your-hand.webp");
  const controlMoveTex = useTexture("/assets/control-your-move.webp");
  const logoTex = useTexture("/assets/logo.webp");
  const releaseHandTex = useTexture("/assets/release-hand.webp");
  const thankYouTex = useTexture("/assets/thank-you.webp");
  const takePhotoTex = useTexture("/assets/take-photo-prompt.webp");
  const countdownTex = useTexture("/assets/countdown-321.webp");
  const confettiTex = useTexture("/assets/confetti-sheet.webp");
  const balloonTex = useTexture("/assets/balloon-sheet.webp");

  for (const t of [palmTex, frameTex, showHandTex, controlMoveTex, logoTex, releaseHandTex, thankYouTex, takePhotoTex, countdownTex, confettiTex, balloonTex]) {
    t.colorSpace = THREE.SRGBColorSpace;
  }

  // Video texture for the animated "flowing" frame, shown while open_palm is held.
  const frameVideoTex = useMemo(() => {
    const video = document.createElement("video");
    video.src = "/assets/frame.mp4";
    video.crossOrigin = "anonymous";
    video.loop = true;
    video.muted = true;
    video.autoplay = false;
    video.playsInline = true;
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  // Material that color-keys near-black pixels to transparent, so the mp4's
  // opaque black mid-section drops out.
  const frameVideoMat = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uMap: { value: frameVideoTex },
        uKeyThreshold: { value: 0.18 },
        uKeySoftness: { value: 0.10 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uKeyThreshold;
        uniform float uKeySoftness;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(uMap, vUv);
          // luma; anything below threshold fades to transparent
          float luma = max(max(c.r, c.g), c.b);
          float alpha = smoothstep(uKeyThreshold, uKeyThreshold + uKeySoftness, luma);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(c.rgb, alpha);
        }
      `,
    });
  }, [frameVideoTex]);

  const handRef = useRef<THREE.Mesh>(null);
  const handMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const labelBounceRef = useRef<THREE.Mesh>(null);
  const labelMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const frameMeshRef = useRef<THREE.Mesh>(null);
  const frameMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const videoPlayingRef = useRef(false);
  const celebrateRef = useRef(false); // fires once when an armed hand leaves frame
  const releaseArmedRef = useRef(false); // true once "release hand" state reached
  const dismissRef = useRef(0); // 0->1 fade-out of hand + prompt after celebration
  const peaceRef = useRef(false); // flips true once a peace sign is held post-celebration
  const peaceHeldRef = useRef(0); // ms the peace sign has been held
  const celebrateAtRef = useRef(0); // performance.now() when celebration fired
  const { session } = useXRContext();

  // Animation state
  const stateRef = useRef({
    wavePhase: 0,
    bouncePhase: 0,
    pulseT: 0,
    pulseHeldMs: 0,
    baseRotZ: 0,
    basePosY: HAND_POSITION[1],
    baseHalfH: 0.4 * HAND_SCALE[1],
    bounceBaseY: 0,
    syncedAngle: 0,
    syncBlend: 0,
    handMirror: 1, // +1 = left hand sprite as-is, -1 = mirror for right hand
    labelFlipT: 0, // 0 = show-your-hand, 1 = control-your-move; lerps over LABEL_FLIP_MS
    labelTexId: 0, // 0 or 1; the texture currently bound to the label material
    syncedMs: 0, // how long syncBlend has been at 1
    handTexId: 0, // 0 = palm, 1 = release-hand
  });

  useEffect(() => {
    const hand = handRef.current;
    if (!hand) return;
    stateRef.current.baseRotZ = hand.rotation.z;
    // disable depth test so the hand can render on top of the screen-space UI on demand
    hand.traverse((c) => {
      const mat = (c as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) mat.depthTest = false;
    });
  }, []);

  // TEMP: skip the hand-tracking intro and jump straight to the celebration,
  // so we can iterate on confetti/thank-you without performing the gesture.
  useEffect(() => {
    if (!DEBUG_SKIP_INTRO) return;
    celebrateRef.current = true;
    celebrateAtRef.current = performance.now();
    onCelebrate?.();
  }, []);

  // Retake: clear the peace/countdown gate so the prompt returns and a new
  // peace sign can re-trigger the countdown. Re-arm the peace delay window.
  useEffect(() => {
    if (resetToken === 0) return;
    peaceRef.current = false;
    peaceHeldRef.current = 0;
    celebrateAtRef.current = performance.now() - PEACE_ARM_DELAY_MS; // accept peace immediately
  }, [resetToken]);

  useFrame((_state, delta) => {
    const hand = handRef.current;
    const bounce = labelBounceRef.current;
    const s = stateRef.current;
    if (!hand) return;

    s.bouncePhase += delta * BOUNCE_FREQUENCY * Math.PI * 2;
    if (bounce) {
      bounce.position.y =
        s.bounceBaseY + Math.sin(s.bouncePhase) * BOUNCE_AMPLITUDE;
    }

    const gestureNode = session.getModelNode(XRModel.GESTURE_TRACKER) as
      | { gesture?: string }
      | undefined;
    const isOpen = gestureNode?.gesture === "open_palm";

    // After the celebration + once the photo prompt is showing, a *held* peace
    // sign (victory) triggers the transition. Debounced so a single misclassified
    // frame doesn't latch it instantly.
    const g = gestureNode?.gesture?.toLowerCase();
    if (celebrateRef.current && !peaceRef.current) {
      const promptUp = (performance.now() - celebrateAtRef.current) > PEACE_ARM_DELAY_MS;
      if (promptUp && g === "victory") {
        peaceHeldRef.current += delta * 1000;
        if (peaceHeldRef.current >= PEACE_HOLD_MS) peaceRef.current = true;
      } else {
        peaceHeldRef.current = 0;
      }
    }

    // Computed early so all the "stay engaged through tilt" branches can use it.
    const coordsForPulse = (gestureNode as any)?.coordinates;
    const handVisible = !!(coordsForPulse && coordsForPulse[0] && coordsForPulse[9]);
    const syncedHold = s.pulseHeldMs >= HAND_SYNC_DELAY_MS && handVisible;

    // Swap frame material: color-keyed video shader while pulse is engaged,
    // plain png otherwise. Use the same syncedHold predicate so tilting (which
    // makes open_palm flicker off) doesn't pause/swap the video.
    const wantVideo = isOpen || syncedHold;
    const frameMesh = frameMeshRef.current;
    const stillMat = frameMatRef.current;
    if (frameMesh && stillMat) {
      const desired = wantVideo ? frameVideoMat : stillMat;
      if (frameMesh.material !== desired) {
        frameMesh.material = desired;
      }
      if (wantVideo && !videoPlayingRef.current) {
        (frameVideoTex.image as HTMLVideoElement)
          .play()
          .then(() => { videoPlayingRef.current = true; })
          .catch(() => {});
      } else if (!wantVideo && videoPlayingRef.current) {
        (frameVideoTex.image as HTMLVideoElement).pause();
        videoPlayingRef.current = false;
      }
    }

    // Pulse target: open_palm starts the pulse. Once we've held it long enough that
    // hand-sync is engaged, keep the pulse at peak as long as a hand is visible
    // (so the sprite doesn't shrink when the open_palm classifier flickers during tilt).
    const target = (isOpen || syncedHold) ? 1 : 0;
    const rampStep = (delta * 1000) / PULSE_RAMP_MS;
    if (s.pulseT < target) s.pulseT = Math.min(target, s.pulseT + rampStep);
    else if (s.pulseT > target)
      s.pulseT = Math.max(target, s.pulseT - rampStep);

    // Pulse-hold timer grows while open_palm detected, holds while *any* hand is detected,
    // and decays only when the hand fully leaves frame.
    const coordsForDetect = (gestureNode as any)?.coordinates;
    const handStillThere = !!(coordsForDetect && coordsForDetect[0] && coordsForDetect[9]);
    // Fire the celebration once: armed (reached "release hand") + hand now gone from frame.
    if (releaseArmedRef.current && !handStillThere) {
      celebrateRef.current = true;
      celebrateAtRef.current = performance.now();
      releaseArmedRef.current = false;
      onCelebrate?.();
    }
    if (isOpen) s.pulseHeldMs += delta * 1000;
    else if (!handStillThere) s.pulseHeldMs = Math.max(0, s.pulseHeldMs - delta * 1000);
    // else: hand visible but not open_palm — hold timer steady so sync persists through tilt
    const settle = Math.min(1, s.pulseHeldMs / WAVE_AMPLITUDE_SETTLE_MS);

    // Wave frequency lerps between idle and pulsed based on pulseT.
    // Wave amplitude additionally reduces after 1s of sustained pulse.
    // Accumulate phase directly so changes don't cause discontinuity.
    const waveFreq =
      WAVE_FREQUENCY_IDLE + (WAVE_FREQUENCY_PULSED - WAVE_FREQUENCY_IDLE) * s.pulseT;
    const waveAmp =
      WAVE_AMPLITUDE_IDLE + (WAVE_AMPLITUDE_PULSED - WAVE_AMPLITUDE_IDLE) * settle;
    s.wavePhase += delta * waveFreq * Math.PI * 2;
    const waveRot = Math.sin(s.wavePhase) * waveAmp;

    // After HAND_SYNC_DELAY_MS of sustained pulse, blend toward the user's hand angle.
    // Compute angle from wrist (idx 0) -> middle-base (idx 9) in normalized coords.
    const coords = (gestureNode as any)?.coordinates;
    let detectedAngle: number | null = null;
    if (coords && coords[0] && coords[9]) {
      // Y is inverted in screen space (negative = down); flip so rotation matches visual.
      // Webcam is mirrored selfie-style — negate dx so visual rotation matches user motion.
      const dx = -(coords[9].x - coords[0].x);
      const dy = -(coords[9].y - coords[0].y);
      // Reference "rest" angle: hand up -> dx=0, dy>0 -> atan2 = PI/2 -> rotation 0
      detectedAngle = Math.atan2(dy, dx) + Math.PI / 2;

      // Infer handedness via cross product (wrist->middle_base) x (wrist->thumb_base).
      // Sign flips between left and right hand. Default sprite is left; mirror for right.
      if (coords[2]) {
        const mx = coords[9].x - coords[0].x;
        const my = coords[9].y - coords[0].y;
        const tx = coords[2].x - coords[0].x;
        const ty = coords[2].y - coords[0].y;
        const cross = mx * ty - my * tx;
        s.handMirror = cross > 0 ? -1 : 1;
      }
    }

    // Once we've held the pulse long enough, stay synced as long as a hand is detected,
    // even if the gesture classifier loses `open_palm` (it does when the hand tilts).
    const handDetected = detectedAngle !== null;
    const wantSync = handDetected && s.pulseHeldMs >= HAND_SYNC_DELAY_MS;
    const blendTarget = wantSync ? 1 : 0;
    const blendStep = (delta * 1000) / HAND_SYNC_RAMP_MS;
    if (s.syncBlend < blendTarget) s.syncBlend = Math.min(blendTarget, s.syncBlend + blendStep);
    else if (s.syncBlend > blendTarget) s.syncBlend = Math.max(blendTarget, s.syncBlend - blendStep);

    if (detectedAngle !== null) {
      // Unwrap: choose the equivalent angle (±2π) closest to current syncedAngle
      // so atan2 discontinuities don't make the sprite take the long way around.
      let unwrapped = detectedAngle;
      while (unwrapped - s.syncedAngle > Math.PI) unwrapped -= Math.PI * 2;
      while (unwrapped - s.syncedAngle < -Math.PI) unwrapped += Math.PI * 2;
      // smoothed target so jitter from the tracker doesn't twitch the sprite
      s.syncedAngle += (unwrapped - s.syncedAngle) * HAND_SYNC_SMOOTHING;
    }

    hand.rotation.z =
      s.baseRotZ + waveRot * (1 - s.syncBlend) + s.syncedAngle * s.syncBlend;

    // Track how long sync has been fully engaged (drives the second label swap below).
    if (s.syncBlend >= 1) s.syncedMs += delta * 1000;
    else s.syncedMs = 0;

    // Label flip system. Three states:
    //   0 = "Show your hand" (idle)
    //   1 = "Control your move" (open_palm detected / synced)
    //   2 = "Release hand" (synced > HAND_SWAP_AFTER_SYNCED_MS)
    // The card rotates out to edge-on, texture swaps mid-flip, then rotates back.
    // rotation.x maps as a triangle: 0 -> PI/2 at T=0.5, back to 0 at T=1.
    const LABEL_TEXES = [showHandTex, controlMoveTex, releaseHandTex];
    let wantTexId: number;
    if (s.syncedMs >= HAND_SWAP_AFTER_SYNCED_MS) { wantTexId = 2; releaseArmedRef.current = true; }
    else if (isOpen || syncedHold) wantTexId = 1;
    else wantTexId = 0;

    if (wantTexId !== s.labelTexId) {
      s.labelFlipT = Math.min(1, s.labelFlipT + (delta * 1000) / LABEL_FLIP_MS);
      const labelMat = labelMatRef.current;
      if (s.labelFlipT >= 0.5 && labelMat) {
        labelMat.map = LABEL_TEXES[wantTexId];
        labelMat.needsUpdate = true;
        s.labelTexId = wantTexId;
      }
    } else if (s.labelFlipT > 0) {
      s.labelFlipT = Math.max(0, s.labelFlipT - (delta * 1000) / LABEL_FLIP_MS);
    }

    if (bounce) {
      // triangle wave: 0 -> PI/2 at T=0.5 -> 0 at T=1
      const flipAngle = (s.labelFlipT < 0.5 ? s.labelFlipT : 1 - s.labelFlipT) * Math.PI;
      bounce.rotation.x = flipAngle;
    }

    const ease = Math.sin((s.pulseT * Math.PI) / 2);
    const f = 1 + (PULSE_SCALE_PEAK - 1) * ease;
    // Apply handedness mirror only while we're synced (blend > 0); idle stays as-is.
    const mirrorBlend = 1 + (s.handMirror - 1) * s.syncBlend; // 1 -> handMirror as blend ramps
    hand.scale.set(
      HAND_SCALE[0] * f * mirrorBlend,
      HAND_SCALE[1] * f,
      HAND_SCALE[2] * f,
    );
    hand.position.y = s.basePosY + s.baseHalfH * (f - 1) * 0.5;

    const order = s.pulseT > 0.01 ? 2000 : 0;
    hand.renderOrder = order;
    hand.traverse((c) => {
      c.renderOrder = order;
    });

    // After the celebration fires, fade out the hand sprite and the prompt.
    if (celebrateRef.current && dismissRef.current < 1) {
      dismissRef.current = Math.min(1, dismissRef.current + (delta * 1000) / DISMISS_FADE_MS);
    }
    const op = 1 - dismissRef.current;
    if (handMatRef.current) handMatRef.current.opacity = op;
    if (labelMatRef.current) labelMatRef.current.opacity = op;
  });

  return (
    <>
      <GestureTracker />
      <mesh
        ref={handRef}
        name="main-object"
        position={HAND_POSITION}
        scale={HAND_SCALE}
        visible={!DEBUG_SKIP_INTRO}
      >
        <planeGeometry args={[1.2, 0.8]} />
        <meshBasicMaterial
          ref={handMatRef}
          map={palmTex}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>

      <ScreenSpaceUI>
        {/* Full-screen decorative frame */}
        <ScreenTransform anchors={{ left: -1, right: 1, top: 1, bottom: -1 }}>
          <mesh ref={frameMeshRef} name="decorative-frame" renderOrder={10}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial ref={frameMatRef} map={frameTex} transparent />
          </mesh>
        </ScreenTransform>

        {/* Logo, top center — hidden for now */}
        {/* <ScreenTransform anchors={{ left: -0.85, right: 0.85, top: 0.88, bottom: 0.58 }}>
          <Logo3D tex={logoTex} aspect={logoShape.aspect} />
        </ScreenTransform> */}

        {/* "Show your hand" prompt */}
        <ScreenTransform
          anchors={{ left: -0.4, right: 0.4, top: -0.5, bottom: -0.9 }}
        >
          {/* Outer mesh sized by ScreenTransform; transparent passthrough */}
          <mesh name="floating-label" visible={!DEBUG_SKIP_INTRO}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial transparent opacity={0} />
            {/* Inner mesh whose position is free for bounce animation */}
            <mesh ref={labelBounceRef} name="floating-label-bounce">
              <planeGeometry args={[1, 1]} />
              <meshBasicMaterial
                ref={labelMatRef}
                map={showHandTex}
                transparent
                side={THREE.DoubleSide}
              />
            </mesh>
          </mesh>
        </ScreenTransform>

        {/* Sprite-sheet balloons rising + confetti — fire on hand-release */}
        <ScreenTransform anchors={{ left: -1, right: 1, top: 1, bottom: -1 }}>
          <BalloonSprites tex={balloonTex} fireRef={celebrateRef} />
        </ScreenTransform>
        <ScreenTransform anchors={{ left: -1, right: 1, top: 1, bottom: -1 }}>
          <ConfettiSprites tex={confettiTex} fireRef={celebrateRef} />
        </ScreenTransform>

        {/* "Thank you" card — center after confetti, slides down on peace sign */}
        <ScreenTransform anchors={{ left: -1, right: 1, top: 1, bottom: -1 }}>
          <ThankYou tex={thankYouTex} fireRef={celebrateRef} peaceRef={peaceRef} resetToken={resetToken} />
        </ScreenTransform>

        {/* "Peace sign to take photo" prompt — full-screen anchored, aspect-correct */}
        <ScreenTransform anchors={{ left: -1, right: 1, top: 1, bottom: -1 }}>
          <PhotoPrompt tex={takePhotoTex} fireRef={celebrateRef} peaceRef={peaceRef} resetToken={resetToken} />
        </ScreenTransform>

        {/* 3-2-1 countdown after the peace sign, then capture */}
        <ScreenTransform anchors={{ left: -1, right: 1, top: 1, bottom: -1 }}>
          <Countdown tex={countdownTex} startRef={peaceRef} onDone={() => onCapture?.()} resetToken={resetToken} />
        </ScreenTransform>

        {/* Balloon burst — hidden for now (confetti still fires via canvas-confetti in App) */}
        {/* <ScreenTransform anchors={{ left: -1, right: 1, top: 1, bottom: -1 }}>
          <CelebrationBurst fireRef={celebrateRef} />
        </ScreenTransform> */}
      </ScreenSpaceUI>
    </>
  );
};
