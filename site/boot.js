// Apply saved appearance before first paint. Storage errors are explained by reader.js.
try {
  const s = JSON.parse(localStorage.getItem('velt-price-reader-2026-11') || 'null');
  if (s && ['auto','paper','light','night'].includes(s.theme)) document.documentElement.dataset.theme = s.theme;
  if (s && ['book','clear'].includes(s.style)) document.documentElement.dataset.style = s.style;
} catch (error) { console.warn('VELT: appearance will use system defaults', error); }
