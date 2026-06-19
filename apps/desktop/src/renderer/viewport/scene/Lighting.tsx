export function Lighting() {
  return (
    <>
      <hemisphereLight args={[0xffffff, 0x444455, 1.0]} />
      <directionalLight position={[5, 10, 7]} intensity={1.2} />
      <ambientLight intensity={0.2} />
    </>
  );
}
