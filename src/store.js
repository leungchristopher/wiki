import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Fuse from 'fuse.js';
import { diffLines } from 'diff';

const links = text => [...text.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/g)].map(match => match[1].trim());
const key = title => title.normalize('NFC').toLocaleLowerCase();

export class WikiStore {
  constructor(root) { this.root = path.resolve(root); this.meta = path.join(this.root, '.wiki'); }
  async init() {
    await fs.mkdir(path.join(this.root, 'assets'), { recursive: true });
    await fs.mkdir(path.join(this.meta, 'history'), { recursive: true });
    await fs.mkdir(path.join(this.meta, 'trash'), { recursive: true });
    try { this.records = JSON.parse(await fs.readFile(path.join(this.meta, 'pages.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.records = {}; }
    await this.refresh();
    if (!this.resolve('Home')) await this.save('Home', '# Home\n');
  }
  validate(title) {
    if (typeof title !== 'string') throw new Error('A page title is required');
    title = title.trim().normalize('NFC');
    if (!title || title.length > 120 || /[\\/\x00-\x1f\x7f]/.test(title) || title === '.' || title === '..' || title.startsWith('.')) throw new Error('Invalid page title');
    return title;
  }
  file(title) { return path.join(this.root, `${this.validate(title)}.md`); }
  async persist() { await fs.writeFile(path.join(this.meta, 'pages.json'), JSON.stringify(this.records, null, 2)); }
  async refresh() {
    const names = (await fs.readdir(this.root, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.md'));
    const known = new Set(Object.values(this.records).filter(r => !r.deleted).map(r => key(r.title)));
    for (const entry of names) {
      const title = entry.name.slice(0, -3);
      if (!known.has(key(title))) { const id = crypto.randomUUID(); this.records[id] = { title, deleted: false }; known.add(key(title)); }
    }
    await this.persist();
    this.pages = await Promise.all(Object.entries(this.records).filter(([,r]) => !r.deleted).map(async ([id,r]) => {
      try { return { id, title: r.title, content: await fs.readFile(this.file(r.title), 'utf8') }; }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    }));
    this.pages = this.pages.filter(Boolean);
  }
  resolve(title) { return this.pages.find(page => key(page.title) === key(title)); }
  list() { return this.pages.map(({ title }) => title).sort((a,b) => a.localeCompare(b)); }
  wordCount() {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    return this.pages.reduce((total, page) => {
      const text = page.content
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        .replace(/<[^>]+>/g, ' ');
      return total + [...segmenter.segment(text)].filter(part => part.isWordLike).length;
    }, 0);
  }
  graph(page) {
    const outgoing = [...new Set(links(page.content))];
    const backlinks = this.pages.filter(other => other.id !== page.id && links(other.content).some(link => key(link) === key(page.title))).map(other => other.title);
    return { outlinks: outgoing.map(title => ({ title, exists: !!this.resolve(title) })), backlinks };
  }
  linkGraph(title = null) {
    const nodes = new Map();
    const edges = [];
    for (const page of this.pages) nodes.set(key(page.title), { title: page.title, exists: true });
    for (const page of this.pages) {
      const seen = new Set();
      for (const targetTitle of links(page.content)) {
        const targetKey = key(targetTitle);
        if (!targetKey || seen.has(targetKey)) continue;
        seen.add(targetKey);
        if (!nodes.has(targetKey)) nodes.set(targetKey, { title: targetTitle, exists: false });
        edges.push({ source: key(page.title), target: targetKey });
      }
    }
    let selected = new Set(nodes.keys());
    if (title !== null) {
      const page = this.resolve(title);
      if (!page) throw new Error('Page not found');
      const center = key(page.title);
      selected = new Set([center]);
      for (const edge of edges) {
        if (edge.source === center) selected.add(edge.target);
        if (edge.target === center) selected.add(edge.source);
      }
    }
    const items = [...selected].map(id => ({ id, ...nodes.get(id), current: title !== null && id === key(title) }));
    return { nodes: items, edges: edges.filter(edge => selected.has(edge.source) && selected.has(edge.target)) };
  }
  get(title) {
    const page = this.resolve(title);
    if (!page) return null;
    return { title: page.title, content: page.content, ...this.graph(page) };
  }
  async snapshot(id, content) {
    const dir = path.join(this.meta, 'history', id);
    await fs.mkdir(dir, { recursive: true });
    this.lastRevisionTime = Math.max(Date.now(), (this.lastRevisionTime || 0) + 1);
    const revision = `${new Date(this.lastRevisionTime).toISOString().replaceAll(':','-')}-${crypto.randomUUID()}`;
    await fs.writeFile(path.join(dir, `${revision}.md`), content);
    return revision;
  }
  async save(title, content) {
    title = this.validate(title);
    if (typeof content !== 'string' || content.length > 5_000_000) throw new Error('Invalid page content');
    let page = this.resolve(title);
    if (!page) {
      if (this.pages.some(p => key(p.title) === key(title))) throw new Error('Page already exists');
      const id = crypto.randomUUID(); this.records[id] = { title, deleted: false }; page = { id, title, content: '' };
    }
    await fs.writeFile(this.file(page.title), content);
    await this.snapshot(page.id, content);
    await this.refresh();
    return this.get(title);
  }
  async rename(oldTitle, newTitle) {
    const page = this.resolve(oldTitle);
    if (!page) throw new Error('Page not found');
    newTitle = this.validate(newTitle);
    if (this.resolve(newTitle) && key(page.title) !== key(newTitle)) throw new Error('Page already exists');
    const oldName = page.title;
    await fs.rename(this.file(oldName), this.file(newTitle));
    this.records[page.id].title = newTitle;
    await this.refresh();
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\[\\[${escaped}\\]\\]`, 'gi');
    for (const source of [...this.pages]) {
      const updated = source.content.replace(pattern, `[[${newTitle}]]`);
      if (updated !== source.content) await this.save(source.title, updated);
    }
    return this.get(newTitle);
  }
  async remove(title) {
    const page = this.resolve(title);
    if (!page) throw new Error('Page not found');
    const dir = path.join(this.meta, 'trash', page.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.rename(this.file(page.title), path.join(dir, 'page.md'));
    this.records[page.id] = { title: page.title, deleted: true, deletedAt: new Date().toISOString() };
    await this.refresh();
  }
  trash() { return Object.entries(this.records).filter(([,r]) => r.deleted).map(([id,r]) => ({ id, ...r })).sort((a,b) => b.deletedAt.localeCompare(a.deletedAt)); }
  async recover(id) {
    const record = this.records[id];
    if (!record?.deleted) throw new Error('Deleted page not found');
    if (this.resolve(record.title)) throw new Error('A page with that title already exists');
    await fs.rename(path.join(this.meta, 'trash', id, 'page.md'), this.file(record.title));
    this.records[id] = { title: record.title, deleted: false };
    await this.refresh();
    return this.get(record.title);
  }
  async history(title) {
    const page = this.resolve(title); if (!page) throw new Error('Page not found');
    const dir = path.join(this.meta, 'history', page.id);
    let names; try { names = (await fs.readdir(dir)).filter(name => name.endsWith('.md')).sort().reverse(); } catch { return []; }
    return names.map(name => ({ id: name.slice(0,-3), timestamp: name.slice(0,24).replace(/^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)/, '$1:$2:$3') }));
  }
  async revision(title, revision) {
    const page = this.resolve(title); if (!page) throw new Error('Page not found');
    if (!/^[\w.-]+$/.test(revision)) throw new Error('Invalid revision');
    const content = await fs.readFile(path.join(this.meta, 'history', page.id, `${revision}.md`), 'utf8');
    const versions = await this.history(title);
    const index = versions.findIndex(item => item.id === revision);
    if (index < 0) throw new Error('Revision not found');
    const prior = versions[index + 1];
    const before = prior ? await fs.readFile(path.join(this.meta, 'history', page.id, `${prior.id}.md`), 'utf8') : '';
    return { content, changes: diffLines(before, content).map(part => ({ value: part.value, added: !!part.added, removed: !!part.removed })) };
  }
  async restore(title, revision) { return this.save(title, (await this.revision(title, revision)).content); }
  search(query) {
    query = String(query || '').trim();
    if (!query) return this.pages.map(page => ({ title: page.title, excerpt: page.content.replace(/\s+/g,' ').slice(0,130) }));
    const fuse = new Fuse(this.pages, { includeScore: true, threshold: 0.48, ignoreLocation: true, keys: [{ name: 'title', weight: 0.78 }, { name: 'content', weight: 0.22 }] });
    const results = fuse.search(query).map(({ item, score }) => ({ item, score: Math.max(0, score - (key(item.title) === key(query) ? 0.5 : key(item.title).startsWith(key(query)) ? 0.25 : 0)) }));
    return results.sort((a,b) => a.score - b.score).map(({ item }) => {
      const plain = item.content.replace(/\s+/g,' ');
      const at = plain.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
      return { title: item.title, excerpt: plain.slice(Math.max(0, at - 45), Math.max(0, at - 45) + 150) };
    });
  }
  async asset(buffer, originalName, mime) {
    const types = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif' };
    const extension = types[mime]; if (!extension) throw new Error('Unsupported image type');
    const base = path.basename(originalName || 'image').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g,'').slice(0,50) || 'image';
    const filename = `${base}-${crypto.randomUUID().slice(0,8)}${extension}`;
    await fs.writeFile(path.join(this.root, 'assets', filename), buffer, { flag: 'wx' });
    return { filename, path: `assets/${filename}` };
  }
}
