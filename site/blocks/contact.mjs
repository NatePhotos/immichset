import { cleanFields, esc } from './common.mjs';
export const type = 'contact';
export const label = 'Contact details';
export const icon = 'mail';
export const sketch = '<svg viewBox="0 0 100 60"><rect x="30" y="8" width="40" height="7"/><rect x="40" y="22" width="20" height="3"/><rect x="28" y="28" width="44" height="5"/><rect x="40" y="40" width="20" height="3"/><rect x="32" y="46" width="36" height="5"/></svg>';
export const defaults = Object.freeze({ heading: 'Contact us', email: '', phone: '' });
export const fields = [
  { key: 'heading', label: 'Heading', kind: 'text', max: 120 },
  { key: 'email', label: 'Email', kind: 'text', max: 200 },
  { key: 'phone', label: 'Phone', kind: 'text', max: 60 },
];
export function validate(props, ctx) {
  const r = cleanFields(props, fields, defaults, ctx);
  if (r.props.email && !/^[^\s@<>"]+@[^\s@<>"]+$/.test(r.props.email)) r.errors.email = 'that does not look like an email address';
  return r;
}
export function render(b) {
  const p = b.props, tel = String(p.phone || '').replace(/[^\d+]/g, '');
  const rows = (p.email ? `<div class="label">Email</div><a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '')
             + (p.phone ? `<div class="label">Phone number</div><a href="tel:${esc(tel)}">${esc(p.phone)}</a>` : '');
  return `<section class="contact"><h2>${esc(p.heading)}</h2>${rows}</section>`;
}
