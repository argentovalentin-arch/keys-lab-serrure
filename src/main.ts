import './style.css';
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import Lenis from 'lenis';
import { createParticles } from './world/particles';
import { createKeyMesh } from './world/keyMesh';
import { createDoor } from './world/door';
import { STORY_END, cameraAt, storyAt } from './core/story';
import { FrameMonitor, TIERS, forcedTier, initialTier, type Tier } from './core/quality';
import { Loader } from './ui/loader';
import { Stage, type Chapter } from './ui/stage';

const NAVY = '#0e1726';

const CHAPTERS: Chapter[] = [
  { title: 'Le bruit', lead: 'Beaucoup d’agitation, aucune direction.' },
  { title: 'Structurer', lead: 'Chaque élément trouve sa place.' },
  { title: 'La clé', lead: 'Une forme précise, pour une serrure précise.' },
  { title: 'Activer', lead: 'La bonne clé, au bon endroit, au bon moment.' },
  {
    title: 'Performer',
    lead: 'Ce qui était fermé s’ouvre.',
    link: { href: 'https://keysperformance.com/', label: 'Découvrir KEYS Performance →' },
  },
];

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const fallback = document.querySelector<HTMLElement>('#fallback')!;
const backendLabel = document.querySelector<HTMLElement>('#backend')!;
const statsLabel = document.querySelector<HTMLElement>('#stats')!;
const scrollHint = document.querySelector<HTMLElement>('#scroll-hint')!;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// `?webgl` forces the WebGL 2 backend, to test the fallback path on WebGPU browsers.
const forceWebGL = new URLSearchParams(location.search).has('webgl');
const formatNumber = (n: number) => n.toLocaleString('fr-FR');

const loader = new Loader(reducedMotion);

async function start(): Promise<void> {
  await loader.step('Préparation du rendu', 0.1);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  await renderer.init();
  renderer.toneMapping = THREE.NeutralToneMapping;

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  const backendName = isWebGPU ? 'WebGPU' : 'WebGL 2';
  backendLabel.textContent = `Rendu ${backendName}`;

  const tier = initialTier(isWebGPU);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, TIERS[tier].pixelRatio));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(NAVY);
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 10);

  await loader.step(`Génération de ${formatNumber(TIERS[tier].particles)} particules`, 0.25);
  const particles = createParticles(TIERS[tier].particles);
  scene.add(particles.object);
  // Reduced motion: no pointer push and a much slower drift.
  if (reducedMotion) {
    particles.pointerStrength.value = 0;
    particles.wander.value = 0.3;
  }

  await loader.step('Clé, serrure et porte', 0.4);
  // Metal needs something to reflect: a neutral studio, generated, no image to download.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();

  const door = createDoor();
  const key = createKeyMesh();
  door.keyHolder.add(key.mesh);
  scene.add(door.group);
  if (import.meta.env.DEV) Object.assign(window, { __debug: { renderer, particles, scene, camera, door, key } });

  // Bloom makes the light through the doorway glow; the low tier goes without it.
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  const glowPass = bloom(sceneColor, 0, 0.6, 0.85);
  const pipeline = new THREE.RenderPipeline(renderer, sceneColor.add(glowPass));
  let useBloom = tier !== 'low';
  const draw = () => (useBloom ? pipeline.render() : renderer.render(scene, camera));

  const drawSize = new THREE.Vector2();
  const applyCount = (drawn: number) => {
    particles.object.count = Math.min(particles.capacity, drawn);
    particles.brightness.value = Math.min(1.8, Math.sqrt(TIERS.high.particles / particles.object.count));
  };
  applyCount(particles.capacity);

  const applyTier = (next: Tier) => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, TIERS[next].pixelRatio));
    drawSize.set(0, 0); // forces the canvas to be resized on the next frame
    applyCount(TIERS[next].particles);
    useBloom = next !== 'low';
    console.info(`KEYS Lab: qualité ${next}`);
  };
  const monitor = new FrameMonitor(tier, applyTier, forcedTier() === null);
  console.info(`KEYS Lab: ${backendName}, qualité ${tier}, ${formatNumber(particles.capacity)} particules`);

  // Compile everything before the loader leaves, so no chapter stutters when it first
  // appears. Hidden elements are shown for the compilation only. The compute pass
  // compiles on its first run. compileAsync can fail to settle on the WebGL 2 backend
  // (seen with three r186), so it gets a time limit.
  await loader.step('Compilation des shaders', 0.6);
  door.setReveal(1);
  door.setGlow(1);
  key.material.opacity = 1;
  renderer.compute(particles.update);
  const compiled = await Promise.race([
    renderer.compileAsync(scene, camera).then(() => true),
    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 5000)),
  ]);
  if (!compiled) console.warn('KEYS Lab: shader precompilation timed out, continuing');
  await loader.step('Premier rendu', 0.85);
  draw();

  const stage = new Stage(CHAPTERS, reducedMotion);
  stage.show(0);
  const lenis = new Lenis({ autoRaf: false, lerp: reducedMotion ? 1 : 0.15 });

  // Pointer, projected on the z = 0 plane then moved into the particles' local space.
  const ndc = new THREE.Vector2();
  let pointerActive = false;
  if (!reducedMotion) {
    window.addEventListener('pointermove', (e) => {
      ndc.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
      pointerActive = true;
    });
    document.addEventListener('pointerleave', () => (pointerActive = false));
    // On touch screens the finger lifts away: stop pushing particles once it does.
    window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') pointerActive = false; });
  }
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  const scrollProgress = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? THREE.MathUtils.clamp(window.scrollY / max, 0, 1) : 0;
  };

  const timer = new THREE.Timer();
  let story = 0;
  let distanceScale = 1;
  let statsTime = 0;
  let statsFrames = 0;

  renderer.setAnimationLoop((now: number) => {
    timer.update(now);
    lenis.raf(now);
    const dt = Math.min(timer.getDelta(), 1 / 30);

    const progress = scrollProgress();
    // The story moves a little behind the scroll, so a flick of the wheel still reads as a transition.
    story = THREE.MathUtils.damp(story, progress * STORY_END, reducedMotion ? 20 : 7, dt);
    stage.show(Math.min(CHAPTERS.length - 1, Math.round(story)));
    scrollHint.classList.toggle('is-hidden', progress > 0.02);

    const state = storyAt(story);
    // The particle shapes sway slowly, and settle face-on as they become the key,
    // so the metal key takes their place exactly.
    particles.object.rotation.y = reducedMotion ? 0 : Math.sin(timer.getElapsed() * 0.15) * 0.35 * state.sway;
    particles.morph.value = state.morph;
    particles.flow.value = state.flow;
    particles.visibility.value = state.particles;
    particles.object.visible = state.particles > 0.001;

    key.mesh.visible = state.key > 0.001;
    key.material.opacity = state.key;
    key.mesh.position.x = state.insert;
    key.mesh.rotation.x = state.turn;
    door.plug.rotation.x = state.turn;
    door.pivot.rotation.y = state.open;
    door.setReveal(state.door);
    door.setGlow(state.glow);
    // The halo is kept for the light behind the door: on the dense particle key it burns to white.
    glowPass.strength.value = state.glow * 0.55;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    if (width !== drawSize.x || height !== drawSize.y) {
      drawSize.set(width, height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // Portrait screens: step back so the key still fits across.
      distanceScale = camera.aspect < 1 ? 1 / Math.max(camera.aspect, 0.5) : 1;
      camera.updateProjectionMatrix();
    }
    cameraAt(story, distanceScale, camera.position, lookTarget);
    camera.lookAt(lookTarget);

    if (pointerActive && state.flow === 0) {
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(plane, hit)) particles.object.worldToLocal(particles.pointer.value.copy(hit));
    } else {
      particles.pointer.value.set(0, 0, 100);
    }

    particles.time.value = timer.getElapsed();
    particles.delta.value = dt;
    renderer.compute(particles.update);
    draw();

    monitor.sample(timer.getDelta());
    statsTime += timer.getDelta();
    statsFrames++;
    if (statsTime >= 0.5) {
      const fps = Math.round(statsFrames / statsTime);
      statsLabel.textContent = `${fps} i/s · ${formatNumber(particles.object.count)} particules · ${monitor.current}`;
      if (import.meta.env.DEV) Object.assign(window, { __lab: { fps, backend: backendName, tier: monitor.current, count: particles.object.count, story } });
      statsTime = statsFrames = 0;
    }
  });

  await loader.finish();
}

start().catch((error) => {
  console.error(error);
  loader.hide();
  fallback.hidden = false;
});
