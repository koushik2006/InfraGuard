"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeElements } from "@react-three/fiber";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { POS3D, type SensorState } from "./sensors";

export interface ViewApi { reset: () => void; zoom: (factor: number) => void }
export type HighlightKind = "finding" | "neutral";

const HOME_POS = new THREE.Vector3(92, 42, 104);
const HOME_TARGET = new THREE.Vector3(10, 7, 0);
const TOWER_X = [-22, 22];
const WATER_Y = -13;
const LEG_Z = 3.5;
const CYAN = "#22d3ee";
const HL_RED = "#ff3b30";
const HL_NEUTRAL = "#38bdf8";

// Which component is highlighted (id from the backend sensor → component mapping) and why.
const HlCtx = createContext<{ id: string | null; kind: HighlightKind }>({ id: null, kind: "neutral" });

/** Material that turns red (finding) or light blue (neutral sensor selection) when its component is the highlighted one. */
function M({ id, color, ...rest }: { id?: string; color: string } & ThreeElements["meshStandardMaterial"]) {
  const hl = useContext(HlCtx);
  const on = !!id && hl.id === id;
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => { if (on && ref.current) ref.current.emissiveIntensity = 1.1 + Math.sin(clock.elapsedTime * 3.2) * 0.45; });
  const c = on ? (hl.kind === "finding" ? HL_RED : HL_NEUTRAL) : color;
  return <meshStandardMaterial ref={ref} {...rest} color={c} emissive={on ? c : (rest.emissive ?? "#000000")} emissiveIntensity={on ? 1.1 : (rest.emissiveIntensity ?? 0)} />;
}

function Inst({ pts, children, cast = true }: { pts: [number, number, number][]; children: React.ReactNode; cast?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    pts.forEach((p, i) => { o.position.set(p[0], p[1], p[2]); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.instanceMatrix.needsUpdate = true;
  }, [pts]);
  return <instancedMesh ref={ref} args={[undefined, undefined, pts.length]} castShadow={cast} receiveShadow>{children}</instancedMesh>;
}

// ---------------------------------------------------------------------------------------------
// Cable stays as thin lines; the one mapped stay (cable_c6) is also a real mesh so it can be highlighted individually.
const C6 = { tx: 22, j: 5, side: 1 };
function cableEnds(tx: number, j: number, side: number, toward: "main" | "back") {
  const ay = 29.5 - j * 1.4;
  const toMain = tx < 0 ? 1 : -1;
  const dx = toward === "main" ? toMain * (3.5 + j * 1.95) : -toMain * (3.5 + j * 3.7);
  return { a: new THREE.Vector3(tx, ay, side * LEG_Z), b: new THREE.Vector3(tx + dx, 0.3, side * 3.3) };
}

function Cables() {
  const geom = useMemo(() => {
    const pts: number[] = [];
    for (const tx of TOWER_X) for (const side of [-1, 1]) for (let j = 0; j < 11; j++) for (const w of ["main", "back"] as const) {
      const { a, b } = cableEnds(tx, j, side, w);
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
    return g;
  }, []);
  const c6 = useMemo(() => {
    const { a, b } = cableEnds(C6.tx, C6.j, C6.side, "main");
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return { mid, q, len: a.distanceTo(b) };
  }, []);
  return (
    <group>
      <lineSegments geometry={geom}><lineBasicMaterial color="#ffe2c4" transparent opacity={0.85} /></lineSegments>
      <mesh position={c6.mid} quaternion={c6.q} castShadow><cylinderGeometry args={[0.2, 0.2, c6.len, 8]} /><M id="cable_c6" color="#dbe6f5" roughness={0.4} metalness={0.4} /></mesh>
    </group>
  );
}

function Tower({ x, id, topId }: { x: number; id: string; topId?: string }) {
  // legs are split so the very top of a tower (anemometer mast) can be its own highlightable component
  return (
    <group position={[x, 0, 0]}>
      {[-LEG_Z, LEG_Z].map((z) => (
        <group key={z}>
          <mesh position={[0, 12, z]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow><cylinderGeometry args={[0.924, 1.35, 24, 4, 1]} /><M id={id} color="#dfe6f1" roughness={0.55} /></mesh>
          <mesh position={[0, 27.5, z]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow><cylinderGeometry args={[0.8, 0.924, 7, 4, 1]} /><M id={topId ?? id} color="#dfe6f1" roughness={0.55} /></mesh>
          <mesh position={[0, 31.4, z]}><boxGeometry args={[0.9, 0.7, 0.9]} /><meshStandardMaterial color="#ff5a47" emissive="#ff5a47" emissiveIntensity={0.9} /></mesh>
        </group>
      ))}
      {[24.5, 17.5].map((y) => <mesh key={y} position={[0, y, 0]} castShadow><boxGeometry args={[1.2, 1.0, LEG_Z * 2]} /><M id={id} color="#cdd6e3" roughness={0.6} /></mesh>)}
      <mesh position={[0, 11, 0]} castShadow><boxGeometry args={[1.4, 1.2, LEG_Z * 2 + 0.6]} /><M id={id} color="#c3ccda" roughness={0.6} /></mesh>
    </group>
  );
}

/** Pier of the tower foundation (separate component from the tower above it). */
function TowerPier({ x, id }: { x: number; id: string }) {
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, WATER_Y / 2 - 0.4, 0]} castShadow receiveShadow><boxGeometry args={[4.6, -WATER_Y - 0.8, 10]} /><M id={id} color="#b9c3d1" roughness={0.85} /></mesh>
      <mesh position={[0, WATER_Y + 0.8, 0]} castShadow receiveShadow><boxGeometry args={[9.5, 1.6, 16]} /><M id={id} color="#8f9aa9" roughness={0.9} /></mesh>
      {[-1, 1].map((s) => <mesh key={s} position={[0, -1.3, s * 3.6]} castShadow><boxGeometry args={[3.2, 0.7, 1.2]} /><M id={id} color="#6f7a89" roughness={0.6} metalness={0.3} /></mesh>)}
    </group>
  );
}

// Deck segments: the slab is cut at these x positions so a sensor's own stretch of deck can be highlighted.
const DECK_CUTS = [-66, -30, -10, 10, 18, 32, 66];
const DECK_IDS: (string | undefined)[] = ["deck_s1", "deck_q1", "deck_mid", undefined, "deck_p2", undefined];
const GIRDER_CUTS = [-66, 2, 16, 66];
const GIRDER_IDS: (string | undefined)[] = [undefined, "girder_mid", undefined];

function Deck() {
  const dashes = useMemo<[number, number, number][]>(() => Array.from({ length: 30 }, (_, i) => [-63 + i * 4.35, 0.075, 0]), []);
  const lamps = useMemo(() => Array.from({ length: 22 }, (_, i) => -63 + i * 6), []);
  const lampPts = useMemo<[number, number, number][]>(() => lamps.flatMap((x) => [-3.85, 3.85].map((z) => [x, 2.4, z] as [number, number, number])), [lamps]);
  const lampHeads = useMemo<[number, number, number][]>(() => lamps.flatMap((x) => [-3.85, 3.85].map((z) => [x, 3.95, z] as [number, number, number])), [lamps]);
  const posts = useMemo<[number, number, number][]>(() => Array.from({ length: 43 }, (_, i) => -63 + i * 3).flatMap((x) => [-3.85, 3.85].map((z) => [x, 1.0, z] as [number, number, number])), []);
  const beams = useMemo<[number, number, number][]>(() => Array.from({ length: 43 }, (_, i) => [-63 + i * 3, -1.0, 0]), []);
  return (
    <group>
      {DECK_IDS.map((id, i) => {
        const x0 = DECK_CUTS[i], x1 = DECK_CUTS[i + 1], w = x1 - x0, cx = (x0 + x1) / 2;
        return (
          <group key={i} position={[cx, 0, 0]}>
            <mesh position={[0, -0.4, 0]} castShadow receiveShadow><boxGeometry args={[w, 0.8, 8]} /><M id={id} color="#8d97a6" roughness={0.85} /></mesh>
            <mesh position={[0, 0.03, 0]} receiveShadow><boxGeometry args={[w, 0.06, 7.2]} /><M id={id} color="#2f353f" roughness={0.95} /></mesh>
            {[-3.85, 3.85].map((z) => <mesh key={z} position={[0, 0.3, z]} castShadow><boxGeometry args={[w, 0.6, 0.3]} /><M id={id} color="#c3cbd8" roughness={0.7} /></mesh>)}
          </group>
        );
      })}
      {GIRDER_IDS.map((id, i) => {
        const x0 = GIRDER_CUTS[i], x1 = GIRDER_CUTS[i + 1];
        return [-3, 3].map((z) => <mesh key={`${i}${z}`} position={[(x0 + x1) / 2, -1.35, z]} castShadow receiveShadow><boxGeometry args={[x1 - x0, 1.3, 0.5]} /><M id={id} color="#7d8797" roughness={0.8} /></mesh>);
      })}
      <Inst pts={beams}><boxGeometry args={[0.35, 0.8, 6.4]} /><meshStandardMaterial color="#737d8c" roughness={0.85} /></Inst>
      {/* railings: posts + two rails each side */}
      <Inst pts={posts}><boxGeometry args={[0.1, 1.0, 0.1]} /><meshStandardMaterial color="#b4becd" roughness={0.5} metalness={0.5} /></Inst>
      {[-3.85, 3.85].map((z) => [0.95, 0.6].map((y) => <mesh key={`${z}${y}`} position={[0, y, z]}><boxGeometry args={[132, 0.06, 0.06]} /><meshStandardMaterial color="#cfd8e5" roughness={0.4} metalness={0.6} /></mesh>))}
      {[-3.85, 3.85].map((z) => <mesh key={"e" + z} position={[0, 1.02, z]}><boxGeometry args={[132, 0.04, 0.1]} /><meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={1.2} /></mesh>)}
      <Inst pts={dashes} cast={false}><boxGeometry args={[2.2, 0.02, 0.18]} /><meshStandardMaterial color="#e8edf4" /></Inst>
      {[-3.2, 3.2].map((z) => <mesh key={"l" + z} position={[0, 0.07, z * 0.7]}><boxGeometry args={[132, 0.02, 0.1]} /><meshStandardMaterial color="#e8edf4" opacity={0.55} transparent /></mesh>)}
      <Inst pts={lampPts}><cylinderGeometry args={[0.07, 0.09, 3, 6]} /><meshStandardMaterial color="#aab4c3" /></Inst>
      <Inst pts={lampHeads} cast={false}><boxGeometry args={[0.35, 0.12, 0.35]} /><meshStandardMaterial color="#fff2cc" emissive="#ffb255" emissiveIntensity={3.2} toneMapped={false} /></Inst>
    </group>
  );
}

function Piers() {
  // side-span piers: only the approach structure; the component-mapped pier belongs to a tower
  return (
    <group>
      {[-44, 44].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, WATER_Y / 2 - 0.4, 0]} castShadow receiveShadow><boxGeometry args={[2.6, -WATER_Y - 0.8, 6.2]} /><meshStandardMaterial color="#b0bac8" roughness={0.85} /></mesh>
          <mesh position={[0, -1.4, 0]} castShadow><boxGeometry args={[3.6, 0.9, 7.8]} /><meshStandardMaterial color="#9aa5b4" roughness={0.85} /></mesh>
        </group>
      ))}
    </group>
  );
}

/** Terrain: sloped embankments carrying the approach road to each end of the bridge, rocky shore, and the river. */
function Terrain() {
  const water = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = water.current?.material as THREE.MeshStandardMaterial | undefined;
    if (m) m.emissiveIntensity = 0.14 + Math.sin(clock.elapsedTime * 0.6) * 0.04;
  });
  const bank = useMemo(() => {
    const sh = new THREE.Shape();
    sh.moveTo(64, WATER_Y - 2); sh.lineTo(64, -0.25); sh.lineTo(112, -0.25); sh.lineTo(150, -9); sh.lineTo(190, WATER_Y - 2); sh.closePath();
    return new THREE.ExtrudeGeometry(sh, { depth: 150, bevelEnabled: false });
  }, []);
  const hills = useMemo<[number, number, number, number][]>(() => [[170, -3, -70, 26], [185, -2, 55, 34], [150, 1, -48, 18]], []);
  return (
    <group>
      <mesh ref={water} rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_Y, 0]} receiveShadow>
        <planeGeometry args={[620, 620]} />
        <meshStandardMaterial color="#0c1a38" emissive="#1b2a5c" emissiveIntensity={0.16} roughness={0.7} metalness={0.05} />
      </mesh>
      <gridHelper args={[620, 124, "#14405f", "#0c2a42"]} position={[0, WATER_Y + 0.03, 0]} />
      {[1, -1].map((s) => (
        <group key={s} rotation={[0, s === 1 ? 0 : Math.PI, 0]}>
          <mesh geometry={bank} position={[0, 0, -75]} receiveShadow castShadow><meshStandardMaterial color="#1a2a23" roughness={1} /></mesh>
          {/* approach road on the embankment */}
          <mesh position={[88, -0.1, 0]} receiveShadow><boxGeometry args={[48, 0.2, 7.2]} /><meshStandardMaterial color="#2f353f" roughness={0.95} /></mesh>
          <mesh position={[88, 0.02, 0]}><boxGeometry args={[48, 0.02, 0.12]} /><meshStandardMaterial color="#e8edf4" /></mesh>
          {[-3.85, 3.85].map((z) => <mesh key={z} position={[88, 0.35, z]} castShadow><boxGeometry args={[48, 0.7, 0.3]} /><meshStandardMaterial color="#aeb7c4" roughness={0.8} /></mesh>)}
          {/* abutment under the end of the deck */}
          <mesh position={[65, -7, 0]} castShadow receiveShadow><boxGeometry args={[3, 13, 9]} /><meshStandardMaterial color="#9aa5b4" roughness={0.9} /></mesh>
          {hills.map(([x, y, z, r], i) => <mesh key={i} position={[x, y - 6, z]} receiveShadow castShadow scale={[1.4, 0.5, 1]}><sphereGeometry args={[r, 20, 12]} /><meshStandardMaterial color="#16221d" roughness={1} /></mesh>)}
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Twilight environment: gradient sky, distant city skyline with lit windows, and the river banks they stand on.
const SKY_VERT = "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }";
const SKY_FRAG = `varying vec3 vP;
  void main(){
    float h = clamp(vP.y, -0.1, 1.0);
    vec3 deep = vec3(0.012, 0.02, 0.06), mid = vec3(0.10, 0.075, 0.2), glow = vec3(0.62, 0.26, 0.14);
    vec3 c = mix(glow, mid, smoothstep(0.0, 0.12, h));
    c = mix(c, deep, smoothstep(0.04, 0.26, h));
    float sunSide = pow(max(dot(normalize(vec3(vP.x, 0.0, vP.z)), normalize(vec3(-0.8, 0.0, -0.6))), 0.0), 6.0);
    c += vec3(0.35, 0.14, 0.05) * sunSide * (1.0 - smoothstep(0.0, 0.2, h));
    gl_FragColor = vec4(c, 1.0);
  }`;

function Sky() {
  return (
    <mesh renderOrder={-1}>
      <sphereGeometry args={[800, 32, 16]} />
      <shaderMaterial vertexShader={SKY_VERT} fragmentShader={SKY_FRAG} side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  );
}

function rng(seed: number) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function windowTexture() {
  const c = document.createElement("canvas");
  c.width = 16; c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000"; g.fillRect(0, 0, 16, 32);
  const r = rng(7);
  for (let y = 0; y < 32; y += 2) for (let x = 0; x < 16; x += 2) {
    if (r() < 0.42) { const k = r(); g.fillStyle = k < 0.6 ? "#ffcf8a" : k < 0.85 ? "#fff1d0" : "#8fd3ff"; g.fillRect(x, y, 1, 1); }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function City() {
  const tex = useMemo(() => windowTexture(), []);
  const items = useMemo(() => {
    const r = rng(2026);
    const out: { p: [number, number, number]; s: [number, number, number] }[] = [];
    const add = (x: number, z: number, hMax: number) => {
      const w = 8 + r() * 16, d = 8 + r() * 16, h = 10 + Math.pow(r(), 2.4) * hMax;
      out.push({ p: [x, -13.5, z], s: [w, h, d] });
    };
    for (let i = 0; i < 230; i++) add((r() < 0.5 ? -1 : 1) * (235 + r() * 230), (r() - 0.5) * 620, 62);   // riverside districts left and right
    for (let i = 0; i < 90; i++) add((r() - 0.5) * 820, (r() < 0.5 ? -1 : 1) * (360 + r() * 150), 80);                     // far skyline across the water
    return out;
  }, []);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    items.forEach((b, i) => { o.position.set(b.p[0], b.p[1] + b.s[1] / 2, b.p[2]); o.scale.set(...b.s); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.instanceMatrix.needsUpdate = true;
  }, [items]);
  return (
    <group>
      {[-1, 1].map((s) => <mesh key={s} position={[s * 330, -14, 0]}><boxGeometry args={[280, 1, 760]} /><meshStandardMaterial color="#120f1d" roughness={1} /></mesh>)}
      {[-1, 1].map((s) => <mesh key={"b" + s} position={[0, -14, s * 450]}><boxGeometry args={[1000, 1, 220]} /><meshStandardMaterial color="#120f1d" roughness={1} /></mesh>)}
      <instancedMesh ref={ref} args={[undefined, undefined, items.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#12111f" roughness={0.85} metalness={0.15} emissive="#ffffff" emissiveMap={tex} emissiveIntensity={1.15} />
      </instancedMesh>
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
/** Anomaly effect at a flagged sensor: expanding ring along the deck, glowing core, rising beam and a pulsing light.
 *  Colour follows the backend-computed sensor state (amber = investigate / observe, red = escalation, violet = data quality). */
const FX_COLOR: Record<string, string> = { investigate: "#ffb020", observation: "#ffb020", escalation: "#ff4a3a", data_quality: "#a78bfa" };
function AnomalyFx({ s, selected }: { s: SensorState; selected: boolean }) {
  const p = POS3D[s.sensor_id];
  const ring = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const col = useMemo(() => new THREE.Color(FX_COLOR[s.state] ?? "#ffb020").multiplyScalar(2.2), [s.state]);
  const strong = s.state === "investigate" || s.state === "escalation";
  const phase = useMemo(() => (s.sensor_id.charCodeAt(4) % 7) / 7, [s.sensor_id]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const k = (t * (strong ? 0.8 : 0.5) + phase) % 1;
    if (ring.current) { ring.current.scale.setScalar(1 + k * (selected ? 7 : 5)); (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - k) * (strong ? 0.85 : 0.5); }
    if (core.current) core.current.scale.setScalar(1 + Math.sin(t * (strong ? 4 : 2) + phase * 6) * 0.25);
    if (beam.current) (beam.current.material as THREE.MeshBasicMaterial).opacity = (strong ? 0.38 : 0.18) + Math.sin(t * 2.4 + phase * 6) * 0.08;
    if (light.current) light.current.intensity = (strong ? 90 : 35) * (0.7 + 0.3 * Math.sin(t * 3 + phase * 6));
  });
  if (!p) return null;
  const mat = { color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false } as const;
  return (
    <group position={p}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.85, 1.0, 56]} /><meshBasicMaterial {...mat} opacity={0.6} side={THREE.DoubleSide} /></mesh>
      <mesh ref={core}><sphereGeometry args={[0.45, 16, 12]} /><meshBasicMaterial {...mat} opacity={0.85} /></mesh>
      <mesh ref={beam} position={[0, 6.5, 0]}><cylinderGeometry args={[0.05, 0.28, 13, 10, 1, true]} /><meshBasicMaterial {...mat} opacity={0.3} side={THREE.DoubleSide} /></mesh>
      <pointLight ref={light} color={col} distance={22} decay={2} intensity={40} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
/** Bloom via three's bundled post-processing passes (no extra dependency). */
function PostFx() {
  const { gl, scene, camera, size } = useThree();
  const composer = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(size.width, size.height, { type: THREE.HalfFloatType, samples: 4 });
    const c = new EffectComposer(gl, target);
    c.addPass(new RenderPass(scene, camera));
    c.addPass(new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.45, 0.4, 0.9));
    c.addPass(new OutputPass());
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the renderer / scene / camera change; size is applied below
  }, [gl, scene, camera]);
  useEffect(() => { composer.setPixelRatio(gl.getPixelRatio()); composer.setSize(size.width, size.height); }, [composer, gl, size]);
  useEffect(() => () => composer.dispose(), [composer]);
  useFrame(() => composer.render(), 1);
  return null;
}

// ---------------------------------------------------------------------------------------------
/** Projects each sensor's 3D position to screen space every frame and moves the matching DOM marker.
 *  Markers are ordinary React DOM (accessible buttons) rendered outside the canvas; no per-frame React renders. */
function MarkerProjector({ sensors, els }: { sensors: SensorState[]; els: React.MutableRefObject<Map<string, HTMLElement>> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const s of sensors) {
      const el = els.current.get(s.sensor_id);
      const p = POS3D[s.sensor_id];
      if (!el || !p) continue;
      v.set(p[0], p[1], p[2]).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
      el.style.display = visible ? "" : "none";
      if (!visible) continue;
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      el.style.zIndex = String(Math.round((1 - v.z) * 5000));
    }
  });
  return null;
}

function Rig({ api, goal }: { api: React.MutableRefObject<ViewApi | null>; goal: React.MutableRefObject<THREE.Vector3 | null> }) {
  const { camera, controls } = useThree();
  const ctl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- imperative view handle exposed to the toolbar
    api.current = {
      reset: () => {
        goal.current = null;
        camera.position.copy(HOME_POS);
        if (ctl) { ctl.target.copy(HOME_TARGET); ctl.update(); }
      },
      zoom: (f) => {
        if (!ctl) return;
        const off = camera.position.clone().sub(ctl.target);
        const len = THREE.MathUtils.clamp(off.length() * f, 30, 280);
        camera.position.copy(ctl.target.clone().add(off.setLength(len)));
        ctl.update();
      },
    };
  }, [api, camera, ctl, goal]);
  const intro = useRef<boolean>(true);
  useFrame(() => {
    if (!intro.current) return;
    camera.position.lerp(HOME_POS, 0.035);
    if (camera.position.distanceTo(HOME_POS) < 0.6) intro.current = false;
  });
  useEffect(() => {
    const c = controls as unknown as THREE.EventDispatcher<{ start: object }> | null;
    const stop = () => { intro.current = false; };
    c?.addEventListener("start", stop);
    camera.position.copy(HOME_POS).multiplyScalar(1.45).setY(HOME_POS.y * 0.7);
    return () => c?.removeEventListener("start", stop);
  }, [camera, controls]);
  useFrame(() => {
    const g = goal.current;
    if (!g || !ctl) return;
    ctl.target.lerp(g, 0.1);
    ctl.update();
    // eslint-disable-next-line react-hooks/immutability -- refs shared with the scene are intentionally mutable
    if (ctl.target.distanceTo(g) < 0.05) goal.current = null;
  });
  return null;
}

export default function BridgeScene({ sensors, selected, highlight, markerEls, api, panMode }: {
  sensors: SensorState[]; selected: string | null; highlight: { id: string | null; kind: HighlightKind };
  markerEls: React.MutableRefObject<Map<string, HTMLElement>>; api: React.MutableRefObject<ViewApi | null>; panMode: boolean;
}) {
  const goal = useRef<THREE.Vector3 | null>(null);
  useEffect(() => {
    const p = selected ? POS3D[selected] : null;
    goal.current = p ? new THREE.Vector3(...p).multiplyScalar(0.45).add(HOME_TARGET.clone().multiplyScalar(0.55)) : null;
  }, [selected]);
  const clampTarget = (e?: { target?: { target: THREE.Vector3 } }) => {
    const t = e?.target?.target;
    if (!t) return;
    t.x = THREE.MathUtils.clamp(t.x, -90, 90);
    t.y = THREE.MathUtils.clamp(t.y, -4, 40);
    t.z = THREE.MathUtils.clamp(t.z, -40, 40);
  };
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: HOME_POS.toArray(), fov: 40, near: 0.5, far: 1000 }} gl={{ antialias: true, powerPreference: "high-performance", toneMappingExposure: 1.05 }}
      aria-label="Interactive 3D model of the simulated cable-stayed bridge">
      <color attach="background" args={["#0a0817"]} />
      <fogExp2 attach="fog" args={["#15112b", 0.0027]} />
      <Sky />
      <hemisphereLight args={["#5a5090", "#120d1c", 0.42]} />
      <ambientLight intensity={0.16} color="#8d7fc0" />
      {/* low warm key from the setting sun, cool sky fill from the opposite side */}
      <directionalLight position={[-120, 42, -80]} intensity={1.7} color="#ff9a5c" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-115} shadow-camera-right={115} shadow-camera-top={65} shadow-camera-bottom={-45} shadow-camera-near={10} shadow-camera-far={340} />
      <directionalLight position={[90, 60, 110]} intensity={0.45} color="#6f8fe0" />
      <City />
      <HlCtx.Provider value={highlight}>
        <Terrain />
        <Deck />
        <Piers />
        <Tower x={-22} id="tower_1" topId="tower_1_top" />
        <Tower x={22} id="tower_2" />
        <TowerPier x={-22} id="pier_1" />
        <TowerPier x={22} id="pier_2" />
        <Cables />
      </HlCtx.Provider>
      {sensors.filter((x) => x.state !== "normal").map((x) => <AnomalyFx key={x.sensor_id} s={x} selected={selected === x.sensor_id} />)}
      <MarkerProjector sensors={sensors} els={markerEls} />
      <PostFx />
      <OrbitControls makeDefault enableDamping dampingFactor={0.09} target={HOME_TARGET.toArray()} minDistance={30} maxDistance={280}
        maxPolarAngle={Math.PI / 2 - 0.04} rotateSpeed={0.6} zoomSpeed={0.7} panSpeed={0.9} screenSpacePanning onChange={clampTarget}
        mouseButtons={{ LEFT: panMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: panMode ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN }}
        touches={{ ONE: panMode ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
      <Rig api={api} goal={goal} />
    </Canvas>
  );
}
