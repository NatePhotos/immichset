/* The sites the second golden test builds: pages saved from the editor, but the header, footer, theme and wording
   never saved. A logo or none, an Instagram link or none, a live address, the admin preview, and a site whose menu
   was changed through its pages. */
import { state } from '../fixtures.mjs';
import { migratePages } from '../../pages.mjs';
import { mk } from '../block-helpers.mjs';

const saved = (edit = () => {}) => () => { const s = state(); s.pages = migratePages(s.settings, s.galleries); edit(s); return s; };
const logo = s => { s.settings.style = { ...s.settings.style, logo: 'logo.svg' }; };
const noInstagram = s => { s.settings.footer = { copyright: '© Example', instagram: '' }; };
const menu = s => {
  s.pages.splice(1, 0, { id: 'pwork', title: 'Work & Play', slug: 'work', inMenu: true, seoTitle: '', seoDescription: '', galleryId: null,
    blocks: [mk('bw1', 'heading', { text: 'Hi <there>' })] });
  s.pages.find(p => p.id === 'contact').inMenu = false;
};
const styled = s => { s.settings.style = { ...s.settings.style, page: '#ffffff', ink: '#112233', headingFont: 'Lora', bodyFont: 'Lora', textSize: 'larger', gap: 'roomy', cardShape: 'square' }; };

export const SAVED_CASES = {
  full: [saved(), {}],
  logo: [saved(logo), { siteUrl: 'https://example.com' }],
  noInstagram: [saved(noInstagram), {}],
  preview: [saved(logo), { base: '/admin/site-preview/' }],
  menu: [saved(menu), {}],
  styled: [saved(styled), {}],
};
