import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WikiStore } from './store.js';
import { renderGraph } from './graph.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export async function createServer(root = process.env.WIKI_DIR || path.resolve(here, '../wiki-data')) {
  const store = new WikiStore(root);
  await store.init();
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  const wrap = handler => async (req, res) => { try { await handler(req, res); } catch (error) { res.status(error.message === 'Page not found' ? 404 : 400).json({ error: error.message }); } };
  app.get('/api/config', (req, res) => res.json({ folder: store.root }));
  app.get('/api/pages', (req, res) => res.json(store.list()));
  app.get('/api/stats', (req, res) => res.json({ words: store.wordCount() }));
  app.get('/api/graph', wrap(async (req, res) => {
    const local = typeof req.query.title === 'string';
    res.json(await renderGraph(store.linkGraph(local ? req.query.title : null), local));
  }));
  app.get('/api/search', (req, res) => res.json(store.search(req.query.q)));
  app.get('/api/trash', (req, res) => res.json(store.trash()));
  app.post('/api/trash/:id/restore', wrap(async (req, res) => res.json(await store.recover(req.params.id))));
  app.get('/api/pages/:title', (req, res) => { const page = store.get(req.params.title); page ? res.json(page) : res.status(404).json({ error: 'Page not found' }); });
  app.put('/api/pages/:title', wrap(async (req, res) => res.json(await store.save(req.params.title, req.body.content))));
  app.post('/api/pages/:title/rename', wrap(async (req, res) => res.json(await store.rename(req.params.title, req.body.title))));
  app.delete('/api/pages/:title', wrap(async (req, res) => { await store.remove(req.params.title); res.status(204).end(); }));
  app.get('/api/pages/:title/history', wrap(async (req, res) => res.json(await store.history(req.params.title))));
  app.get('/api/pages/:title/history/:revision', wrap(async (req, res) => res.json(await store.revision(req.params.title, req.params.revision))));
  app.post('/api/pages/:title/history/:revision/restore', wrap(async (req, res) => res.json(await store.restore(req.params.title, req.params.revision))));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  app.post('/api/assets', upload.single('image'), wrap(async (req, res) => {
    if (!req.file) throw new Error('Choose an image');
    res.json(await store.asset(req.file.buffer, req.file.originalname, req.file.mimetype));
  }));
  app.use('/assets', express.static(path.join(store.root, 'assets'), { dotfiles: 'deny', fallthrough: false }));
  app.get('/favicon.svg', (req, res) => res.sendFile(path.resolve(here, '../favicon.svg')));
  app.use(express.static(path.resolve(here, '../public')));
  app.get('/{*path}', (req, res) => res.sendFile(path.resolve(here, '../public/index.html')));
  return { app, store };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, store } = await createServer();
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, '127.0.0.1', () => console.log(`Wiki: http://127.0.0.1:${port}  Folder: ${store.root}`));
  server.on('error', error => { console.error(error); process.exitCode = 1; });
}
