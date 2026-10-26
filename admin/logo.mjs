/* A custom logo is a PNG: black artwork on a transparent background, used as a mask so it takes the colour of the page.
   An image with a solid background would turn into a solid block, so it is refused with a message that says how to fix it. */
export const LOGO_MAX = 2 * 1024 * 1024;
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function inspectPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(SIG) || buf.toString('latin1', 12, 16) !== 'IHDR')
    return { ok: false, error: 'That is not a PNG file. Export your logo as a PNG with a transparent background.' };
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20), colorType = buf[25];
  let hasAlpha = colorType === 4 || colorType === 6;
  for (let p = 8; p + 12 <= buf.length && !hasAlpha;) {            /* palette and grey images mark transparency with a tRNS chunk */
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    if (type === 'tRNS') hasAlpha = true;
    if (type === 'IDAT' || type === 'IEND') break;
    p += 12 + len;
  }
  if (!width || !height || width > 4096 || height > 4096) return { ok: false, error: 'The image should be between 1 and 4096 pixels on each side. 512 by 512 is plenty.' };
  if (!hasAlpha) return { ok: false, error: 'This PNG has no transparent background, so it would show as a solid block. Export it again with a transparent background: black artwork, nothing behind it.' };
  return { ok: true, width, height };
}

export const LOGO_FILES = { light: 'brand-logo.png', dark: 'brand-logo-dark.png' };
