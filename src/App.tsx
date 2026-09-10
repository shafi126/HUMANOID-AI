import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { RefObject } from "react";

import {
  Canvas,
  useFrame,
  useLoader,
  useThree,
} from "@react-three/fiber";

import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import * as THREE from "three";

import "./App.css";

/* =========================================================
   ULTRON
   ========================================================= */

const BODY_COUNT = 140000;
const HAIR_COUNT = 200000;
const HEART_COUNT = 20000;
const AMBIENT_COUNT = 1800;

/* =========================================================
   SHADERS
   ========================================================= */

const BODY_VERTEX_SHADER = `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
uniform float uMotion;
uniform vec2 uMouse;
uniform float uFragment;
uniform vec2 uPointer;
uniform float uInteraction;
uniform float uPointerSpeed;

attribute vec3 aScatter;
attribute float aSeed;

varying vec3 vColor;
varying float vAlpha;
varying float vEnergy;
varying float vDepth;
varying float vFragment;

void main() {
  vec3 p = position;

  float breath = sin(uTime * 0.9 + p.y * 2.0) * 0.0035;
  float micro = sin(uTime * 2.1 + p.x * 11.0 + p.z * 7.0) * 0.0012;

  p += vec3(micro, breath, micro * 0.7) * (0.35 + uMotion * 0.65);

  vec2 mousePoint = vec2(uMouse.x * 2.15, uMouse.y * 2.35);
  vec2 delta = p.xy - mousePoint;
  float distanceToInput = length(delta);
  float influence = 1.0 - smoothstep(0.05, 0.72, distanceToInput);

  vec2 safeDirection = distanceToInput > 0.001
    ? normalize(delta)
    : vec2(0.0, 1.0);

  p.xy += safeDirection * influence * 0.045 * uMotion;
  p.z += influence * 0.035 * uMotion;

  /*
   * Cursor energy field.
   * Nearby particles are gently repelled.
   * Faster pointer movement increases the force.
   */
  vec2 pointerPoint =
    vec2(
      uPointer.x * 2.15,
      uPointer.y * 2.35
    );

  vec2 pointerDelta =
    p.xy - pointerPoint;

  float pointerDistance =
    length(pointerDelta);

  float pointerField =
    1.0 -
    smoothstep(
      0.02,
      0.70,
      pointerDistance
    );

  vec2 pointerDirection =
    pointerDistance > 0.001
      ? normalize(pointerDelta)
      : vec2(0.0, 1.0);

  float pointerForce =
    pointerField *
    uInteraction *
    (
      0.075 +
      uPointerSpeed * 0.13
    );

  p.xy +=
    pointerDirection *
    pointerForce;

  p.z +=
    pointerField *
    uInteraction *
    (
      0.025 +
      uPointerSpeed * 0.08
    );

  /* Cinematic dissolve: preserve a dense humanoid core while particles peel away. */
  float f = smoothstep(0.0, 1.0, uFragment);
  float eased = f * f * (3.0 - 2.0 * f);

  /* Most particles remain close to the original surface. */
  float release = 0.20 + 0.80 * smoothstep(0.0, 1.0, aSeed);

  /* Keep the upper body/face especially recognizable. */
  float upperPreserve = 1.0 - smoothstep(0.45, 1.35, position.y);
  release *= mix(1.0, 0.82, upperPreserve);

  vec3 radial = normalize(aScatter + normalize(position) * 0.20);
  vec3 tangent = normalize(vec3(-radial.y, radial.x, radial.z * 0.16));

  float haloDistance =
    (0.06 + aSeed * 0.52) * release * eased;

  float swirl =
    sin(uTime * 0.9 + aSeed * 21.0 + position.y * 3.0) *
    0.045 * release * eased;

  p += radial * haloDistance;
  p += tangent * swirl;

  p.y +=
    (0.015 + aSeed * 0.035) * release * eased;

  p.z +=
    sin(uTime * 0.65 + aSeed * 16.0) *
    0.03 * release * eased;

  vFragment = eased;
  vEnergy = influence;
  vDepth = smoothstep(-0.08, 0.20, p.z);

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);

  gl_PointSize = uSize * uPixelRatio * (300.0 / max(1.0, -mvPosition.z));
  gl_Position = projectionMatrix * mvPosition;

  vColor = color;

  /* Use the original surface position for the silhouette, not the halo position. */
  float centerDistance = length(position.xy);
  float silhouette = smoothstep(2.4, 0.0, centerDistance);

  /* Keep the attached layer clearly visible throughout the dissolve. */
  float attachedAlpha = 0.88 + 0.10 * silhouette;
  float haloAlpha = 0.58 + 0.10 * silhouette;

  vAlpha = mix(
    attachedAlpha,
    haloAlpha,
    release * eased
  );
}
`;

const BODY_FRAGMENT_SHADER = `
varying vec3 vColor;
varying float vAlpha;
varying float vEnergy;
varying float vDepth;
varying float vFragment;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);

  if (d > 0.5) discard;

  float glow = smoothstep(0.5, 0.0, d);
  float core = smoothstep(0.19, 0.0, d);

  float energy = vEnergy * 0.9 + vDepth * 0.22 + vFragment * 0.28;

  vec3 finalColor = vColor * (
    0.42 +
    glow * 0.42 +
    core * 1.35 +
    energy * 0.75
  );

  gl_FragColor = vec4(
    finalColor,
    glow * vAlpha * (0.72 + energy * 0.20)
  );
}
`;

/* =========================================================
   HEART SHADER
   ========================================================= */

const HEART_VERTEX_SHADER = `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
uniform float uPulse;
uniform float uFragment;
uniform float uInteraction;
uniform float uPointerSpeed;

attribute vec3 aScatter;
attribute float aSeed;

varying vec3 vColor;
varying float vAlpha;
varying float vFragment;

void main() {
  vec3 p = position;

  float beat = max(0.0, sin(uTime * 3.0));
  float echo = max(0.0, sin(uTime * 3.0 - 0.85));
  float pulse = 1.0 + (beat * 0.035 + echo * 0.012) * uPulse;

  p *= pulse;
  p.x += sin(p.y * 7.0 + uTime * 1.5) * 0.003;

  p.z +=
    sin(uTime * 4.0) *
    uInteraction *
    0.02;

  p.xy *=
    1.0 +
    uPointerSpeed * 0.015;

  float f = smoothstep(0.0, 1.0, uFragment);
  float eased = f * f * (3.0 - 2.0 * f);

  vec3 radial = normalize(aScatter + normalize(p) * 0.25);
  float burstDistance = 0.18 + aSeed * 0.65;

  p += radial * burstDistance * eased;

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);

  gl_PointSize = uSize * uPixelRatio * (300.0 / max(1.0, -mvPosition.z));
  gl_Position = projectionMatrix * mvPosition;

  vColor = color;
  vAlpha = 1.0;
  vFragment = eased;
}
`;

const HEART_FRAGMENT_SHADER = `
varying vec3 vColor;
varying float vAlpha;
varying float vFragment;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);

  if (d > 0.5) discard;

  float glow = smoothstep(0.5, 0.0, d);
  float core = smoothstep(0.16, 0.0, d);

  vec3 finalColor = vColor * (
    0.80 +
    glow * 1.35 +
    core * 2.10 +
    vFragment * 0.35
  );

  gl_FragColor = vec4(
    finalColor,
    glow * vAlpha * 0.92
  );
}
`;

/* =========================================================
   AMBIENT SHADER
   ========================================================= */

const AMBIENT_VERTEX_SHADER = `
uniform float uTime;
uniform float uPixelRatio;

attribute float aSize;
attribute float aSpeed;

varying float vAlpha;

void main() {
  vec3 p = position;

  p.y += sin(uTime * aSpeed + position.x * 2.5) * 0.035;
  p.x += cos(uTime * aSpeed * 0.7 + position.z * 2.0) * 0.025;

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);

  gl_PointSize = aSize * uPixelRatio * (100.0 / max(1.0, -mvPosition.z));
  gl_Position = projectionMatrix * mvPosition;

  vAlpha = 0.12 + 0.22 * (0.5 + 0.5 * sin(uTime * aSpeed));
}
`;

const AMBIENT_FRAGMENT_SHADER = `
uniform vec3 uColor;

varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);

  if (d > 0.5) discard;

  float glow = smoothstep(0.5, 0.0, d);

  gl_FragColor = vec4(
    uColor,
    glow * vAlpha
  );
}
`;

/* =========================================================
   COLORS
   ========================================================= */

function getHeartColor(
  index: number,
  total: number
): THREE.Color {

  const t =
    index /
    Math.max(
      1,
      total - 1
    );

  const red =
    new THREE.Color(
      "#ff1744"
    );

  const crimson =
    new THREE.Color(
      "#ff315f"
    );

  const pink =
    new THREE.Color(
      "#ff6b9a"
    );

  const result =
    new THREE.Color();

  if (
    t <
    0.65
  ) {

    result.lerpColors(
      red,
      crimson,
      t / 0.65
    );

  } else {

    result.lerpColors(
      crimson,
      pink,
      (
        t -
        0.65
      ) /
        0.35
    );
  }

  return result;
}

/* =========================================================
   INPUT
   ========================================================= */

type InputState = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
};

type GyroState = {
  x: number;
  y: number;
};

function useSharedInput() {

  const [
    motionEnabled,
    setMotionEnabled,
  ] =
    useState(false);

  const input =
    useRef<InputState>({
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
    });

  const gyro =
    useRef<GyroState>({
      x: 0,
      y: 0,
    });

  const interaction =
    useRef({
      x: 0,
      y: 0,
      strength: 0,
      speed: 0,
    });

  const lastPointer =
    useRef({ x: 0, y: 0 });

  const lastPointerTime =
    useRef(performance.now());

  /*
   * Desktop mouse.
   */
  useEffect(() => {

    const handleMouseMove =
      (
        event: MouseEvent
      ) => {
        const x =
          (event.clientX /
            window.innerWidth) *
            2 -
          1;

        const y =
          -(
            (event.clientY /
              window.innerHeight) *
              2 -
            1
          );

        const now = performance.now();
        const dt = Math.max(
          1,
          now - lastPointerTime.current
        );

        const dx =
          x - lastPointer.current.x;
        const dy =
          y - lastPointer.current.y;

        const speed = Math.min(
          1,
          Math.sqrt(dx * dx + dy * dy) /
            (dt / 16.67)
        );

        input.current.targetX = x;
        input.current.targetY = y;

        interaction.current.x = x;
        interaction.current.y = y;
        interaction.current.speed = speed;

        lastPointer.current.x = x;
        lastPointer.current.y = y;
        lastPointerTime.current = now;
      };

    window.addEventListener(
      "mousemove",
      handleMouseMove
    );

    return () => {

      window.removeEventListener(
        "mousemove",
        handleMouseMove
      );

    };

  }, []);

  /*
   * Smooth mouse interpolation.
   *
   * This deliberately uses requestAnimationFrame
   * rather than useFrame because this hook is called
   * outside the R3F Canvas.
   */
  useEffect(() => {

    let animationFrame =
      0;

    const update =
      () => {

        input.current.x +=
          (
            input.current.targetX -
            input.current.x
          ) *
          0.08;

        input.current.y +=
          (
            input.current.targetY -
            input.current.y
          ) *
          0.08;

        const pointerDistance =
          Math.sqrt(
            input.current.x *
              input.current.x +
            input.current.y *
              input.current.y
          );

        const proximity =
          1 -
          THREE.MathUtils.clamp(
            pointerDistance / 1.2,
            0,
            1
          );

        interaction.current.strength =
          THREE.MathUtils.lerp(
            interaction.current.strength,
            proximity,
            0.08
          );

        interaction.current.speed =
          THREE.MathUtils.lerp(
            interaction.current.speed,
            0,
            0.05
          );

        animationFrame =
          requestAnimationFrame(
            update
          );
      };

    animationFrame =
      requestAnimationFrame(
        update
      );

    return () => {

      cancelAnimationFrame(
        animationFrame
      );

    };

  }, []);

  /*
   * Device orientation.
   */
  useEffect(() => {

    if (
      !motionEnabled
    ) {
      return;
    }

    const handleOrientation =
      (
        event: DeviceOrientationEvent
      ) => {

        const gamma =
          event.gamma ??
          0;

        const beta =
          event.beta ??
          0;

        gyro.current.x =
          THREE.MathUtils.clamp(
            gamma /
              30,
            -1,
            1
          );

        gyro.current.y =
          THREE.MathUtils.clamp(
            (
              beta -
              45
            ) /
              30,
            -1,
            1
          );
      };

    window.addEventListener(
      "deviceorientation",
      handleOrientation
    );

    return () => {

      window.removeEventListener(
        "deviceorientation",
        handleOrientation
      );

    };

  }, [
    motionEnabled,
  ]);

  /*
   * Enable device motion.
   */
  const enableMotion =
    async () => {

      const OrientationEvent =
        DeviceOrientationEvent as typeof DeviceOrientationEvent & {
          requestPermission?: () =>
            Promise<
              "granted" |
              "denied"
            >;
        };

      if (
        typeof OrientationEvent.requestPermission ===
        "function"
      ) {

        try {

          const permission =
            await OrientationEvent.requestPermission();

          if (
            permission !==
            "granted"
          ) {
            return;
          }

        } catch {

          return;

        }
      }

      setMotionEnabled(
        true
      );
    };

  return {
    input,
    gyro,
    interaction,
    motionEnabled,
    enableMotion,
  };
}

/* =========================================================
   TRIANGLE PARTICLE SAMPLING
   ========================================================= */

type Triangle = [
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3
];

type SurfaceMode =
  | "body"
  | "hair"
  | "heart";

function buildSurfaceParticles(
  object: THREE.Object3D,
  count: number,
  mode: SurfaceMode,
  targetSize: number
): THREE.BufferGeometry {

  const triangles: Triangle[] =
    [];

  const a =
    new THREE.Vector3();

  const b =
    new THREE.Vector3();

  const c =
    new THREE.Vector3();

  /*
   * Make sure child world matrices
   * are up to date.
   */
  object.updateMatrixWorld(
    true
  );

  /*
   * Extract every triangle.
   */
  object.traverse(
    (child) => {

      if (
        !(child instanceof THREE.Mesh)
      ) {
        return;
      }

      const source =
        child.geometry;

      const position =
        source.attributes
          .position;

      if (!position) {
        return;
      }

      const index =
        source.index;

      /*
       * Indexed geometry.
       */
      if (index) {

        for (
          let i = 0;
          i + 2 <
          index.count;
          i += 3
        ) {

          const ia =
            index.getX(i);

          const ib =
            index.getX(
              i + 1
            );

          const ic =
            index.getX(
              i + 2
            );

          a.fromBufferAttribute(
            position,
            ia
          );

          b.fromBufferAttribute(
            position,
            ib
          );

          c.fromBufferAttribute(
            position,
            ic
          );

          a.applyMatrix4(
            child.matrixWorld
          );

          b.applyMatrix4(
            child.matrixWorld
          );

          c.applyMatrix4(
            child.matrixWorld
          );

          triangles.push([
            a.clone(),
            b.clone(),
            c.clone(),
          ]);
        }

      }

      /*
       * Non-indexed geometry.
       */
      else {

        for (
          let i = 0;
          i + 2 <
          position.count;
          i += 3
        ) {

          a.fromBufferAttribute(
            position,
            i
          );

          b.fromBufferAttribute(
            position,
            i + 1
          );

          c.fromBufferAttribute(
            position,
            i + 2
          );

          a.applyMatrix4(
            child.matrixWorld
          );

          b.applyMatrix4(
            child.matrixWorld
          );

          c.applyMatrix4(
            child.matrixWorld
          );

          triangles.push([
            a.clone(),
            b.clone(),
            c.clone(),
          ]);
        }
      }
    }
  );

  const geometry =
    new THREE.BufferGeometry();

  if (
    triangles.length === 0
  ) {
    return geometry;
  }

  /*
   * Calculate total surface area.
   */
  const cumulative =
    new Float64Array(
      triangles.length
    );

  const edge1 =
    new THREE.Vector3();

  const edge2 =
    new THREE.Vector3();

  const cross =
    new THREE.Vector3();

  let totalArea =
    0;

  for (
    let i = 0;
    i <
    triangles.length;
    i++
  ) {

    const triangle =
      triangles[i];

    edge1.subVectors(
      triangle[1],
      triangle[0]
    );

    edge2.subVectors(
      triangle[2],
      triangle[0]
    );

    cross.crossVectors(
      edge1,
      edge2
    );

    const area =
      cross.length() *
      0.5;

    totalArea +=
      area;

    cumulative[i] =
      totalArea;
  }

  /*
   * Bounds.
   */
  const bounds =
    new THREE.Box3();

  for (
    const triangle of triangles
  ) {

    bounds.expandByPoint(
      triangle[0]
    );

    bounds.expandByPoint(
      triangle[1]
    );

    bounds.expandByPoint(
      triangle[2]
    );
  }

  const center =
    new THREE.Vector3();

  bounds.getCenter(
    center
  );

  const minY =
    bounds.min.y;

  const maxY =
    bounds.max.y;

  const size =
    new THREE.Vector3();

  bounds.getSize(
    size
  );

  const largest =
    Math.max(
      size.x,
      size.y,
      size.z
    );

  /*
   * Normalize human size.
   */
  const scale =
    largest > 0
      ? targetSize / largest
      : 1;

  const positions =
    new Float32Array(
      count * 3
    );

  const colors =
    new Float32Array(
      count * 3
    );

  const scatter =
    new Float32Array(
      count * 3
    );

  const seeds =
    new Float32Array(
      count
    );

  const point =
    new THREE.Vector3();

  /*
   * Generate particles.
   */
  for (
    let i = 0;
    i < count;
    i++
  ) {

    /*
     * Pick triangle based on
     * its surface area.
     */
    const randomValue =
      Math.random() *
      totalArea;

    let low =
      0;

    let high =
      cumulative.length -
      1;

    while (
      low <
      high
    ) {

      const middle =
        Math.floor(
          (
            low +
            high
          ) /
            2
        );

      if (
        cumulative[
          middle
        ] <
        randomValue
      ) {

        low =
          middle +
          1;

      } else {

        high =
          middle;

      }
    }

    const triangle =
      triangles[low];

    /*
     * Uniform barycentric sampling.
     */
    let r1 =
      Math.random();

    let r2 =
      Math.random();

    if (
      r1 +
        r2 >
      1
    ) {

      r1 =
        1 -
        r1;

      r2 =
        1 -
        r2;
    }

    const r3 =
      1 -
      r1 -
      r2;

    point.set(
      triangle[0].x *
          r1 +
        triangle[1].x *
          r2 +
        triangle[2].x *
          r3,

      triangle[0].y *
          r1 +
        triangle[1].y *
          r2 +
        triangle[2].y *
          r3,

      triangle[0].z *
          r1 +
        triangle[1].z *
          r2 +
        triangle[2].z *
          r3
    );

    /*
     * Tiny random surface noise.
     */
    const noise =
      0.0015;

    point.x +=
      (
        Math.random() -
        0.5
      ) *
      noise;

    point.y +=
      (
        Math.random() -
        0.5
      ) *
      noise;

    point.z +=
      (
        Math.random() -
        0.5
      ) *
      noise;

    positions[
      i * 3
    ] =
      (
        point.x -
        center.x
      ) *
      scale;

    positions[
      i * 3 + 1
    ] =
      (
        point.y -
        center.y
      ) *
      scale;

    positions[
      i * 3 + 2
    ] =
      (
        point.z -
        center.z
      ) *
      scale;

    /*
     * Color by actual position rather than particle index.
     * This keeps the color bands spatially coherent.
     */
    const normalizedY =
      THREE.MathUtils.clamp(
        (
          point.y -
          minY
        ) /
          Math.max(
            0.000001,
            maxY - minY
          ),
        0,
        1
      );

    let color: THREE.Color;

    if (mode === "heart") {
      color =
        getHeartColor(
          i,
          count
        );
    } else if (mode === "hair") {
      const cyan =
        new THREE.Color("#00eaff");
      const violet =
        new THREE.Color("#b66cff");

      color =
        new THREE.Color().lerpColors(
          cyan,
          violet,
          normalizedY
        );
    } else {
      const cyan =
        new THREE.Color("#00eaff");
      const gold =
        new THREE.Color("#ffd84d");
      const violet =
        new THREE.Color("#b66cff");

      color =
        new THREE.Color();

      if (normalizedY < 0.45) {
        color.lerpColors(
          cyan,
          gold,
          normalizedY / 0.45
        );
      } else {
        color.lerpColors(
          gold,
          violet,
          (
            normalizedY -
            0.45
          ) /
            0.55
        );
      }

      /*
       * Keep the face slightly brighter than the torso.
       */
      const faceBoost =
        normalizedY > 0.68
          ? 1.12
          : 1.0;

      color.multiplyScalar(
        faceBoost
      );
    }

    colors[i * 3] =
      color.r;

    colors[i * 3 + 1] =
      color.g;

    colors[i * 3 + 2] =
      color.b;

    /*
     * Per-particle dissolve data.
     * The previous version allocated these buffers but never
     * populated them, so the body/hair received zero scatter
     * and zero seed values while the heart could still move.
     * Give every surface particle its own controlled outward
     * direction and release timing.
     */
    const localX =
      positions[i * 3];
    const localY =
      positions[i * 3 + 1];
    const localZ =
      positions[i * 3 + 2];

    const localLength =
      Math.sqrt(
        localX * localX +
        localY * localY +
        localZ * localZ
      );

    let sx =
      localLength > 0.0001
        ? localX / localLength
        : 0;
    let sy =
      localLength > 0.0001
        ? localY / localLength
        : 0.35;
    let sz =
      localLength > 0.0001
        ? localZ / localLength
        : 0;

    /* Add gentle asymmetric turbulence so the dissolve
       becomes digital dust rather than a perfect explosion. */
    sx += (Math.random() - 0.5) * 0.75;
    sy += (Math.random() - 0.5) * 0.55;
    sz += (Math.random() - 0.5) * 0.75;

    const scatterLength =
      Math.sqrt(
        sx * sx +
        sy * sy +
        sz * sz
      );

    scatter[i * 3] =
      scatterLength > 0.0001
        ? sx / scatterLength
        : 0;

    scatter[i * 3 + 1] =
      scatterLength > 0.0001
        ? sy / scatterLength
        : 1;

    scatter[i * 3 + 2] =
      scatterLength > 0.0001
        ? sz / scatterLength
        : 0;

    /* Stagger release across the surface. */
    seeds[i] =
      Math.random();
  }

  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      positions,
      3
    )
  );

  geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(
      colors,
      3
    )
  );

  geometry.setAttribute(
    "aScatter",
    new THREE.BufferAttribute(
      scatter,
      3
    )
  );

  geometry.setAttribute(
    "aSeed",
    new THREE.BufferAttribute(
      seeds,
      1
    )
  );

  return geometry;
}

/* =========================================================
   PARTICLE MODEL
   ========================================================= */

type InteractionState = {
  x: number;
  y: number;
  strength: number;
  speed: number;
};

type ParticleModelProps = {
  url: string;
  count: number;
  type: "body" | "hair";
  input: RefObject<InputState>;
  gyro: RefObject<GyroState>;
  interaction: RefObject<InteractionState>;
  motionEnabled: boolean;
  fragmentTarget: RefObject<number>;
};

function ParticleModel({
  url,
  count,
  type,
  input,
  gyro,
  interaction,
  motionEnabled,
  fragmentTarget,
}: ParticleModelProps) {
  const object = useLoader(
    OBJLoader,
    url
  );

  const materialRef =
    useRef<THREE.ShaderMaterial>(null);

  const fragmentProgress =
    useRef(0);

  const geometry = useMemo(
    () =>
      buildSurfaceParticles(
        object,
        count,
        type,
        type === "body" ? 4.0 : 3.35
      ),
    [object, count, type]
  );

  useFrame((state) => {
    const material =
      materialRef.current;

    if (!material) return;

    const time =
      state.clock.getElapsedTime();

    material.uniforms.uTime.value = time;
    material.uniforms.uMotion.value =
      motionEnabled ? 1 : 0;

    const x = motionEnabled
      ? gyro.current.x
      : input.current.x;

    const y = motionEnabled
      ? gyro.current.y
      : input.current.y;

    material.uniforms.uMouse.value.set(
      x,
      y
    );

    material.uniforms.uPointer.value.set(
      x,
      y
    );

    material.uniforms.uInteraction.value =
      interaction.current.strength;

    material.uniforms.uPointerSpeed.value =
      interaction.current.speed;

    fragmentProgress.current +=
      (fragmentTarget.current -
        fragmentProgress.current) *
      0.055;

    material.uniforms.uFragment.value =
      fragmentProgress.current;
  });

  return (
    <points
      geometry={geometry}
      frustumCulled={false}
    
      position={
        type === "hair"
          ? [0, 0.50, -0.04]
          : undefined
      }
    >
      <shaderMaterial
        ref={materialRef}
        vertexShader={BODY_VERTEX_SHADER}
        fragmentShader={BODY_FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        depthTest
        blending={THREE.AdditiveBlending}
        vertexColors
        uniforms={{
          uTime: { value: 0 },
          uPixelRatio: {
            value: Math.min(
              window.devicePixelRatio,
              2
            ),
          },
          uSize: {
            value:
              type === "body"
                ? 0.026
                : 0.023,
          },
          uMotion: { value: 0 },
          uMouse: {
            value: new THREE.Vector2(),
          },
          uFragment: { value: 0 },
          uPointer: {
            value: new THREE.Vector2(),
          },
          uInteraction: { value: 0 },
          uPointerSpeed: { value: 0 },
        }}
      />
    </points>
  );
}

/* =========================================================
   HEART
   ========================================================= */

function HeartCore({
  input,
  gyro,
  interaction,
  motionEnabled,
  fragmentTarget,
}: {
  input: RefObject<InputState>;
  gyro: RefObject<GyroState>;
  interaction: RefObject<InteractionState>;
  motionEnabled: boolean;
  fragmentTarget: RefObject<number>;
}) {
  const gltf = useLoader(
    GLTFLoader,
    `${import.meta.env.BASE_URL}models/heart.glb`
  );

  const materialRef =
    useRef<THREE.ShaderMaterial>(null);

  const fragmentProgress =
    useRef(0);

  const geometry = useMemo(
    () =>
      buildSurfaceParticles(
        gltf.scene,
        HEART_COUNT,
        "heart",
        0.72
      ),
    [gltf]
  );

  useFrame((state) => {
    const material =
      materialRef.current;

    if (!material) return;

    material.uniforms.uTime.value =
      state.clock.getElapsedTime();

    material.uniforms.uPulse.value = 1;

    material.uniforms.uInteraction.value =
      interaction.current.strength;

    material.uniforms.uPointerSpeed.value =
      interaction.current.speed;

    fragmentProgress.current +=
      (fragmentTarget.current -
        fragmentProgress.current) *
      0.065;

    material.uniforms.uFragment.value =
      fragmentProgress.current;

    void input.current.x;
    void gyro.current.x;
    void motionEnabled;
  });

  return (
    <group
      position={[0, -0.72, 0.62]}
    >
      <points
        geometry={geometry}
        frustumCulled={false}
      >
        <shaderMaterial
          ref={materialRef}
          vertexShader={HEART_VERTEX_SHADER}
          fragmentShader={HEART_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          depthTest
          blending={THREE.AdditiveBlending}
          vertexColors
          uniforms={{
            uTime: { value: 0 },
            uPixelRatio: {
              value: Math.min(
                window.devicePixelRatio,
                2
              ),
            },
            uSize: { value: 0.026 },
            uPulse: { value: 1 },
            uFragment: { value: 0 },
            uInteraction: { value: 0 },
            uPointerSpeed: { value: 0 },
          }}
        />
      </points>
    </group>
  );
}

/* =========================================================
   AMBIENT FIELD
   ========================================================= */

function AmbientField() {

  const materialRef =
    useRef<THREE.ShaderMaterial>(
      null
    );

  const geometry =
    useMemo(
      () => {

        const positions =
          new Float32Array(
            AMBIENT_COUNT *
              3
          );

        const sizes =
          new Float32Array(
            AMBIENT_COUNT
          );

        const speeds =
          new Float32Array(
            AMBIENT_COUNT
          );

        for (
          let i = 0;
          i <
          AMBIENT_COUNT;
          i++
        ) {

          positions[
            i * 3
          ] =
            (
              Math.random() -
              0.5
            ) *
            12;

          positions[
            i * 3 + 1
          ] =
            (
              Math.random() -
              0.5
            ) *
            8;

          positions[
            i * 3 + 2
          ] =
            (
              Math.random() -
              0.5
            ) *
            6;

          sizes[i] =
            0.16 +
            Math.random() *
            0.55;

          speeds[i] =
            0.2 +
            Math.random() *
            0.8;
        }

        const result =
          new THREE.BufferGeometry();

        result.setAttribute(
          "position",
          new THREE.BufferAttribute(
            positions,
            3
          )
        );

        result.setAttribute(
          "aSize",
          new THREE.BufferAttribute(
            sizes,
            1
          )
        );

        result.setAttribute(
          "aSpeed",
          new THREE.BufferAttribute(
            speeds,
            1
          )
        );

        return result;

      },
      []
    );

  useFrame(
    (state) => {

      if (
        !materialRef.current
      ) {
        return;
      }

      materialRef.current.uniforms.uTime.value =
        state.clock.getElapsedTime();

    }
  );

  return (
    <points
      geometry={geometry}
      frustumCulled={false}
    >

      <shaderMaterial

        ref={materialRef}

        vertexShader={
          AMBIENT_VERTEX_SHADER
        }

        fragmentShader={
          AMBIENT_FRAGMENT_SHADER
        }

        transparent

        depthWrite={
          false
        }

        blending={
          THREE.AdditiveBlending
        }

        uniforms={{

          uTime: {
            value: 0,
          },

          uPixelRatio: {
            value:
              Math.min(
                window.devicePixelRatio,
                2
              ),
          },

          uColor: {
            value:
              new THREE.Color(
                "#00a9c7"
              ),
          },

        }}

      />

    </points>
  );
}

/* =========================================================
   SCENE
   ========================================================= */

function Scene({
  input,
  gyro,
  interaction,
  motionEnabled,
  fragmentTarget,
}: {
  input: RefObject<InputState>;
  gyro: RefObject<GyroState>;
  interaction: RefObject<InteractionState>;
  motionEnabled: boolean;
  fragmentTarget: RefObject<number>;
}) {
  const group =
    useRef<THREE.Group>(null);

  const { camera } =
    useThree();

  useEffect(() => {
    camera.position.set(
      0,
      0,
      5.8
    );
  }, [camera]);

  useFrame(() => {
    if (!group.current) return;

    const x = motionEnabled
      ? gyro.current.x
      : input.current.x;

    const y = motionEnabled
      ? gyro.current.y
      : input.current.y;

    group.current.rotation.y =
      x * 0.20;

    group.current.rotation.x =
      -y * 0.09;

    group.current.position.x =
      x * 0.08;

    group.current.position.y =
      y * 0.045;
  });

  return (
    <>
      <group ref={group}>
        <ParticleModel
          url={`${import.meta.env.BASE_URL}models/female_head.obj`}
          count={BODY_COUNT}
          type="body"
          input={input}
          gyro={gyro}
          interaction={interaction}
          motionEnabled={motionEnabled}
          fragmentTarget={fragmentTarget}
        />

        <ParticleModel
          url={`${import.meta.env.BASE_URL}models/face2.obj`}
          count={HAIR_COUNT}
          type="hair"
          input={input}
          gyro={gyro}
          interaction={interaction}
          motionEnabled={motionEnabled}
          fragmentTarget={fragmentTarget}
        />

        <HeartCore
          input={input}
          gyro={gyro}
          interaction={interaction}
          motionEnabled={motionEnabled}
          fragmentTarget={fragmentTarget}
        />
      </group>

      <AmbientField />
    </>
  );
}

/* =========================================================
   INTERFACE
   ========================================================= */

function Interface({
  motionEnabled,
  enableMotion,
  fragmented,
  toggleFragment,
}: {
  motionEnabled: boolean;
  enableMotion: () => void;
  fragmented: boolean;
  toggleFragment: () => void;
}) {
  return (
    <div className="ultron-ui">
      <div className="brand">
        ZARA
      </div>

      <div className="status">
        PARTICLE INTELLIGENCE / HUMAN FORM
      </div>

      <button
        className="motion-button"
        onClick={toggleFragment}
        style={{
          right: "32px",
          bottom: "92px",
        }}
      >
        {fragmented
          ? "REASSEMBLE"
          : "FRAGMENT"}
        <span>
          {fragmented
            ? "RESTORE FORM"
            : "DISSOLVE FORM"}
        </span>
      </button>

      {!motionEnabled ? (
        <button
          className="motion-button"
          onClick={enableMotion}
        >
          ENABLE MOTION
          <span>
            DEVICE SENSOR
          </span>
        </button>
      ) : (
        <div className="motion-status">
          MOTION ACTIVE
        </div>
      )}
    </div>
  );
}

/* =========================================================
   APP
   ========================================================= */

export default function App() {
  const {
    input,
    gyro,
    interaction,
    motionEnabled,
    enableMotion,
  } = useSharedInput();

  const fragmentTarget =
    useRef(0);

  const [fragmented, setFragmented] =
    useState(false);

  const toggleFragment =
    () => {
      const next =
        !fragmented;

      setFragmented(next);
      fragmentTarget.current =
        next ? 1 : 0;
    };

  return (
    <div className="ultron">
      <Canvas
        dpr={[1, 2]}
        camera={{
          position: [0, 0, 5.8],
          fov: 45,
          near: 0.1,
          far: 100,
        }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference:
            "high-performance",
        }}
      >
        <Scene
          input={input}
          gyro={gyro}
          interaction={interaction}
          motionEnabled={motionEnabled}
          fragmentTarget={fragmentTarget}
        />
      </Canvas>

      <Interface
        motionEnabled={motionEnabled}
        enableMotion={enableMotion}
        fragmented={fragmented}
        toggleFragment={toggleFragment}
      />
    </div>
  );
}

