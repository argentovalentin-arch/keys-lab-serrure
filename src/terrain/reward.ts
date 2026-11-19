import * as THREE from 'three/webgpu';
import { attribute, color, float, uniform, uv } from 'three/tsl';
import { END_AT, LANDMARKS, type TrajectoryPoint } from './path';
import { LAB } from '../core/brand';

const WARM = LAB.light;
const CREAM = LAB.dust;
const POINTS = 240;
/** Steering that counts as « all the way to a side » for the curve's variations. */
const FULL_STEER = 1.25;
/** Over this many trajectory samples (~2 s) the steering is averaged out: what is left
 * is the visitor's moves, shown as the curve's ups and downs. */
const DETAIL_WINDOW = 30;
const DETAIL_SIZE = 0.15;
/** At each landmark the ride speeds up: on the curve, a surge that partly falls back. */
const SURGE_SIZE = 0.09;
const SURGE_LENGTH = 0.05; // share of the ride's time
const GRID_LINES = 3;

export interface RewardLayout {
  trajectory: TrajectoryPoint[];
  /** Distance along the path where the ride stopped. */
  end: number;
  /** Where the camera stands, and the pitch it will end on, looking towards +z. */
  eye: THREE.Vector3;
  pitch: number;
  /** The camera's vertical field of view (degrees) and aspect, to size the curve to the screen. */
  fov: number;
  aspect: number;
}

/** A thin ribbon along a polyline, as quads: -1 / +1 on its two edges for a soft falloff. */
function ribbon(points: THREE.Vector3[], width: number, out: { position: number[]; side: number[]; strength: number[]; index: number[] }, strength: number) {
  const start = out.position.length / 3;
  const tangent = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const facing = new THREE.Vector3(0, 0, -1);
  points.forEach((p, i) => {
    tangent.subVectors(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]).normalize();
    offset.crossVectors(tangent, facing).normalize().multiplyScalar(width);
    out.position.push(p.x - offset.x, p.y - offset.y, p.z, p.x + offset.x, p.y + offset.y, p.z);
    out.side.push(-1, 1);
    out.strength.push(strength, strength);
    if (i > 0) {
      const a = start + (i - 1) * 2;
      out.index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
}

/**
 * The reward: the visitor's performance curve, drawn left to right in the sky above the
 * valley once they have looked back over the path from the summit and raised their eyes.
 *
 * It reads as a chart: a time axis and a value axis with faint grid lines, the area under
 * the curve lightly filled, a mark at each landmark passed and a bright point where the
 * ride ended. Time runs along the bottom; the value is the ride itself: the climb's
 * progress (faster after each landmark, so the trend steepens), plus what the visitor
 * earned by steering, plus their moves as short ups and downs. No two rides give the
 * same curve.
 */
export function createReward(scene: THREE.Scene) {
  // Everything is laid out square to the final gaze (see start), so the chart's verticals
  // stay upright on screen rather than leaning in perspective.
  const chart = new THREE.Group();
  scene.add(chart);
  // ---- The curve.
  const positions = new Float32Array(POINTS * 2 * 3);
  const fade = new Float32Array(POINTS * 2);
  const side = new Float32Array(POINTS * 2);
  for (let i = 0; i < POINTS; i++) side.set([-1, 1], i * 2);
  const index: number[] = [];
  for (let i = 0; i < POINTS - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('rewardFade', new THREE.BufferAttribute(fade, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('rewardSide', new THREE.BufferAttribute(side, 1));
  geometry.setIndex(index);

  const additive = () => new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const shine = uniform(1);
  const material = additive();
  material.colorNode = color(WARM).mul(shine);
  const edge = float(1).sub(attribute('rewardSide', 'float').abs());
  material.opacityNode = attribute('rewardFade', 'float').mul(edge.mul(edge));
  const curve = new THREE.Mesh(geometry, material);
  curve.frustumCulled = false;
  curve.visible = false;
  chart.add(curve);

  // ---- The area under the curve, down to the time axis: brightest just under the line.
  const fillPositions = new Float32Array(POINTS * 2 * 3);
  const fillFade = new Float32Array(POINTS * 2);
  const fillHeight = new Float32Array(POINTS * 2);
  for (let i = 0; i < POINTS; i++) fillHeight.set([1, 0], i * 2);
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute('position', new THREE.BufferAttribute(fillPositions, 3));
  fillGeometry.setAttribute('fillFade', new THREE.BufferAttribute(fillFade, 1).setUsage(THREE.DynamicDrawUsage));
  fillGeometry.setAttribute('fillHeight', new THREE.BufferAttribute(fillHeight, 1));
  fillGeometry.setIndex(index);
  const fillMaterial = additive();
  fillMaterial.colorNode = color(WARM);
  fillMaterial.opacityNode = attribute('fillHeight', 'float').pow(1.6).mul(0.16).mul(attribute('fillFade', 'float'));
  const fill = new THREE.Mesh(fillGeometry, fillMaterial);
  fill.frustumCulled = false;
  fill.visible = false;
  chart.add(fill);

  // ---- The chart's frame: the two axes, faint grid lines and the landmarks' time marks.
  // Built in start(), when the size and the landmarks' times are known.
  const frameShown = uniform(0);
  const frameGeometry = new THREE.BufferGeometry();
  const frameMaterial = additive();
  frameMaterial.colorNode = color(CREAM).mul(0.8);
  const frameEdge = float(1).sub(attribute('frameSide', 'float').abs());
  frameMaterial.opacityNode = frameEdge.mul(frameEdge).mul(attribute('frameStrength', 'float')).mul(frameShown);
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.frustumCulled = false;
  frame.visible = false;
  chart.add(frame);

  // ---- Points on the curve: « Structurer », « Activer », then the end of the ride on the
  // summit (« Performer »), brighter.
  const dot = float(1).sub(uv().sub(0.5).length().mul(2)).max(0);
  const markers = [0.9, 0.9, 1.6].map((strength) => {
    const on = uniform(0);
    const markerMaterial = additive();
    markerMaterial.colorNode = color(WARM).mul(strength);
    markerMaterial.opacityNode = dot.pow(1.8).mul(on);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), markerMaterial);
    mesh.visible = false;
    chart.add(mesh);
    return { mesh, material: markerMaterial, on, at: 1 };
  });

  return {
    /** Builds the chart from the ride that just ended, in the sky beyond the start. */
    start({ trajectory, end, eye, pitch, fov, aspect }: RewardLayout) {
      // In the chart's own frame: origin at the eye, z along the final gaze (pitched down
      // by `pitch`), so the chart is square to it. Far beyond the start, above the valley.
      chart.position.copy(eye);
      chart.rotation.set(-pitch, 0, 0);
      const away = end + 70;
      const z = away;
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * away;
      const centre = 0;
      // Entirely in the upper half of the view once the eyes have risen: the mountain and
      // the route keep the lower half to themselves.
      const base = centre + 0.04 * halfHeight;
      const rise = 0.66 * halfHeight;
      const width = Math.min(halfHeight * aspect * 2 * 0.62, halfHeight * 2.6);
      const lineWidth = away * 0.0032;
      // The camera faces +z, so screen-right is -x: time runs left to right on screen.
      const xAt = (t: number) => -(t - 0.5) * width;

      // The ride, over time: one trajectory sample every TRAIL_SAMPLE seconds.
      // Up to the summit: the samples kept while gliding to a stop add nothing.
      const stop = trajectory.findIndex((s) => s.d >= END_AT);
      const ride = stop > 1 ? trajectory.slice(0, stop + 1) : trajectory;
      const samples = ride.length > 1 ? ride : [{ x: 0, d: 0 }, { x: 0, d: end }];
      const last = samples.length - 1;
      const sampleAt = (t: number) => {
        const s = t * last;
        const i = Math.min(Math.floor(s), last - 1);
        const k = s - i;
        return {
          d: samples[i].d + (samples[i + 1].d - samples[i].d) * k,
          x: samples[i].x + (samples[i + 1].x - samples[i].x) * k,
        };
      };
      // Steering minus its running average: the visitor's moves, as short-lived variations.
      const moved = [0];
      for (let i = 1; i <= last; i++) moved.push(moved[i - 1] + Math.abs(samples[i].x - samples[i - 1].x));
      const total = moved[last];
      const detailAt = (t: number) => {
        const s = Math.round(t * last);
        let sum = 0;
        let n = 0;
        for (let j = Math.max(0, s - DETAIL_WINDOW); j <= Math.min(last, s + DETAIL_WINDOW); j++) {
          sum += samples[j].x;
          n++;
        }
        return THREE.MathUtils.clamp((samples[s].x - sum / n) / FULL_STEER, -1, 1);
      };
      // When each landmark was passed (share of the ride's time).
      const timeOf = (at: number) => {
        const i = samples.findIndex((s) => s.d >= at);
        return i < 0 ? 1 : i / last;
      };
      const landmarkTimes = LANDMARKS.map((landmark) => timeOf(landmark.at));
      const raw = Array.from({ length: POINTS }, (_, i) => {
        const t = i / (POINTS - 1);
        const { d } = sampleAt(t);
        const progress = THREE.MathUtils.clamp(d / samples[last].d, 0, 1);
        const earned = total > 1e-3 ? moved[Math.round(t * last)] / total : t;
        // No variation at the very start and end: the curve sets off from the axis and
        // ends on its result.
        const settle = Math.min(1, t / 0.06, (1 - t) / 0.06);
        // The trend steepens as the ride goes on (growth builds on itself).
        const trend = 0.75 * progress ** 1.7 + 0.25 * earned;
        // After each landmark passed before the end: a surge, then part of it given back.
        let surges = 0;
        for (const at of landmarkTimes) {
          if (at >= 0.97) continue;
          const k = (t - at) / SURGE_LENGTH;
          if (k > 0) surges += SURGE_SIZE * (Math.min(k, 1) - 0.45 * Math.max(0, Math.min((k - 1) / 1.5, 1)));
        }
        return trend + surges + detailAt(t) * DETAIL_SIZE * settle;
      });
      // From the axis to the top of the chart: the full height, whatever the ride.
      const peak = Math.max(...raw, 1e-3);
      const values = raw.map((v) => v / peak);
      // A light smoothing, so the line reads as a measure rather than as noise.
      const smoothed = values.map((_, i) => {
        let sum = 0;
        let n = 0;
        for (let j = Math.max(0, i - 1); j <= Math.min(POINTS - 1, i + 1); j++) {
          sum += values[j];
          n++;
        }
        return Math.max(0, sum / n);
      });
      const points = smoothed.map((v, i) => new THREE.Vector3(xAt(i / (POINTS - 1)), base + v * rise, z));

      const tangent = new THREE.Vector3();
      const offset = new THREE.Vector3();
      const facing = new THREE.Vector3(0, 0, -1);
      for (let i = 0; i < POINTS; i++) {
        tangent.subVectors(points[Math.min(i + 1, POINTS - 1)], points[Math.max(i - 1, 0)]).normalize();
        offset.crossVectors(tangent, facing).normalize().multiplyScalar(lineWidth);
        const p = points[i];
        positions.set([p.x - offset.x, p.y - offset.y, p.z, p.x + offset.x, p.y + offset.y, p.z], i * 6);
        fillPositions.set([p.x, p.y, p.z + 0.5, p.x, base, p.z + 0.5], i * 6);
      }
      geometry.attributes.position.needsUpdate = true;
      fillGeometry.attributes.position.needsUpdate = true;

      markers[0].at = landmarkTimes[0];
      markers[1].at = landmarkTimes[1];
      markers[2].at = 1;
      for (const marker of markers) {
        const i = Math.round(marker.at * (POINTS - 1));
        const strong = marker === markers[2];
        marker.mesh.position.set(points[i].x, points[i].y, z - 0.5);
        marker.mesh.scale.setScalar(lineWidth * (strong ? 16 : 9));
        marker.mesh.visible = true;
      }

      // The frame: axes a little beyond the curve, grid lines and the landmarks' marks.
      const out = { position: [] as number[], side: [] as number[], strength: [] as number[], index: [] as number[] };
      const left = xAt(-0.02);
      const right = xAt(1.04);
      const top = base + rise * 1.12;
      const at = (x: number, y: number) => new THREE.Vector3(x, y, z + 1);
      const axisWidth = lineWidth * 0.55;
      ribbon([at(left, base), at(right, base)], axisWidth, out, 0.45); // time
      ribbon([at(left, base), at(left, top)], axisWidth, out, 0.45); // value
      for (let g = 1; g <= GRID_LINES; g++) {
        const y = base + (rise * 1.12 * g) / (GRID_LINES + 0.5);
        ribbon([at(left, y), at(right, y)], axisWidth * 0.6, out, 0.1);
      }
      for (const time of landmarkTimes) {
        const x = xAt(time);
        const y = points[Math.round(time * (POINTS - 1))].y;
        ribbon([at(x, base), at(x, y)], axisWidth * 0.6, out, 0.16); // from the time axis up to the point
        ribbon([at(x, base - rise * 0.035), at(x, base + rise * 0.035)], axisWidth, out, 0.45); // tick
      }
      frameGeometry.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
      frameGeometry.setAttribute('frameSide', new THREE.Float32BufferAttribute(out.side, 1));
      frameGeometry.setAttribute('frameStrength', new THREE.Float32BufferAttribute(out.strength, 1));
      frameGeometry.setIndex(out.index);

      curve.visible = true;
      fill.visible = true;
      frame.visible = true;
    },

    /** reveal: 0..1, the curve drawn from its start to its end, with a bright tip. */
    update(reveal: number) {
      // A bright tip at the drawing front, only while drawing (not before it starts, nor once done).
      const drawing = THREE.MathUtils.smoothstep(reveal, 0, 0.02) * (reveal < 1 ? 1 : 0);
      for (let i = 0; i < POINTS; i++) {
        const t = i / (POINTS - 1);
        // Drawn up to just past `reveal` (so 1 means all of it), softened at the front.
        const front = reveal * 1.04;
        const drawn = 1 - THREE.MathUtils.smoothstep(t, front - 0.04, front);
        const tip = Math.exp(-(((t - reveal) / 0.03) ** 2)) * drawing;
        fade[i * 2] = fade[i * 2 + 1] = Math.min(1, drawn * 0.85 + tip * 0.6);
        fillFade[i * 2] = fillFade[i * 2 + 1] = drawn;
      }
      geometry.attributes.rewardFade.needsUpdate = true;
      fillGeometry.attributes.fillFade.needsUpdate = true;
      // Each point lights up as the line reaches it.
      for (const marker of markers) marker.on.value = THREE.MathUtils.smoothstep(reveal, marker.at - 0.02, marker.at + 0.01);
      shine.value = 1.1 + reveal * 0.5;
    },

    /** The axes and grid come first, as the eyes rise, so the curve is drawn on a chart. */
    showFrame(amount: number) {
      frameShown.value = amount;
    },

    reset() {
      curve.visible = false;
      fill.visible = false;
      frame.visible = false;
      for (const marker of markers) marker.mesh.visible = false;
    },

    dispose() {
      geometry.dispose();
      material.dispose();
      fillGeometry.dispose();
      fillMaterial.dispose();
      frameGeometry.dispose();
      frameMaterial.dispose();
      for (const marker of markers) {
        marker.mesh.geometry.dispose();
        marker.material.dispose();
      }
    },
  };
}
