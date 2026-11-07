(() => {
  'use strict';
  const root = document.documentElement;
  const key = 'velt-price-reader-2026-11';
  const validPage = id => /^chapter-(?:[1-9]|1\d|20)$/.test(id || '');
  const defaults = { theme: 'auto', style: 'book', size: 21, leading: '1.8', width: '65', positions: {}, bookmarks: {} };
  let state = { ...defaults, positions: {}, bookmarks: {} };
  let storageFailed = false;
  let storageMessage = '';
  const note = document.getElementById('notice');
  let noteTimer;
  function notify(message) {
    clearTimeout(noteTimer);
    note.textContent = message;
    note.hidden = false;
    noteTimer = setTimeout(() => { note.hidden = true; }, 4500);
  }
  function reportStorage(error) {
    console.warn('VELT: browser storage unavailable', error);
    if (!storageFailed) storageMessage = 'Браузер не сохраняет настройки. Они будут работать до закрытия страницы.';
    storageFailed = true;
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid reader settings');
      state = { ...state, ...value };
    }
  } catch (error) { reportStorage(error); }
  function recordMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, v]) => validPage(id) && v && typeof v === 'object'));
  }
  state.positions = recordMap(state.positions);
  state.bookmarks = recordMap(state.bookmarks);
  state.size = Math.max(17, Math.min(29, Number(state.size) || 21));
  for (const [name, values] of Object.entries({theme:['auto','paper','light','night'],style:['book','clear'],leading:['1.6','1.8','2'],width:['54','65','74']})) {
    if (!values.includes(state[name])) state[name] = defaults[name];
  }
  function save() {
    if (storageFailed) return;
    try { localStorage.setItem(key, JSON.stringify(state)); }
    catch (error) { reportStorage(error); notify(storageMessage); storageMessage = ''; }
  }
  function apply() {
    root.dataset.theme = state.theme;
    root.dataset.style = state.style;
    root.style.setProperty('--reader-size', `${state.size}px`);
    root.style.setProperty('--leading', state.leading);
    root.style.setProperty('--measure', `${state.width}ch`);
    document.querySelectorAll('[data-setting]').forEach(button => {
      button.setAttribute('aria-pressed', String(state[button.dataset.setting] === button.dataset.value));
    });
    document.getElementById('size-value').value = state.size;
    document.getElementById('size-less').disabled = state.size <= 17;
    document.getElementById('size-more').disabled = state.size >= 29;
    document.getElementById('line-height').value = state.leading;
    document.getElementById('line-width').value = state.width;
    const resolvedNight = state.theme === 'night' || (state.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]').content = resolvedNight ? '#17191a' : state.theme === 'light' ? '#ffffff' : '#f6f3eb';
    const nightButton = document.getElementById('night-toggle');
    nightButton.setAttribute('aria-pressed', String(resolvedNight));
    nightButton.setAttribute('aria-label', resolvedNight ? 'Включить бумажную тему' : 'Включить ночную тему');
  }
  apply();
  if (storageMessage) { notify(storageMessage); storageMessage = ''; }
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  systemTheme.addEventListener('change', apply);
  document.querySelectorAll('[data-setting]').forEach(button => button.addEventListener('click', () => {
    state[button.dataset.setting] = button.dataset.value; apply(); save();
  }));
  document.getElementById('size-less').addEventListener('click', () => { state.size = Math.max(17, state.size - 1); apply(); save(); });
  document.getElementById('size-more').addEventListener('click', () => { state.size = Math.min(29, state.size + 1); apply(); save(); });
  for (const [id, name] of [['line-height','leading'],['line-width','width']]) {
    document.getElementById(id).addEventListener('change', event => { state[name] = event.target.value; apply(); save(); });
  }
  document.getElementById('night-toggle').addEventListener('click', () => {
    const isNight = document.getElementById('night-toggle').getAttribute('aria-pressed') === 'true';
    state.theme = isNight ? 'paper' : 'night'; apply(); save();
  });
  const dialogs = [...document.querySelectorAll('dialog')];
  let opener = null;
  document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => {
    const dialog = document.getElementById(button.dataset.open);
    if (!dialog) return;
    opener = button;
    dialog.showModal();
  }));
  dialogs.forEach(dialog => {
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus({preventScroll:true}); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:not(:disabled), input, select, a[href]')].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const b = dialog.getBoundingClientRect();
      if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) dialog.close();
    });
  });
  const chapterLinks = [...document.querySelectorAll('#toc-list .chapter-link')];
  const chapterTitles = Object.fromEntries(chapterLinks.map(link => [link.dataset.page, link.querySelector('.chapter-name').textContent]));
  const filter = document.getElementById('chapter-filter');
  filter.addEventListener('input', () => {
    const q = filter.value.toLocaleLowerCase('ru').trim();
    let count = 0;
    chapterLinks.forEach(link => {
      const found = `${link.dataset.number} ${link.textContent}`.toLocaleLowerCase('ru').includes(q);
      link.parentElement.hidden = !found;
      if (found) count++;
    });
    document.getElementById('toc-empty').hidden = count > 0;
    document.getElementById('toc-count').textContent = q ? `Найдено глав: ${count}` : '';
  });
  function renderBookmarks() {
    const box = document.getElementById('bookmark-list');
    box.replaceChildren();
    const entries = Object.entries(state.bookmarks);
    document.getElementById('bookmark-section').hidden = entries.length === 0;
    for (const [id, value] of entries) {
      if (!chapterTitles[id]) continue;
      const a = document.createElement('a');
      a.textContent = `Глава ${id.slice(8)} · ${chapterTitles[id]}`;
      const anchor = /^p-\d+$/.test(value.paragraph || '') ? `#${value.paragraph}` : '';
      a.href = `${id}.html${anchor}`;
      box.append(a);
    }
  }
  renderBookmarks();
  const resume = document.getElementById('resume');
  if (resume && validPage(state.lastPage) && chapterTitles[state.lastPage]) {
    resume.href = `${state.lastPage}.html`;
    document.getElementById('resume-label').textContent = 'Продолжить чтение';
    document.getElementById('resume-note').textContent = `Глава ${state.lastPage.slice(8)} · ${chapterTitles[state.lastPage]}`;
  }
  if (!document.body.classList.contains('reading')) return;
  const pageId = document.body.dataset.page;
  const prose = document.querySelector('.prose');
  const paragraphs = [...prose.querySelectorAll('p')];
  const progress = document.getElementById('progress');
  const bookmarkButton = document.getElementById('bookmark-toggle');
  let ready = false;
  let ticking = false;
  let saveTimer;
  function topOffset() { return document.body.classList.contains('focus') ? 24 : (innerWidth <= 620 ? 92 : 104); }
  function currentParagraph() {
    let active = paragraphs[0];
    const offset = topOffset();
    for (const p of paragraphs) { if (p.getBoundingClientRect().top > offset) break; active = p; }
    return active;
  }
  function position(persist = false) {
    if (!ready) return;
    const bounds = prose.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (topOffset() - bounds.top) / Math.max(1, bounds.height - innerHeight + topOffset() + 40)));
    progress.style.transform = `scaleX(${ratio})`;
    const p = currentParagraph();
    state.positions[pageId] = { paragraph:p.id, offset:p.getBoundingClientRect().top - topOffset(), ratio };
    state.lastPage = pageId;
    if (persist) save();
    else { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }
  }
  function bookmarkLabel() {
    const set = Boolean(state.bookmarks[pageId]);
    bookmarkButton.setAttribute('aria-pressed', String(set));
    bookmarkButton.setAttribute('aria-label', set ? 'Убрать закладку этой главы' : 'Поставить закладку');
    document.getElementById('bookmark-label').textContent = set ? 'В закладках' : 'Закладка';
  }
  bookmarkLabel();
  bookmarkButton.addEventListener('click', () => {
    if (state.bookmarks[pageId]) { delete state.bookmarks[pageId]; notify('Закладка убрана'); }
    else { state.bookmarks[pageId] = {paragraph:currentParagraph().id}; notify('Место добавлено в оглавление'); }
    bookmarkLabel(); renderBookmarks(); save();
  });
  document.getElementById('focus-toggle').addEventListener('click', () => { document.body.classList.add('focus'); position(); });
  function leaveFocus() { document.body.classList.remove('focus'); document.getElementById('focus-toggle').focus({preventScroll:true}); position(); }
  document.getElementById('focus-exit').addEventListener('click', leaveFocus);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('focus')) leaveFocus(); });
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(() => {
    const saved = state.positions[pageId];
    if (!location.hash && saved && /^p-\d+$/.test(saved.paragraph || '')) {
      const p = document.getElementById(saved.paragraph);
      if (p) scrollTo(0, Math.max(0, p.getBoundingClientRect().top + scrollY - topOffset() - (Number(saved.offset) || 0)));
    }
    ready = true;
    position(true);
  }));
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; position(); });
  }, {passive:true});
  addEventListener('resize', () => position(), {passive:true});
  addEventListener('pagehide', () => position(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) position(true); });
})();
