// Make a synthetic 24 MP JPEG from a small photo, for encode benchmarks.
// Usage: node bench/synthetic.mjs <source.jpg> <out.jpg>
// The upscale gets light Gaussian grain (sigma 6) so the encoder sees detail
// closer to a real camera file. Copy the source ICC profile and EXIF after:
//   exiftool -overwrite_original -tagsfromfile <source.jpg> -icc_profile -exif:all -xmp:all <out.jpg>
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const [src, out] = process.argv.slice(2);
const { data, info } = await sharp(src, { ignoreIcc: true })
  .resize(6000, 4000, { fit: 'fill', kernel: 'lanczos3' })
  .raw()
  .toBuffer({ resolveWithObject: true });
for (let i = 0; i + 1 < data.length; i += 2) {
  const u = Math.random() || 1e-9;
  const v = Math.random();
  const r = Math.sqrt(-2 * Math.log(u)) * 6;
  data[i] = Math.max(0, Math.min(255, data[i] + r * Math.cos(2 * Math.PI * v)));
  data[i + 1] = Math.max(
    0,
    Math.min(255, data[i + 1] + r * Math.sin(2 * Math.PI * v))
  );
}
const jpeg = await sharp(data, {
  raw: { width: info.width, height: info.height, channels: info.channels },
})
  .jpeg({ quality: 92 })
  .toBuffer();
await writeFile(out, jpeg);
