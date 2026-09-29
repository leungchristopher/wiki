import 'katex/dist/katex.min.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import Panzoom from '@panzoom/panzoom';

const app = document.querySelector('#app');
const state = { title: null, view: 'home', page: null, dirty: false, related: false, selected: 0, results: [], query: '', graphPanzoom: null };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const api = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
};
const pageUrl = title => `/p/${encodeURIComponent(title)}`;
const pageApi = title => `/api/pages/${encodeURIComponent(title)}`;
const link = title => `<a href="${esc(pageUrl(title))}" data-page="${esc(title)}">${esc(title)}</a>`;
const math = (expression, displayMode) => { try { return katex.renderToString(expression, { displayMode, throwOnError: false, trust: false, strict: 'ignore' }); } catch { return esc(expression); } };
marked.use({ gfm: true, extensions: [
  { name: 'wikilink', level: 'inline', start: source => source.indexOf('[['), tokenizer(source) { const match = /^\[\[([^\]\n]+)\]\]/.exec(source); if (match) return { type: 'wikilink', raw: match[0], title: match[1].trim() }; }, renderer: token => link(token.title) },
  { name: 'mathblock', level: 'block', start: source => source.indexOf('$$'), tokenizer(source) { const match = /^\$\$\s*\n?([\s\S]+?)\n?\s*\$\$(?:\n|$)/.exec(source); if (match) return { type: 'mathblock', raw: match[0], expression: match[1] }; }, renderer: token => math(token.expression, true) },
  { name: 'mathinline', level: 'inline', start: source => source.indexOf('$'), tokenizer(source) { const match = /^\$([^$\n]+?)\$/.exec(source); if (match) return { type: 'mathinline', raw: match[0], expression: match[1] }; }, renderer: token => math(token.expression, false) }
] });
const markdown = source => DOMPurify.sanitize(marked.parse(source), { ADD_TAGS: ['math','semantics','mrow','mi','mn','mo','msup','msub','mfrac','mspace','mtext','annotation','span'], ADD_ATTR: ['xmlns','encoding','aria-hidden'] });
const currentDraft = () => document.querySelector('#editor')?.value;
const draftKey = title => `wiki-draft:${title}`;
function rememberDraft() { if (state.view === 'edit' && state.dirty && state.title) sessionStorage.setItem(draftKey(state.title), currentDraft()); }
function mayLeave() { if (!state.dirty) return true; rememberDraft(); return window.confirm('You have unsaved changes. Leave this page? Your draft will be kept.'); }
function shell(body) {
  state.graphPanzoom?.destroy(); state.graphPanzoom = null;
  app.innerHTML = `<header class="top"><a class="brand" href="/">wiki</a><div class="command-wrap"><input id="command" autocomplete="off" spellcheck="false" aria-label="Command" placeholder="command"><div id="completions" class="completions" hidden></div></div></header><main>${body}</main><div id="message" role="status"></div>`;
  const command = document.querySelector('#command');
  command.addEventListener('input', () => { completions(); if (state.view === 'search' && command.value.startsWith('search')) showResults(command.value.replace(/^search\s*/, '')); });
  command.addEventListener('focus', completions);
  command.addEventListener('blur', () => setTimeout(() => { const box = document.querySelector('#completions'); if (box) box.hidden = true; }, 150));
  command.addEventListener('keydown', async event => {
    if (event.key === 'ArrowDown' && state.view === 'search' && state.results.length) { event.preventDefault(); state.selected = Math.min(state.selected + 1, state.results.length - 1); paintSelection(); return; }
    if (event.key === 'ArrowUp' && state.view === 'search' && state.results.length) { event.preventDefault(); state.selected = Math.max(state.selected - 1, 0); paintSelection(); return; }
    if (event.key === 'Enter') { event.preventDefault(); const value = command.value.trim(); command.value = ''; completions(); await run(value); }
    if (event.key === 'Escape') { command.blur(); command.value = ''; completions(); }
  });
}
function notice(message) { const node = document.querySelector('#message'); if (node) { node.textContent = message; setTimeout(() => { if (node.textContent === message) node.textContent = ''; }, 3500); } }
function completions() {
  const input = document.querySelector('#command'); const box = document.querySelector('#completions'); if (!input || !box) return;
  const query = input.value.trim().toLowerCase();
  const available = state.view === 'edit' ? ['save','cancel','search','open','new','graph'] : state.title ? ['edit','history','related','graph','rename','delete','search','new','open','trash'] : ['search','graph','new','open','trash'];
  const matches = available.filter(cmd => !query || cmd.startsWith(query)).slice(0,6);
  box.hidden = document.activeElement !== input || matches.length === 0;
  box.innerHTML = matches.map(cmd => `<button type="button" data-complete="${cmd}">${cmd}</button>`).join('');
  box.querySelectorAll('button').forEach(button => button.onclick = () => { input.value = button.dataset.complete; input.focus(); completions(); });
}
function toc() {
  const article = document.querySelector('.prose'); if (!article) return;
  const headings = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const used = new Set();
  const items = headings.map((heading, index) => {
    let id = heading.textContent.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'') || `section-${index + 1}`;
    const base = id; let count = 2; while (used.has(id)) id = `${base}-${count++}`; used.add(id); heading.id = id;
    return `<a class="toc-${heading.tagName.toLowerCase()}" href="#${esc(id)}">${esc(heading.textContent)}</a>`;
  }).join('');
  document.querySelector('#toc').innerHTML = items ? `<div class="toc-label">contents</div>${items}` : '';
}
async function navigate(url, replace = false) {
  if (!mayLeave()) return;
  state.dirty = false; state.related = false;
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  await route();
}
async function route() {
  const path = decodeURIComponent(location.pathname);
  if (path.startsWith('/p/')) { state.title = path.slice(3); await reading(); }
  else if (path === '/search') { state.title = null; state.view = 'search'; await searchView(new URLSearchParams(location.search).get('q') || ''); }
  else if (path === '/graph') { state.title = null; state.view = 'graph'; await graphView(); }
  else if (path === '/trash') { state.title = null; state.view = 'trash'; await trashView(); }
  else { state.title = 'Home'; await reading(); }
}
async function reading() {
  const response = await fetch(pageApi(state.title));
  if (response.status === 404) { state.page = null; editView(true); return; }
  state.page = await response.json(); state.title = state.page.title; state.view = 'read';
  shell(`<div class="reading-layout"><article class="prose">${markdown(state.page.content)}</article><nav id="toc" class="toc" aria-label="Table of contents"></nav><div id="word-count" class="word-count"></div><section class="local-graph" aria-label="Local note graph"><div class="graph-heading"><span>local graph</span><a href="/graph" data-route="/graph">global graph</a></div><div id="local-graph" class="graph-visual"></div></section><section id="related" class="related" hidden></section></div>`);
  document.querySelectorAll('.prose img').forEach(img => { const src = img.getAttribute('src'); if (src?.startsWith('assets/')) img.src = `/${src}`; });
  toc(); if (state.related) showRelated();
  const stats = await api('/api/stats');
  const counter = document.querySelector('#word-count');
  if (counter) counter.textContent = `${stats.words.toLocaleString()} ${stats.words === 1 ? 'word' : 'words'} written`;
  mountGraph(document.querySelector('#local-graph'), `/api/graph?title=${encodeURIComponent(state.title)}`).catch(error => notice(error.message));
  document.title = `${state.title} · wiki`;
}
async function mountGraph(container, url, global = false) {
  const graph = await api(url);
  if (!container.isConnected) return;
  container.innerHTML = DOMPurify.sanitize(graph.svg, { USE_PROFILES: { svg: true, svgFilters: true } });
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('Graph could not be rendered');
  svg.querySelectorAll('title').forEach(title => title.remove());
  const focusNode = id => {
    const connected = new Set([id]);
    const activeEdges = new Set();
    for (const edge of graph.edges) {
      if (edge.source === id || edge.target === id) {
        connected.add(edge.source); connected.add(edge.target); activeEdges.add(edge.id);
      }
    }
    svg.classList.add('graph-focused');
    for (const node of graph.nodes) svg.querySelector(`#${node.id}`)?.classList.toggle('graph-dimmed', !connected.has(node.id));
    for (const edge of graph.edges) svg.querySelector(`#${edge.id}`)?.classList.toggle('graph-dimmed', !activeEdges.has(edge.id));
  };
  const clearFocus = () => {
    svg.classList.remove('graph-focused');
    svg.querySelectorAll('.graph-dimmed').forEach(element => element.classList.remove('graph-dimmed'));
  };
  for (const node of graph.nodes) {
    const element = svg.querySelector(`#${node.id}`);
    if (!element) continue;
    element.dataset.graphTitle = node.title;
    element.setAttribute('role', 'link');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', node.title);
    element.addEventListener('mouseenter', () => focusNode(node.id));
    element.addEventListener('mouseleave', clearFocus);
    element.addEventListener('focus', () => focusNode(node.id));
    element.addEventListener('blur', clearFocus);
  }
  if (global) {
    const panzoom = Panzoom(svg, { maxScale: 8, minScale: 0.5, contain: 'outside', cursor: 'grab' });
    state.graphPanzoom = panzoom;
    container.addEventListener('wheel', event => { event.preventDefault(); panzoom.zoomWithWheel(event); }, { passive: false });
  }
}
async function graphView() {
  shell('<section class="graph-page"><div class="graph-page-heading"><h1>graph</h1></div><div id="global-graph" class="graph-visual"></div></section>');
  document.title = 'Graph · wiki';
  await mountGraph(document.querySelector('#global-graph'), '/api/graph', true);
}
function showRelated() {
  if (!state.page) return;
  const el = document.querySelector('#related'); if (!el) return;
  const rows = (label, values) => `<div><h2>${label}</h2>${values.length ? values.map(value => `<div class="plain-row">${link(typeof value === 'string' ? value : value.title)}</div>`).join('') : '<div class="muted">none</div>'}</div>`;
  el.innerHTML = rows('backlinks', state.page.backlinks) + rows('outlinks', state.page.outlinks);
  el.hidden = false;
}
function editView(missing = false) {
  state.view = 'edit'; state.dirty = false;
  const saved = sessionStorage.getItem(draftKey(state.title));
  const content = saved ?? state.page?.content ?? '';
  shell(`<section class="editing"><h1>${esc(state.title)}</h1><textarea id="editor" aria-label="Markdown editor" spellcheck="true"></textarea></section>`);
  const editor = document.querySelector('#editor'); editor.value = content; editor.focus();
  if (saved !== null) state.dirty = true;
  editor.addEventListener('input', () => { state.dirty = true; rememberDraft(); });
  editor.addEventListener('paste', async event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); await insertImages(files); } });
  editor.addEventListener('dragover', event => { if ([...event.dataTransfer.items].some(item => item.kind === 'file')) event.preventDefault(); });
  editor.addEventListener('drop', async event => { const files = [...event.dataTransfer.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); await insertImages(files); } });
  if (missing) notice('New page draft');
}
async function insertImages(files) {
  const editor = document.querySelector('#editor'); if (!editor) return;
  for (const file of files) {
    try {
      const form = new FormData(); form.append('image', file);
      const asset = await api('/api/assets', { method: 'POST', body: form });
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]\n]/g, ' ').trim() || 'image';
      const ref = `![${alt}](${asset.path})`;
      editor.setRangeText(ref, editor.selectionStart, editor.selectionEnd, 'end');
      editor.dispatchEvent(new Event('input'));
    } catch (error) { notice(error.message); }
  }
  editor.focus();
}
async function save() {
  const content = currentDraft(); if (content === undefined) return;
  state.page = await api(pageApi(state.title), { method: 'PUT', body: JSON.stringify({ content }) });
  sessionStorage.removeItem(draftKey(state.title)); state.dirty = false; await reading(); notice('Saved');
}
async function searchView(query) {
  state.view = 'search'; state.query = query;
  shell('<section class="listing"><h1>search</h1><div id="results"></div></section>');
  const command = document.querySelector('#command'); command.value = `search ${query}`.trim(); command.focus(); command.setSelectionRange(command.value.length, command.value.length);
  await showResults(query);
}
async function showResults(query) {
  state.query = query; state.results = await api(`/api/search?q=${encodeURIComponent(query)}`); state.selected = 0;
  const el = document.querySelector('#results'); if (!el) return;
  el.innerHTML = state.results.map((result, i) => `<a class="result ${i === 0 ? 'selected' : ''}" href="${esc(pageUrl(result.title))}" data-page="${esc(result.title)}"><strong>${esc(result.title)}</strong><span>${esc(result.excerpt)}</span></a>`).join('');
}
function paintSelection() { document.querySelectorAll('.result').forEach((row,i) => row.classList.toggle('selected', i === state.selected)); document.querySelector('.result.selected')?.scrollIntoView({ block: 'nearest' }); }
async function historyView() {
  state.view = 'history'; const versions = await api(`${pageApi(state.title)}/history`);
  shell(`<section class="listing"><h1>${esc(state.title)}</h1><div class="eyebrow">history</div><div id="versions">${versions.map(version => `<button class="version" data-revision="${esc(version.id)}">${esc(new Date(version.timestamp).toLocaleString())}</button>`).join('')}</div><div id="revision"></div></section>`);
}
async function showRevision(id) {
  const revision = await api(`${pageApi(state.title)}/history/${encodeURIComponent(id)}`);
  document.querySelector('#revision').innerHTML = `<div class="revision-head"><span>changes</span><button id="restore" data-revision="${esc(id)}">restore</button></div><pre class="diff">${revision.changes.map(part => `<span class="${part.added ? 'added' : part.removed ? 'removed' : ''}">${esc(part.value)}</span>`).join('')}</pre>`;
}
async function trashView() {
  state.view = 'trash'; const rows = await api('/api/trash');
  shell(`<section class="listing"><h1>deleted pages</h1>${rows.map(row => `<div class="trash-row"><span>${esc(row.title)}</span><button data-recover="${esc(row.id)}">restore</button></div>`).join('')}</section>`);
}
async function run(raw) {
  if (!raw) return;
  const [name] = raw.split(/\s+/); const arg = raw.slice(name.length).trim();
  try {
    if (name === 'save') return save();
    if (name === 'cancel') { if (state.view === 'edit') { rememberDraft(); state.dirty = false; await reading(); } return; }
    if (name === 'search') { if (state.view === 'search' && state.results.length && arg === state.query) return navigate(pageUrl(state.results[state.selected].title)); return navigate(`/search?q=${encodeURIComponent(arg)}`); }
    if (name === 'graph') return navigate('/graph');
    if (name === 'new' && arg) { if (!mayLeave()) return; const existing = await fetch(pageApi(arg)); if (existing.ok) { notice('Page already exists'); return; } state.dirty = false; await api(pageApi(arg), { method: 'PUT', body: JSON.stringify({ content: '' }) }); return navigate(pageUrl(arg)); }
    if (name === 'open' && arg) { const matches = await api(`/api/search?q=${encodeURIComponent(arg)}`); if (!matches.length) { notice('No matching page'); return; } if (matches.length > 1 && matches[0].title.toLowerCase() !== arg.toLowerCase()) return navigate(`/search?q=${encodeURIComponent(arg)}`); return navigate(pageUrl(matches[0].title)); }
    if (name === 'trash') return navigate('/trash');
    if (!state.title) { notice('Open a page first'); return; }
    if (name === 'edit') { if (state.view !== 'edit') editView(!state.page); return; }
    if (name === 'history') { if (!mayLeave()) return; state.dirty = false; return historyView(); }
    if (name === 'related') { if (state.view !== 'read') await reading(); state.related = true; showRelated(); document.querySelector('#related')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (name === 'rename' && arg) { if (!mayLeave()) return; const page = await api(`${pageApi(state.title)}/rename`, { method: 'POST', body: JSON.stringify({ title: arg }) }); state.dirty = false; return navigate(pageUrl(page.title)); }
    if (name === 'delete') { if (!window.confirm(`Delete ${state.title}? You can restore it from deleted pages.`)) return; await api(pageApi(state.title), { method: 'DELETE' }); state.dirty = false; return navigate('/trash'); }
    notice('Unknown command');
  } catch (error) { notice(error.message); }
}
document.addEventListener('click', async event => {
  const graphNode = event.target.closest('[data-graph-title]'); if (graphNode) { event.preventDefault(); await navigate(pageUrl(graphNode.dataset.graphTitle)); return; }
  const page = event.target.closest('[data-page]'); if (page) { event.preventDefault(); await navigate(pageUrl(page.dataset.page)); return; }
  const routeLink = event.target.closest('[data-route]'); if (routeLink) { event.preventDefault(); await navigate(routeLink.dataset.route); return; }
  const brand = event.target.closest('.brand'); if (brand) { event.preventDefault(); await navigate('/'); return; }
  const revision = event.target.closest('[data-revision]'); if (revision) { if (revision.id === 'restore') { if (window.confirm('Restore this revision?')) { await api(`${pageApi(state.title)}/history/${revision.dataset.revision}/restore`, { method: 'POST' }); await reading(); notice('Revision restored'); } } else await showRevision(revision.dataset.revision); return; }
  const recover = event.target.closest('[data-recover]'); if (recover) { const page = await api(`/api/trash/${recover.dataset.recover}/restore`, { method: 'POST' }); await navigate(pageUrl(page.title)); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.closest('[data-graph-title]')) { event.preventDefault(); navigate(pageUrl(event.target.closest('[data-graph-title]').dataset.graphTitle)); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (state.view === 'edit') save().catch(error => notice(error.message)); }
  if (event.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); document.querySelector('#command')?.focus(); }
});
window.addEventListener('popstate', async () => { if (!mayLeave()) { history.pushState(null,'',pageUrl(state.title || '')); return; } state.dirty = false; await route(); });
window.addEventListener('beforeunload', event => { if (state.dirty) { rememberDraft(); event.preventDefault(); } });
route().catch(error => { app.textContent = error.message; });
