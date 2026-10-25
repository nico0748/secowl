import zlib from 'node:zlib'

/** zip（docx）から 1 ファイルを取り出します。中央ディレクトリを読む最小限の実装です（依存を増やさないため）。 */
export function unzipEntry(buf, name) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('zip の終端が見つかりません')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28)
    const xlen = buf.readUInt16LE(p + 30)
    const clen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const entry = buf.toString('utf8', p + 46, p + 46 + nlen)
    if (entry === name) {
      const lnlen = buf.readUInt16LE(local + 26)
      const lxlen = buf.readUInt16LE(local + 28)
      const start = local + 30 + lnlen + lxlen
      const data = buf.subarray(start, start + csize)
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8')
    }
    p += 46 + nlen + xlen + clen
  }
  throw new Error(`zip に ${name} がありません`)
}
