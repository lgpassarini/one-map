import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { buildMerry } from '../world/merryModel'
import { buildSunny } from '../world/sunnyModel'

// Dev (só no `npm run dev`, não entra no build): os navios de perto, com a luz do mapa.
// /navios.html?navio=merry|sunny&yaw=graus&alt=altura — sem ?navio, os dois lado a lado.
// Também vira página avulsa: definir window.NAVIO antes do script fixa o navio.

const q = new URLSearchParams(window.location.search)
const only = ((window as { NAVIO?: string }).NAVIO ?? q.get('navio')) as 'merry' | 'sunny' | null
const yaw = (Number(q.get('yaw') ?? 35) * Math.PI) / 180
const alt = Number(q.get('alt') ?? 0.55)
const NAMES = { merry: 'Going Merry', sunny: 'Thousand Sunny' }

function Ships() {
  const merry = useMemo(() => buildMerry(), [])
  const sunny = useMemo(() => buildSunny(), [])
  return (
    <>
      {only !== 'sunny' && <primitive object={merry.group} position={[only ? 0 : -0.75, 0, 0]} scale={only ? 1.3 : 1} />}
      {only !== 'merry' && <primitive object={sunny.group} position={[only ? 0 : 0.75, 0, 0]} scale={only ? 1.1 : 1.23} />}
    </>
  )
}

const D = Number(q.get('d')) || (only ? 3.4 : 4.4)
const TY = Number(q.get('ty') ?? 0.5) // altura do ponto que a câmera olha

function App() {
  const [spin, setSpin] = useState(q.get('spin') !== '0')
  return (
    <>
      <Canvas camera={{ fov: 35, position: [Math.sin(yaw) * -D, TY + D * alt, Math.cos(yaw) * -D] }}>
        <color attach="background" args={['#a8bdc9']} />
        <hemisphereLight args={['#ffffff', '#8fb8c8', 1.4]} />
        <directionalLight position={[50, 80, 35]} intensity={2.0} color="#fff6e6" />
        <mesh rotation-x={-Math.PI / 2}>
          <planeGeometry args={[20, 20]} />
          <meshBasicMaterial color="#5fa6c4" transparent opacity={0.85} />
        </mesh>
        <Ships />
        <OrbitControls
          target={[0, TY, 0]}
          autoRotate={spin}
          autoRotateSpeed={1.2}
          minDistance={0.8}
          maxDistance={8}
          onStart={() => setSpin(false)}
        />
      </Canvas>
      <div style={{ position: 'fixed', top: 16, left: 20, font: '600 22px system-ui, sans-serif', color: '#1f3440' }}>
        {only ? NAMES[only] : 'Navios'}
      </div>
      <div style={{ position: 'fixed', bottom: 14, left: 20, font: '13px system-ui, sans-serif', color: '#1f3440', opacity: 0.8 }}>
        Arraste para girar · roda do mouse para zoom · botão direito para mover
        {!spin && (
          <button onClick={() => setSpin(true)} style={{ marginLeft: 12, font: 'inherit', cursor: 'pointer' }}>
            girar sozinho
          </button>
        )}
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
