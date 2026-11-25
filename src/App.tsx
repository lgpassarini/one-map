import { Canvas } from '@react-three/fiber'
import { useState } from 'react'
import { detectQuality, QUALITY_SETTINGS } from './quality'
import { Minimap } from './ui/Minimap'
import { World } from './world/World'

export default function App() {
  const [quality] = useState(detectQuality)
  return (
    <>
      <Canvas dpr={QUALITY_SETTINGS[quality].dpr} camera={{ fov: 45, near: 0.1, far: 400 }}>
        <World quality={quality} />
      </Canvas>
      <Minimap />
    </>
  )
}
