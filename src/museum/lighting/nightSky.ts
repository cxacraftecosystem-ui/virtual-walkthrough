/**
 * Dusk & night extension of the Preetham sky (three.js Sky): a blue-hour gradient with a warm
 * afterglow band toward the set sun, and a night sky with a moon disc + halo and a procedural,
 * gently twinkling starfield. Pure uniforms — switching time of day never recompiles.
 *
 * Applied to the Sky material in SkyAndSun (patchNightSky); driven each frame by
 * <TimeOfDayController> through `nightSkyUniforms`.
 */
import * as THREE from 'three'

export interface NightSkyUniforms {
  nightMix: { value: number }
  twilightMix: { value: number }
  moonDir: { value: THREE.Vector3 }
  duskSunDir: { value: THREE.Vector3 }
}

/** Uniform objects of every patched sky material (normally exactly one). */
export const nightSkyUniforms = new Set<NightSkyUniforms>()

const DECLS = /* glsl */ `
uniform float nightMix;
uniform float twilightMix;
uniform vec3 moonDir;
uniform vec3 duskSunDir;

float mHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

vec3 museumStars( vec3 dir ) {
  vec3 acc = vec3( 0.0 );
  for ( int l = 0; l < 2; l ++ ) {
    float scale = l == 0 ? 170.0 : 380.0;
    float thresh = l == 0 ? 0.975 : 0.985;
    vec3 p = dir * scale;
    vec3 cell = floor( p );
    float h = mHash( cell + float( l ) * 37.0 );
    if ( h > thresh ) {
      vec3 j = vec3( mHash( cell + 1.7 ), mHash( cell + 4.1 ), mHash( cell + 9.3 ) );
      vec3 c = cell + 0.2 + 0.6 * j;
      float d = length( p - c );
      float b = ( h - thresh ) / ( 1.0 - thresh );
      float tw = 0.7 + 0.3 * sin( time * ( 1.3 + 2.6 * j.x ) + j.y * 40.0 );
      vec3 tint = mix( vec3( 0.72, 0.82, 1.0 ), vec3( 1.0, 0.88, 0.72 ), j.z );
      acc += tint * exp( - d * d * 14.0 ) * ( 0.2 + 1.8 * b * b ) * tw;
    }
  }
  return acc;
}

vec3 museumTwilight( vec3 base, vec3 dir ) {
  if ( twilightMix <= 0.0 && nightMix <= 0.0 ) return base;
  float h = max( dir.y, 0.0 );
  vec2 dd = normalize( dir.xz + vec2( 1e-5 ) );

  // blue hour: deep indigo zenith, lilac horizon, warm afterglow toward the set sun
  vec3 tw = mix( vec3( 0.075, 0.075, 0.13 ), vec3( 0.012, 0.026, 0.085 ), pow( h, 0.42 ) );
  float toward = max( dot( normalize( duskSunDir.xz + vec2( 1e-5 ) ), dd ), 0.0 );
  tw += vec3( 0.34, 0.13, 0.045 ) * pow( toward, 3.0 ) * exp( - h * 10.0 );
  tw += vec3( 0.05, 0.03, 0.06 ) * exp( - h * 5.0 );

  // night: near-black blue, moon disc + halo, stars
  vec3 ng = mix( vec3( 0.007, 0.010, 0.020 ), vec3( 0.0012, 0.0022, 0.0068 ), pow( h, 0.5 ) );
  float md = dot( dir, normalize( moonDir ) );
  ng += vec3( 0.030, 0.040, 0.065 ) * pow( max( md, 0.0 ), 28.0 );
  ng += vec3( 0.92, 0.94, 1.0 ) * 2.4 * smoothstep( 0.99984, 0.99991, md );
  ng += museumStars( dir ) * smoothstep( 0.02, 0.22, dir.y ) * 0.32;

  vec3 sky = mix( base, tw, twilightMix );
  return mix( sky, ng, nightMix );
}
`

/** Add the dusk/night terms to a (possibly already patched) three.js Sky material. Idempotent. */
export function patchNightSky(mat: THREE.ShaderMaterial) {
  if ((mat.uniforms as Record<string, unknown>).nightMix) return
  const u: NightSkyUniforms = {
    nightMix: { value: 0 },
    twilightMix: { value: 0 },
    moonDir: { value: new THREE.Vector3(0.4, 0.7, 0.5).normalize() },
    duskSunDir: { value: new THREE.Vector3(-1, 0, 0) },
  }
  Object.assign(mat.uniforms, u)
  const anchor = 'vec3 texColor = ( Lin + L0 ) * 0.04 + sundiscColor + vec3( 0.0, 0.0003, 0.00075 );'
  if (!mat.fragmentShader.includes(anchor) || !mat.fragmentShader.includes('uniform float time;')) {
    console.warn('[museum] sky shader layout changed; dusk/night sky disabled')
    return
  }
  mat.fragmentShader = mat.fragmentShader
    .replace('uniform float time;', `uniform float time;\n${DECLS}`)
    .replace(anchor, `${anchor}\n\t\t\ttexColor = museumTwilight( texColor, direction );`)
  mat.needsUpdate = true
  nightSkyUniforms.add(u)
}
