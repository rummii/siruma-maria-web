"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

type MorphMesh = THREE.Mesh & {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
};

type MariaFaceLabProps = {
  audio: HTMLAudioElement | null;
  speaking: boolean;
};

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

export function MariaFaceLab({ audio, speaking }: MariaFaceLabProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const speakingRef = useRef(speaking);
  const [modelState, setModelState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  useEffect(() => {
    if (!audio) {
      analyserRef.current = null;
      waveformRef.current = null;
      return;
    }

    const AudioContextClass = window.AudioContext;
    const context = new AudioContextClass();
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.68;
    source.connect(analyser);
    analyser.connect(context.destination);
    analyserRef.current = analyser;
    waveformRef.current = new Uint8Array(analyser.fftSize);

    const resume = () => void context.resume();
    audio.addEventListener("play", resume);
    resume();

    return () => {
      audio.removeEventListener("play", resume);
      source.disconnect();
      analyser.disconnect();
      analyserRef.current = null;
      waveformRef.current = null;
      void context.close();
    };
  }, [audio]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    camera.position.set(0, 0, 3.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xfff7ea, 0x173441, 2.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(2.5, 3, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xd3b46f, 1.7);
    rimLight.position.set(-3, 1, -2);
    scene.add(rimLight);

    const avatarRoot = new THREE.Group();
    scene.add(avatarRoot);
    const morphMeshes: MorphMesh[] = [];
    let model: THREE.Group | null = null;
    let frame = 0;
    let mouth = 0;
    let blink = 0;
    let nextBlink = performance.now() + 1800 + Math.random() * 1800;
    const pointer = new THREE.Vector2();

    const setMorph = (name: string, value: number) => {
      for (const mesh of morphMeshes) {
        const index = mesh.morphTargetDictionary?.[name];
        if (index !== undefined && mesh.morphTargetInfluences) {
          mesh.morphTargetInfluences[index] = value;
        }
      }
    };

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const onPointerMove = (event: PointerEvent) => {
      const bounds = mount.getBoundingClientRect();
      pointer.x = clamp(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -1, 1);
      pointer.y = clamp(-(((event.clientY - bounds.top) / bounds.height) * 2 - 1), -1, 1);
    };

    const loader = new FBXLoader();
    loader.setResourcePath("/avatar-lab/lisa/");
    loader.load(
      "/avatar-lab/lisa/lisa.fbx",
      (loaded) => {
        model = loaded;
        loaded.traverse((child) => {
          const mesh = child as MorphMesh;
          if (mesh.isMesh) {
            mesh.frustumCulled = false;
            if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
              morphMeshes.push(mesh);
            }
          }
        });

        const bounds = new THREE.Box3().setFromObject(loaded);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const scale = 2.45 / Math.max(size.y, 0.001);
        loaded.scale.setScalar(scale);
        loaded.position.set(-center.x * scale, -center.y * scale - 0.05, -center.z * scale);
        avatarRoot.add(loaded);
        setModelState(morphMeshes.length ? "ready" : "error");
      },
      undefined,
      () => setModelState("error"),
    );

    const animate = (now: number) => {
      frame = window.requestAnimationFrame(animate);

      let level = 0;
      const analyser = analyserRef.current;
      const waveform = waveformRef.current;
      if (speakingRef.current && analyser && waveform) {
        analyser.getByteTimeDomainData(waveform);
        let energy = 0;
        for (const sample of waveform) {
          const normalized = (sample - 128) / 128;
          energy += normalized * normalized;
        }
        const rms = Math.sqrt(energy / waveform.length);
        level = clamp((rms - 0.012) * 10.5, 0, 0.92);
      }
      mouth += (level - mouth) * (level > mouth ? 0.55 : 0.3);

      const vowelMotion = 0.5 + 0.5 * Math.sin(now * 0.018);
      setMorph("JawOpen", mouth);
      setMorph("LipsLowerOpen", mouth * 0.62);
      setMorph("LipsUpperOpen", mouth * 0.38);
      setMorph("LipsFunnel", mouth * vowelMotion * 0.32);
      setMorph("LipsPucker", mouth * (1 - vowelMotion) * 0.24);
      setMorph("MouthSmile_L", speakingRef.current ? 0.1 : 0.16);
      setMorph("MouthSmile_R", speakingRef.current ? 0.1 : 0.16);

      if (now >= nextBlink && blink === 0) blink = 0.01;
      if (blink > 0) {
        blink += 0.16;
        const blinkAmount = Math.sin(Math.min(blink, 1) * Math.PI);
        setMorph("EyeBlink_L", blinkAmount);
        setMorph("EyeBlink_R", blinkAmount);
        if (blink >= 1) {
          blink = 0;
          nextBlink = now + 2200 + Math.random() * 2600;
        }
      } else {
        setMorph("EyeBlink_L", 0);
        setMorph("EyeBlink_R", 0);
      }

      avatarRoot.rotation.y += (pointer.x * 0.12 - avatarRoot.rotation.y) * 0.035;
      avatarRoot.rotation.x += (-pointer.y * 0.055 - avatarRoot.rotation.x) * 0.035;
      avatarRoot.position.y = Math.sin(now * 0.0014) * 0.008;
      renderer.render(scene, camera);
    };

    resize();
    window.addEventListener("resize", resize);
    mount.addEventListener("pointermove", onPointerMove);
    frame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      mount.removeEventListener("pointermove", onPointerMove);
      model?.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div ref={mountRef} className="relative h-full min-h-[420px] w-full overflow-hidden rounded-[1.75rem] bg-[radial-gradient(circle_at_50%_36%,#d9b49a_0%,#4c302c_30%,#0a222b_72%)]">
      <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-xs text-white/80 backdrop-blur">
        {modelState === "loading" && "Loading facial rig…"}
        {modelState === "ready" && (speaking ? "Live audio-driven face" : "Facial rig ready")}
        {modelState === "error" && "Facial rig could not load"}
      </div>
    </div>
  );
}
