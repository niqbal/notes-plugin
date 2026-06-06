// Margin Notes content script.
// Renders notes as cards in a right-side gutter that scroll with the page —
// each card is positioned at the document-relative top of its anchor.
// For print, notes are inserted inline next to each anchor's block ancestor
// and floated into the page's right margin so they print colocated.

(function () {
  'use strict';

  if (window.__MN_LOADED__) return;
  window.__MN_LOADED__ = true;

  const COLORS = ['#ffeb3b', '#ffb74d', '#81d4fa', '#a5d6a7', '#f48fb1', '#ce93d8'];
  const GUTTER_WIDTH = 280;   // reserved page right padding (px)
  const CARD_WIDTH = 256;     // card width (px)
  const CARD_GAP = 8;         // min vertical gap between stacked cards (px)
  const MARKER_SIZE = 14;
  const BLOCK_TAGS = new Set([
    'P','DIV','BLOCKQUOTE','H1','H2','H3','H4','H5','H6','LI','PRE',
    'TABLE','FIGURE','SECTION','ARTICLE','HEADER','FOOTER','MAIN','ASIDE',
    'UL','OL','DL','DD','DT','TR','TD','TH','FIGCAPTION','SUMMARY','DETAILS',
  ]);

  // -- State ----------------------------------------------------------------
  let notes = [];
  let placingNote = false;
  let root, toolbar, cardLayer, markerLayer, expandedNoteId = null;
  let gutterShown = true;
  let saveTimer = null;
  let positionTimer = null;
  let hintEl = null;

  // -- Model helpers --------------------------------------------------------
  function newId() {
    return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function makeNote({ x, y, anchor }) {
    const xpath = MNXPath.computeXPath(anchor);
    const rect = anchor.getBoundingClientRect();
    return {
      id: newId(),
      xpath,
      tag: anchor.tagName ? anchor.tagName.toLowerCase() : null,
      fingerprint: MNXPath.fingerprint(anchor),
      offsetX: x - (rect.left + window.scrollX),
      offsetY: y - (rect.top + window.scrollY),
      text: '',
      color: COLORS[notes.length % COLORS.length],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function resolveAnchor(note) {
    let el = MNXPath.resolveXPath(note.xpath);
    if (!el && note.fingerprint) el = MNXPath.findByFingerprint(note.tag, note.fingerprint);
    return el;
  }

  function blockAncestor(el) {
    let cur = el;
    while (cur && cur !== document.body && !BLOCK_TAGS.has(cur.tagName)) cur = cur.parentElement;
    return cur || el;
  }

  function docTop(el) {
    return el.getBoundingClientRect().top + window.scrollY;
  }

  function debouncedSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => MNStorage.setNotes(notes), 250);
  }

  // -- UI scaffolding -------------------------------------------------------
  function buildUI() {
    root = document.createElement('mn-root');
    root.setAttribute('data-mn-root', 'true');

    toolbar = document.createElement('div');
    toolbar.className = 'mn-toolbar';
    toolbar.innerHTML = `
      <button class="mn-btn mn-btn-primary" data-action="add" title="Add note (Alt+N)">+ Note</button>
      <button class="mn-btn" data-action="save" title="Save as self-contained HTML">Save</button>
      <button class="mn-btn" data-action="print" title="Print with notes in margin">Print</button>
      <button class="mn-btn" data-action="toggle" title="Show/hide notes (Alt+M)" data-mn-toggle>Hide</button>
      <button class="mn-btn mn-btn-danger" data-action="clear" title="Clear all notes on this page">Clear</button>
      <span class="mn-toolbar-count" data-mn-count>0</span>
    `;
    toolbar.addEventListener('click', onToolbarClick);
    root.appendChild(toolbar);

    cardLayer = document.createElement('div');
    cardLayer.className = 'mn-card-layer';
    root.appendChild(cardLayer);

    markerLayer = document.createElement('div');
    markerLayer.className = 'mn-marker-layer';
    root.appendChild(markerLayer);

    document.documentElement.appendChild(root);
    document.body.classList.add('mn-active');
  }

  function onToolbarClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'add') startPlacing();
    else if (action === 'save') saveSnapshot();
    else if (action === 'print') doPrint();
    else if (action === 'clear') confirmClear();
    else if (action === 'toggle') toggleGutter();
  }

  function toggleGutter() {
    gutterShown = !gutterShown;
    document.body.classList.toggle('mn-active', gutterShown);
    root.classList.toggle('mn-hidden', !gutterShown);
    const btn = toolbar.querySelector('[data-mn-toggle]');
    if (btn) btn.textContent = gutterShown ? 'Hide' : 'Show';
    positionCards();
  }

  // -- Placement ------------------------------------------------------------
  function startPlacing() {
    if (placingNote) return;
    placingNote = true;
    document.body.classList.add('mn-placing');
    showHint('Click anywhere on the page to attach a note. Press Esc to cancel.');
    document.addEventListener('click', onPlaceClick, true);
    document.addEventListener('keydown', onPlaceEsc, true);
  }

  function stopPlacing() {
    placingNote = false;
    document.body.classList.remove('mn-placing');
    document.removeEventListener('click', onPlaceClick, true);
    document.removeEventListener('keydown', onPlaceEsc, true);
    hideHint();
  }

  function onPlaceEsc(e) {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      stopPlacing();
    }
  }

  function onPlaceClick(e) {
    if (!placingNote) return;
    if (e.target.closest('mn-root')) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const anchor = MNXPath.pickAnchorAtPoint(e.clientX, e.clientY);
    const note = makeNote({
      x: e.clientX + window.scrollX,
      y: e.clientY + window.scrollY,
      anchor,
    });
    notes.push(note);
    debouncedSave();
    render();
    stopPlacing();
    // Don't scroll — the new card already lives at the anchor's docTop, so
    // the user's viewport is already where it should be. Just focus the
    // textarea (with preventScroll so the browser doesn't try to nudge us).
    focusNote(note.id, { scroll: false });
  }

  function addNoteAtViewport() {
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 3;
    const anchor = MNXPath.pickAnchorAtPoint(x, y) || document.body;
    const note = makeNote({
      x: x + window.scrollX, y: y + window.scrollY, anchor,
    });
    notes.push(note);
    debouncedSave();
    render();
    focusNote(note.id, { scroll: false });
  }

  // -- Rendering ------------------------------------------------------------
  function render() {
    renderCards();
    renderMarkers();
    positionCards();
    updateCount();
  }

  function updateCount() {
    const el = toolbar.querySelector('[data-mn-count]');
    if (el) el.textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
  }

  function renderCards() {
    // Diff: keep existing cards if their note still exists; create new ones; remove stale.
    const existing = new Map();
    for (const el of cardLayer.querySelectorAll('.mn-card')) existing.set(el.dataset.id, el);

    const wanted = new Set(notes.map(n => n.id));
    for (const [id, el] of existing) if (!wanted.has(id)) el.remove();

    for (const n of notes) {
      let card = existing.get(n.id);
      if (!card) {
        card = document.createElement('div');
        card.className = 'mn-card';
        card.dataset.id = n.id;
        card.innerHTML = `
          <div class="mn-card-anchor" data-mn-anchor></div>
          <textarea class="mn-card-text" placeholder="Write your note..."></textarea>
          <div class="mn-card-tools">
            <div class="mn-swatches" data-mn-swatches></div>
            <div class="mn-card-actions">
              <button class="mn-btn mn-btn-small" data-mn-jump title="Scroll to anchor">Jump</button>
              <button class="mn-btn mn-btn-small mn-btn-danger" data-mn-del title="Delete note">×</button>
            </div>
          </div>
        `;
        cardLayer.appendChild(card);

        const ta = card.querySelector('textarea');
        ta.addEventListener('input', () => onTextInput(n.id, ta.value));
        ta.addEventListener('focus', () => setExpanded(n.id, true));
        ta.addEventListener('blur', () => setExpanded(n.id, false));

        card.addEventListener('mouseenter', () => {
          highlightAnchor(n.id, true);
          card.classList.add('mn-card-hover');
        });
        card.addEventListener('mouseleave', () => {
          highlightAnchor(n.id, false);
          card.classList.remove('mn-card-hover');
        });

        card.querySelector('[data-mn-jump]').addEventListener('click', (e) => { e.stopPropagation(); jumpTo(n.id); });
        card.querySelector('[data-mn-del]').addEventListener('click', (e) => { e.stopPropagation(); deleteNote(n.id); });

        const swEl = card.querySelector('[data-mn-swatches]');
        for (const c of COLORS) {
          const sw = document.createElement('button');
          sw.className = 'mn-swatch';
          sw.style.background = c;
          sw.dataset.color = c;
          sw.addEventListener('click', (e) => { e.stopPropagation(); setColor(n.id, c); });
          swEl.appendChild(sw);
        }
      }

      // Sync content
      card.style.borderLeftColor = n.color;
      card.dataset.color = n.color;
      card.querySelector('[data-mn-anchor]').textContent = (n.fingerprint || '').slice(0, 80) || '(no anchor text)';
      const ta = card.querySelector('textarea');
      if (document.activeElement !== ta && ta.value !== (n.text || '')) ta.value = n.text || '';
      for (const sw of card.querySelectorAll('.mn-swatch')) {
        sw.classList.toggle('mn-swatch-on', sw.dataset.color === n.color);
      }
      card.classList.toggle('mn-card-expanded', n.id === expandedNoteId);
    }
  }

  function renderMarkers() {
    const existing = new Map();
    for (const el of markerLayer.querySelectorAll('mn-marker')) existing.set(el.dataset.id, el);
    const wanted = new Set(notes.map(n => n.id));
    for (const [id, el] of existing) if (!wanted.has(id)) el.remove();

    for (const n of notes) {
      let m = existing.get(n.id);
      if (!m) {
        m = document.createElement('mn-marker');
        m.className = 'mn-marker';
        m.dataset.id = n.id;
        m.addEventListener('click', (e) => { e.stopPropagation(); focusNote(n.id); });
        m.addEventListener('mouseenter', () => {
          highlightAnchor(n.id, true);
          const card = cardLayer.querySelector(`.mn-card[data-id="${n.id}"]`);
          if (card) card.classList.add('mn-card-hover');
        });
        m.addEventListener('mouseleave', () => {
          highlightAnchor(n.id, false);
          const card = cardLayer.querySelector(`.mn-card[data-id="${n.id}"]`);
          if (card) card.classList.remove('mn-card-hover');
        });
        markerLayer.appendChild(m);
      }
      m.style.background = n.color;
      m.title = (n.text || '').slice(0, 200) || 'Margin note';
    }
  }

  // Position cards and markers based on current anchors. Collision-avoid by
  // sorting cards top-to-bottom and pushing overlapping cards down.
  function positionCards() {
    const layout = [];
    for (const n of notes) {
      const el = resolveAnchor(n);
      const card = cardLayer.querySelector(`.mn-card[data-id="${n.id}"]`);
      const marker = markerLayer.querySelector(`mn-marker[data-id="${n.id}"]`);
      if (!card) continue;
      if (!el) {
        card.classList.add('mn-card-orphan');
        if (marker) {
          marker.classList.add('mn-marker-orphan');
          marker.title = 'Anchor not found on this page';
        }
        layout.push({ card, marker, top: 0, orphan: true });
        continue;
      }
      card.classList.remove('mn-card-orphan');
      if (marker) marker.classList.remove('mn-marker-orphan');
      const rect = el.getBoundingClientRect();
      const anchorTopDoc = rect.top + window.scrollY;
      const anchorLeftDoc = rect.left + window.scrollX;
      // Position marker at anchor + offset.
      if (marker) {
        marker.style.left = Math.max(0, anchorLeftDoc + (n.offsetX || 8)) + 'px';
        marker.style.top = Math.max(0, anchorTopDoc + (n.offsetY || 8)) + 'px';
      }
      layout.push({ card, marker, top: anchorTopDoc, orphan: false });
    }

    // Sort by anchor top, then resolve collisions among non-orphans.
    const nonOrphans = layout.filter(x => !x.orphan).sort((a, b) => a.top - b.top);
    let lastBottom = 0;
    for (const item of nonOrphans) {
      const desired = item.top;
      const top = Math.max(desired, lastBottom + CARD_GAP);
      item.card.style.top = top + 'px';
      item.card.dataset.desiredTop = String(desired);
      const h = item.card.getBoundingClientRect().height || 60;
      lastBottom = top + h;
    }

    // Park orphans at the top of the gutter, stacked.
    let orphanTop = window.scrollY + 60;
    for (const item of layout.filter(x => x.orphan)) {
      item.card.style.top = orphanTop + 'px';
      orphanTop += (item.card.getBoundingClientRect().height || 60) + CARD_GAP;
    }

    // Set mn-root height so position:absolute children stay within document.
    const maxNeeded = Math.max(
      document.documentElement.scrollHeight,
      ...nonOrphans.map(x => parseFloat(x.card.style.top) + (x.card.getBoundingClientRect().height || 60))
    );
    root.style.height = Math.ceil(maxNeeded) + 'px';
  }

  function schedulePosition() {
    if (positionTimer) cancelAnimationFrame(positionTimer);
    positionTimer = requestAnimationFrame(positionCards);
  }

  // -- Interactions ---------------------------------------------------------
  function setExpanded(id, on) {
    expandedNoteId = on ? id : (expandedNoteId === id ? null : expandedNoteId);
    for (const c of cardLayer.querySelectorAll('.mn-card')) {
      c.classList.toggle('mn-card-expanded', c.dataset.id === expandedNoteId);
    }
    schedulePosition();
  }

  // focusNote opens the textarea for editing.
  // By default it does NOT scroll — the card is positioned at its anchor's
  // docTop, so when you've just placed a note the viewport is already where
  // it should be. Pass { scroll: true } for explicit "jump to this note"
  // affordances (e.g. when a user clicks a far-away marker).
  function focusNote(id, opts) {
    const card = cardLayer.querySelector(`.mn-card[data-id="${id}"]`);
    if (!card) return;
    const wantScroll = !!(opts && opts.scroll);
    if (wantScroll) {
      // Only scroll if the card isn't already in the viewport.
      const r = card.getBoundingClientRect();
      const inView = r.top >= 0 && r.bottom <= window.innerHeight;
      if (!inView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const ta = card.querySelector('textarea');
    if (ta) setTimeout(() => {
      try { ta.focus({ preventScroll: true }); }
      catch (e) { ta.focus(); }
    }, 50);
  }

  function highlightAnchor(id, on) {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    const el = resolveAnchor(n);
    if (!el) return;
    el.classList.toggle('mn-highlight', on);
  }

  function onTextInput(id, value) {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    n.text = value;
    n.updatedAt = Date.now();
    debouncedSave();
    const m = markerLayer.querySelector(`mn-marker[data-id="${id}"]`);
    if (m) m.title = (n.text || '').slice(0, 200) || 'Margin note';
    schedulePosition();
  }

  function setColor(id, color) {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    n.color = color;
    n.updatedAt = Date.now();
    debouncedSave();
    renderCards();
    renderMarkers();
  }

  function jumpTo(id) {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    const el = resolveAnchor(n);
    if (!el) {
      showHint('Anchor not found on this page.');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('mn-flash');
    setTimeout(() => el.classList.remove('mn-flash'), 1500);
  }

  function deleteNote(id) {
    notes = notes.filter(n => n.id !== id);
    debouncedSave();
    render();
  }

  function confirmClear() {
    if (!notes.length) return;
    if (!confirm(`Delete all ${notes.length} notes on this page?`)) return;
    notes = [];
    MNStorage.clearNotes();
    render();
  }

  // -- Hint toast -----------------------------------------------------------
  function showHint(msg) {
    hideHint();
    hintEl = document.createElement('div');
    hintEl.className = 'mn-hint-toast';
    hintEl.textContent = msg;
    root.appendChild(hintEl);
    setTimeout(hideHint, 4000);
  }
  function hideHint() {
    if (hintEl && hintEl.parentNode) hintEl.parentNode.removeChild(hintEl);
    hintEl = null;
  }

  // -- Save snapshot --------------------------------------------------------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cssEscape(s) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(s);
    return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function resolveInClone(rootEl, xpath) {
    if (!xpath) return null;
    if (xpath.startsWith('//*[@id=')) {
      const m = xpath.match(/^\/\/\*\[@id="([^"]+)"\]$/);
      if (m) return rootEl.querySelector('#' + cssEscape(m[1]));
    }
    const parts = xpath.replace(/^\/+/, '').split('/');
    let cur = rootEl;
    if (!cur.tagName || cur.tagName.toLowerCase() !== 'html') return null;
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const m = part.match(/^([a-zA-Z][a-zA-Z0-9-]*)(?:\[(\d+)\])?$/);
      if (!m) return null;
      const tag = m[1].toLowerCase();
      const idx = m[2] ? parseInt(m[2], 10) : 1;
      let count = 0, next = null;
      for (const child of cur.children) {
        if (child.tagName && child.tagName.toLowerCase() === tag) {
          count++;
          if (count === idx) { next = child; break; }
        }
      }
      if (!next) return null;
      cur = next;
    }
    return cur;
  }

  function blockAncestorIn(rootEl, el) {
    let cur = el;
    while (cur && cur !== rootEl && cur.tagName !== 'BODY' && !BLOCK_TAGS.has(cur.tagName)) cur = cur.parentElement;
    return cur && cur !== rootEl ? cur : el;
  }

  function findInCloneByFingerprint(rootEl, tag, snippet) {
    if (!snippet) return null;
    const lower = snippet.toLowerCase();
    const candidates = rootEl.querySelectorAll((tag || '*'));
    for (const el of candidates) {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (t.startsWith(lower)) return el;
    }
    return null;
  }

  function buildSnapshot() {
    // Pre-compute each anchor's document-relative top on the LIVE page,
    // before cloning. We'll position each snapshot sidenote at exactly that
    // top so it always lands in the right margin — independent of how deeply
    // nested the anchor is in the page's own layout containers. Float-based
    // layouts can get trapped inside SaaS apps' inner divs; absolute
    // positioning on body sidesteps that entirely.
    const liveTops = {};
    for (const n of notes) {
      const el = resolveAnchor(n);
      if (el) {
        const rect = el.getBoundingClientRect();
        liveTops[n.id] = rect.top + window.scrollY;
      } else {
        liveTops[n.id] = null;
      }
    }

    const docClone = document.documentElement.cloneNode(true);
    docClone.querySelectorAll('mn-root, [data-mn-root]').forEach(n => n.remove());
    docClone.querySelectorAll('script').forEach(s => s.remove());

    const notesData = notes.map(n => ({ ...n, __top: liveTops[n.id] }));
    const bodyClone = docClone.querySelector('body');
    if (!bodyClone) return '<!DOCTYPE html>\n' + docClone.outerHTML;

    bodyClone.classList.add('mn-snap-body');

    // Inline #N badges at each anchor (kept for visual cross-reference).
    const placed = [];
    const orphans = [];
    let noteIdx = 0;
    for (const n of notesData) {
      noteIdx++;
      n.__idx = noteIdx;
      let anchorInClone = resolveInClone(docClone, n.xpath);
      if (!anchorInClone) anchorInClone = findInCloneByFingerprint(docClone, n.tag, n.fingerprint);
      if (anchorInClone && typeof n.__top === 'number') {
        const inlineMarker = docClone.ownerDocument.createElement('span');
        inlineMarker.className = 'mn-snap-marker';
        inlineMarker.dataset.mnId = n.id;
        inlineMarker.style.background = n.color;
        inlineMarker.textContent = '#' + noteIdx;
        inlineMarker.title = (n.text || '').slice(0, 200);
        if (anchorInClone.firstChild) anchorInClone.insertBefore(inlineMarker, anchorInClone.firstChild);
        else anchorInClone.appendChild(inlineMarker);
        placed.push(n);
      } else {
        orphans.push({ note: n, idx: noteIdx });
      }
    }

    // Build the gutter container at body level — its absolute children are
    // positioned relative to body (which we mark position:relative), so they
    // ignore any inner page containers.
    const gutter = docClone.ownerDocument.createElement('div');
    gutter.className = 'mn-snap-gutter';

    // Collision avoidance: sort by anchor top, push overlapping cards down.
    const CARD_HEIGHT_EST = 80;
    const GAP = 8;
    placed.sort((a, b) => a.__top - b.__top);
    let lastBottom = 0;
    for (const n of placed) {
      const desired = Math.max(0, n.__top);
      const top = Math.max(desired, lastBottom + GAP);
      const aside = docClone.ownerDocument.createElement('aside');
      aside.className = 'mn-snap-sidenote';
      aside.dataset.mnId = n.id;
      aside.style.borderLeftColor = n.color;
      aside.style.top = top + 'px';
      const anchorPreview = escapeHtml((n.fingerprint || '').slice(0, 80));
      aside.innerHTML = `
        <span class="mn-snap-sidenote-num" style="background:${escapeHtml(n.color)}">#${n.__idx}</span>
        ${anchorPreview ? `<div class="mn-snap-sidenote-anchor">↳ ${anchorPreview}</div>` : ''}
        <div class="mn-snap-sidenote-text">${escapeHtml(n.text || '(empty)')}</div>
      `;
      gutter.appendChild(aside);
      lastBottom = top + CARD_HEIGHT_EST;
    }

    bodyClone.appendChild(gutter);

    const snapStyles = `
      :root { --mn-snap-gutter: 280px; --mn-snap-sidenote: 256px; }

      /* Make body the containing block so absolute children of the gutter
         resolve their coordinates against the document, not against some
         inner container. padding-right reserves the gutter so original
         content doesn't sit under the notes. */
      body.mn-snap-body {
        position: relative !important;
        padding-right: var(--mn-snap-gutter) !important;
        box-sizing: border-box;
      }

      .mn-snap-marker {
        display: inline-block; color: #000;
        padding: 0 5px; border-radius: 8px;
        font-size: 10px; font-weight: 600; line-height: 1.4;
        vertical-align: baseline; margin-right: 4px;
        border: 1px solid rgba(0,0,0,0.2);
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }

      .mn-snap-gutter {
        position: absolute;
        top: 0;
        right: 0;
        width: var(--mn-snap-gutter);
        pointer-events: none;
        z-index: 1000;
      }

      aside.mn-snap-sidenote {
        position: absolute;
        right: 8px;
        width: var(--mn-snap-sidenote);
        padding: 8px 10px;
        background: #fff;
        border: 1px solid #e0e0e0;
        border-left: 4px solid #ccc;
        border-radius: 3px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.06);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        color: #222;
        pointer-events: auto;
        page-break-inside: avoid;
        break-inside: avoid;
        box-sizing: border-box;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      aside.mn-snap-sidenote .mn-snap-sidenote-num {
        display: inline-block; padding: 0 5px;
        border-radius: 8px; font-size: 10px; font-weight: 600;
        margin-bottom: 4px; color: #000;
        border: 1px solid rgba(0,0,0,0.15);
      }
      aside.mn-snap-sidenote .mn-snap-sidenote-anchor {
        font-size: 10px; color: #888; margin: 4px 0;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      aside.mn-snap-sidenote .mn-snap-sidenote-text {
        white-space: pre-wrap; font-size: 12px; color: #222;
      }

      .mn-snap-orphan-box {
        clear: both;
        margin: 32px 0 0;
        padding: 16px 0 0;
        border-top: 1px solid #ccc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
      }
      .mn-snap-orphan-box h2 { font-size: 14px; margin: 0 0 8px; color: #222; }
      .mn-snap-orphan-box .mn-snap-orphan {
        background: #fff; border: 1px solid #e0e0e0; border-left: 4px solid #ccc;
        border-radius: 3px; padding: 8px 10px; margin: 0 0 8px;
      }

      @media print {
        @page { margin: 0.5in; }
        :root { --mn-snap-gutter: 2in; --mn-snap-sidenote: 1.85in; }
        body.mn-snap-body { padding-right: 2in !important; }
        aside.mn-snap-sidenote {
          right: 4pt;
          font-size: 9pt;
          padding: 4pt 8pt;
          box-shadow: none;
          background: #fff !important;
          border: 0.5pt solid #999;
          border-left-width: 3pt;
        }
        aside.mn-snap-sidenote .mn-snap-sidenote-num { font-size: 8pt; }
        aside.mn-snap-sidenote .mn-snap-sidenote-anchor { font-size: 8pt; }
        aside.mn-snap-sidenote .mn-snap-sidenote-text { font-size: 9pt; }
        .mn-snap-marker { font-size: 8pt; padding: 0 3pt; border: 0.5pt solid #444; }
      }
    `;

    // Inject styles + meta.
    const headClone = docClone.querySelector('head');
    if (headClone) {
      const style = docClone.ownerDocument.createElement('style');
      style.setAttribute('data-mn-snapshot-style', 'true');
      style.textContent = snapStyles;
      headClone.appendChild(style);

      const meta = docClone.ownerDocument.createElement('meta');
      meta.setAttribute('name', 'mn-snapshot');
      meta.setAttribute('content', JSON.stringify({
        capturedAt: new Date().toISOString(),
        url: location.href,
        notes: notesData.length,
      }));
      headClone.appendChild(meta);
    }

    // Orphans: render at end as a footer block so they're not lost.
    if (orphans.length) {
      const box = docClone.ownerDocument.createElement('div');
      box.className = 'mn-snap-orphan-box';
      box.innerHTML = `<h2>Margin Notes — orphaned (anchor not found): ${orphans.length}</h2>` +
        orphans.map(({ note, idx }) =>
          `<div class="mn-snap-orphan" style="border-left-color:${escapeHtml(note.color)}">
            <span class="mn-snap-sidenote-num" style="background:${escapeHtml(note.color)};display:inline-block;padding:0 5px;border-radius:8px;font-size:10px;font-weight:600;color:#000;margin-right:6px;">#${idx}</span>
            ${note.fingerprint ? `<span style="font-size:11px;color:#888;">↳ ${escapeHtml(note.fingerprint.slice(0,60))}</span>` : ''}
            <div style="white-space:pre-wrap;margin-top:4px;font-size:12px;color:#222;">${escapeHtml(note.text || '(empty)')}</div>
          </div>`
        ).join('\n');
      bodyClone.appendChild(box);
    }

    return '<!DOCTYPE html>\n' + docClone.outerHTML;
  }

  async function saveSnapshot() {
    const html = buildSnapshot();
    const safeTitle = (document.title || 'page').replace(/[^\w\s.-]+/g, '_').slice(0, 60).trim() || 'page';
    const filename = `margin-notes_${safeTitle}_${new Date().toISOString().slice(0,10)}.html`;
    chrome.runtime.sendMessage(
      { type: 'mn-download', filename, html },
      (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename;
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        }
        showHint('Saved snapshot: ' + filename);
      }
    );
  }

  // -- Print ---------------------------------------------------------------
  // For print, inline a sidenote next to each anchor's nearest block ancestor
  // and let the page's right margin (which we expand via @media print) absorb
  // it via a negative right margin. The result: notes print colocated.

  function injectPrintArtifacts() {
    document.body.classList.add('mn-printing');
    cleanupPrintArtifacts(); // safety
    let idx = 0;
    for (const n of notes) {
      idx++;
      const el = resolveAnchor(n);
      if (!el) continue;

      // Inline ID badge inside the anchor.
      const badge = document.createElement('span');
      badge.className = 'mn-print-tag';
      badge.dataset.mnId = n.id;
      badge.style.background = n.color;
      badge.textContent = '#' + idx;
      el.insertBefore(badge, el.firstChild);

      // Floating sidenote next to the block ancestor.
      const block = blockAncestor(el);
      const aside = document.createElement('aside');
      aside.className = 'mn-print-sidenote';
      aside.dataset.mnId = n.id;
      aside.style.borderLeftColor = n.color;
      aside.innerHTML = `
        <span class="mn-print-sidenote-num" style="background:${escapeHtml(n.color)}">#${idx}</span>
        ${n.fingerprint ? `<div class="mn-print-sidenote-anchor">↳ ${escapeHtml(n.fingerprint.slice(0,80))}</div>` : ''}
        <div class="mn-print-sidenote-text">${escapeHtml(n.text || '(empty)')}</div>
      `;
      block.insertAdjacentElement('afterend', aside);
    }
  }

  function cleanupPrintArtifacts() {
    document.querySelectorAll('.mn-print-tag, .mn-print-sidenote').forEach(n => n.remove());
  }

  function doPrint() {
    injectPrintArtifacts();
    const cleanup = () => {
      document.body.classList.remove('mn-printing');
      cleanupPrintArtifacts();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // Safety: also cleanup after a delay in case afterprint doesn't fire.
    setTimeout(() => { if (document.body.classList.contains('mn-printing')) cleanup(); }, 60_000);
    setTimeout(() => window.print(), 100);
  }

  // -- Messages -------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'mn-toggle') { toggleGutter(); sendResponse({ ok: true }); }
    else if (msg.type === 'mn-add') { addNoteAtViewport(); sendResponse({ ok: true }); }
    else if (msg.type === 'mn-place') { startPlacing(); sendResponse({ ok: true }); }
    else if (msg.type === 'mn-save') { saveSnapshot(); sendResponse({ ok: true }); }
    else if (msg.type === 'mn-print') { doPrint(); sendResponse({ ok: true }); }
    else if (msg.type === 'mn-clear') { confirmClear(); sendResponse({ ok: true }); }
    else if (msg.type === 'mn-list') { sendResponse({ ok: true, notes }); }
    return true;
  });

  // -- Lifecycle ------------------------------------------------------------
  async function init() {
    buildUI();
    notes = await MNStorage.getNotes();
    render();
    if (!notes.length) {
      // Don't show the gutter pre-emptively when there's nothing there yet.
      // Toolbar stays visible so users can add their first note.
    }
    window.addEventListener('scroll', schedulePosition, { passive: true });
    window.addEventListener('resize', schedulePosition);
    // Periodic rescue: handles lazy-loaded content shifting anchors.
    setInterval(schedulePosition, 1500);
    // Mutation observer: any DOM change repositions cards.
    try {
      const mo = new MutationObserver(() => schedulePosition());
      mo.observe(document.body, { childList: true, subtree: true, attributes: false, characterData: false });
    } catch (e) { /* ignore */ }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
