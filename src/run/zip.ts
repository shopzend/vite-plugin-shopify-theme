import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

// 读取 ZIP 中的文件条目（不含目录条目）。只支持 Shopify CLI 主题包实际使用的
// stored / deflate 与非 ZIP64 格式；其他形态直接报错，不做猜测。
export function readZipEntries(file: string): Map<string, Buffer> {
  const zip = readFileSync(file);
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > zip.length) throw new Error(`${file} is not a ZIP archive`);
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new Error(`${file} uses unsupported ZIP64`);

  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error(`${file} has a corrupt directory`);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (entries.has(name)) throw new Error(`duplicate ZIP entry: ${name}`);

    if (zip.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error(`${file} has a corrupt entry`);
    const start =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const data = zip.subarray(start, start + compressedSize);
    if (method === 0) entries.set(name, Buffer.from(data));
    else if (method === 8) entries.set(name, inflateRawSync(data));
    else throw new Error(`unsupported ZIP compression method ${method}: ${name}`);
  }
  return entries;
}
