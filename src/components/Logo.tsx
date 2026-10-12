/**
 * SecOwl のシンボル。アプリアイコンと同じ画像を使います。
 * 画像の差し替えは public/ の書き出し一式を入れ替えるだけで済みます。
 */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <img
      src="/mark-96.png"
      width={size}
      height={size}
      alt="SecOwl"
      style={{ display: 'block', borderRadius: Math.round(size * 0.185) }}
    />
  )
}
