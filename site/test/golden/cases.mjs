/* The sites the golden test builds: everything set, a live site with a logo, the admin preview, and a bare site. */
import { state } from '../fixtures.mjs';

const withLogo = () => { const s = state(); s.settings.style = { ...s.settings.style, logo: 'logo.svg' }; return s; };
const sparse = () => {
  const s = state();
  s.settings.siteName = '';
  s.settings.about = { heading: 'About', text: '', photoId: null };
  s.settings.contact = { heading: 'Contact us', bannerPhotoId: null, email: '', phone: '' };
  s.settings.footer = { copyright: '', instagram: '' };
  for (const g of s.galleries) g.hidden = true;
  return s;
};

export const CASES = {
  full: [() => state(), {}],
  live: [withLogo, { siteUrl: 'https://example.com' }],
  preview: [() => state(), { base: '/admin/site-preview/' }],
  sparse: [sparse, {}],
};
