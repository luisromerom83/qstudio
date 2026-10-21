/**
 * Environment branding
 * --------------------
 * Studio Manager sends the environment's look and feel through use-cases.env:
 * BRAND_PRIMARY / BRAND_SECONDARY / BRAND_TERTIARY (rrggbb, the "#" is optional) and BRAND_LOGO (image data URL).
 * GET /branding.js sets them on the page as CSS variables (with hover, dark, soft and contrast
 * shades worked out here) and swaps every [data-brand-logo] element's content for the logo;
 * GET /branding/logo serves the image.
 */
const crypto = require('crypto');
const express = require('express');

const HEX = /^#[0-9a-fA-F]{6}$/;
const LOGO = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/;

const toRgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => '#' + rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
const mix = (hex, other, amount) => toHex(toRgb(hex).map((c, i) => c + (toRgb(other)[i] - c) * amount));

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map(c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function shades(name, hex) {
  const light = luminance(hex) > 0.6;
  return {
    [`--brand-${name}`]: hex,
    [`--brand-${name}-hover`]: mix(hex, '#000000', 0.12),
    [`--brand-${name}-dark`]: mix(hex, '#000000', 0.25),
    [`--brand-${name}-contrast`]: luminance(hex) > 0.45 ? '#111827' : '#ffffff',
    // A light color already works as a background; a strong one is reduced to a tint
    [`--brand-${name}-soft`]: light ? hex : mix(hex, '#ffffff', 0.9),
    [`--brand-${name}-border`]: light ? mix(hex, '#000000', 0.12) : mix(hex, '#ffffff', 0.65)
  };
}

function readBranding() {
  const colors = ['primary', 'secondary', 'tertiary'].map(k => [k, '#' + (process.env[`BRAND_${k.toUpperCase()}`] || '').trim().replace(/^#/, '')]);
  const logo = LOGO.exec((process.env.BRAND_LOGO || '').trim());
  return {
    vars: colors.every(([, hex]) => HEX.test(hex))
      ? Object.assign({}, ...colors.map(([k, hex]) => shades(k, hex.toLowerCase())))
      : null,
    logo: logo ? { type: logo[1], data: Buffer.from(logo[2], 'base64') } : null
  };
}

const branding = readBranding();
const logoRev = branding.logo ? crypto.createHash('sha1').update(branding.logo.data).digest('hex').slice(0, 10) : '';

function script() {
  const payload = { vars: branding.vars, logo: branding.logo ? `/branding/logo?v=${logoRev}` : null };
  return `(function () {
  var b = ${JSON.stringify(payload)};
  var root = document.documentElement;
  if (b.vars) {
    Object.keys(b.vars).forEach(function (k) { root.style.setProperty(k, b.vars[k]); });
    root.classList.add('has-brand-colors');
  }
  if (!b.logo) return;
  root.classList.add('has-brand-logo');
  function apply() {
    document.querySelectorAll('[data-brand-logo]').forEach(function (el) {
      if (el.querySelector('img.brand-logo')) return;
      var img = new Image();
      img.className = 'brand-logo';
      img.alt = '';
      img.src = b.logo;
      el.replaceChildren(img);
      el.classList.add('brand-logo-slot');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
`;
}

const router = express.Router();

router.get('/branding.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache').send(script());
});

router.get('/branding/logo', (req, res) => {
  if (!branding.logo) return res.status(404).end();
  res.set({
    'Content-Type': branding.logo.type,
    'Cache-Control': 'public, max-age=31536000, immutable',
    // Uploaded SVGs may carry scripts: never let them run if the URL is opened directly
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'X-Content-Type-Options': 'nosniff'
  });
  res.send(branding.logo.data);
});

module.exports = { router };
