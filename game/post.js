// The world is drawn into a half-float (HDR) target, then one full-screen pass puts it on screen:
// bloom from the target's own mip chain (lamps, kiln mouths, muzzle flashes and the sun are brighter
// than 1.0, so only they glow), a warm/cool grade, a vignette, film grain, then tone mapping.

import * as THREE from 'three';

const FRAGMENT = `
uniform sampler2D map;
uniform float time;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(map, vUv).rgb;
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 4; i++) glow += max(textureLod(map, vUv, 2.0 + float(i) * 1.4).rgb - 1.15, 0.0);
  c += glow * 0.28;
  float l = dot(c, vec3(0.3, 0.6, 0.1));
  c = mix(c * vec3(0.9, 0.98, 1.12), c * vec3(1.07, 1.0, 0.9), smoothstep(0.04, 0.7, l));
  vec2 q = vUv - 0.5;
  c *= 1.0 - 0.5 * pow(dot(q, q) * 2.0, 1.5);
  c += (hash(vUv * 900.0 + time) - 0.5) * 0.014;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createPost(renderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
  });
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: target.texture }, time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  // One triangle that covers the screen.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const camera = new THREE.Camera();
  const size = new THREE.Vector2();

  return {
    resize() {
      renderer.getDrawingBufferSize(size);
      target.setSize(size.x, size.y);
    },
    // Draws `scene` through the pass onto the screen.
    render(scene, sceneCamera, time) {
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, sceneCamera);
      renderer.setRenderTarget(null);
      material.uniforms.time.value = time % 10;
      renderer.render(quad, camera);
    },
  };
}
