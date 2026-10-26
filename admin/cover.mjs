/* The gallery cover is served from one fixed address and browsers keep it for five minutes, so a changed cover only
   showed up after a hard reload. This is the part of the address that changes whenever the cover does. */
export function coverVersion(gallery, mtimeOf) {
  const m = gallery.cover_file ? mtimeOf(gallery.cover_file) : null;
  if (m) return `f${Math.floor(m)}`;
  return gallery.cover_asset_id ? `a${String(gallery.cover_asset_id).slice(0, 8)}` : '';
}
