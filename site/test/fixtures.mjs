/* The small test website every site test builds: three galleries (one hidden, one empty) and two page photos.
   Identical to the one in build.test.mjs. */
import { DEFAULTS } from '../store.mjs';

export const ph = (id, key, galleryId) => ({ id, galleryId, position: id, fileKey: key, width: 2048, height: 1365, originalName: '', immichStatus: 'ok', createdAt: 0 });

export function state(over = {}) {
  const settings = structuredClone(DEFAULTS);
  settings.siteName = 'Example Studio';
  settings.about = { heading: 'About', text: 'Hello <script>x</script>\n\nSecond', photoId: 90 };
  settings.contact = { heading: 'Contact us', bannerPhotoId: 91, email: 'someone@example.com', phone: '555 0100' };
  settings.footer = { copyright: '© Example', instagram: 'https://www.instagram.com/example' };
  return {
    rev: 3, settings,
    galleries: [
      { id: 1, slug: 'Autumn-Wedding', title: 'Autumn Wedding', showTitle: true, hidden: false, position: 0, coverPhotoId: 2, immichAlbumId: null,
        photos: [ph(1, 'aaa', 1), ph(2, 'bbb', 1)] },
      { id: 2, slug: 'Secret', title: 'Secret', showTitle: true, hidden: true, position: 1, coverPhotoId: null, immichAlbumId: null,
        photos: [ph(3, 'ccc', 2)] },
      { id: 3, slug: 'Empty', title: 'Empty', showTitle: true, hidden: false, position: 2, coverPhotoId: null, immichAlbumId: null, photos: [] },
    ],
    pagePhotos: [ph(90, 'pfp', null), ph(91, 'ban', null)],
    ...over,
  };
}
