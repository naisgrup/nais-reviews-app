const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { openDb } = require('./db');

function createApp({ db, adminPassword, allowedOrigins = '*' }) {
  if (!adminPassword) throw new Error('Falta ADMIN_PASSWORD');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '20kb' }));

  const origins = allowedOrigins === '*' ? null : allowedOrigins.split(',').map((s) => s.trim()).filter(Boolean);
  const originOk = (o) => !origins || (o && origins.some((a) => o === a || o === `https://${a}`));

  // CORS solo para la API pública (la usa el widget en tu tienda)
  app.use('/api', (req, res, next) => {
    const o = req.headers.origin;
    if (o && originOk(o)) res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Límite simple de envíos por IP (anti-spam)
  const hits = new Map();
  const rateLimit = (max, windowMs) => (req, res, next) => {
    const now = Date.now();
    const k = req.ip;
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Demasiados intentos, prueba más tarde.' });
    arr.push(now);
    hits.set(k, arr);
    next();
  };

  const clean = (v, max) => String(v ?? '').trim().slice(0, max);

  // ---------- API pública ----------
  app.get('/api/products/:productId/reviews', (req, res) => {
    const pid = String(req.params.productId);
    const reviews = db
      .prepare(`SELECT id, author, rating, title, body, reply, replied_at, created_at
                FROM reviews WHERE product_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 100`)
      .all(pid);
    const s = db
      .prepare(`SELECT COUNT(*) AS count, ROUND(AVG(rating), 2) AS average
                FROM reviews WHERE product_id = ? AND status = 'approved'`)
      .get(pid);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ count: s.count, average: s.average || 0, reviews });
  });

  app.post('/api/reviews', rateLimit(5, 10 * 60 * 1000), (req, res) => {
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ok: true }); // honeypot: bots lo rellenan
    const rating = Number(b.rating);
    const review = {
      product_id: clean(b.product_id, 64),
      product_title: clean(b.product_title, 200),
      author: clean(b.author, 80),
      email: clean(b.email, 120),
      rating,
      title: clean(b.title, 120),
      body: clean(b.body, 2000),
    };
    if (!review.product_id || !review.author || !review.body || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Faltan datos: producto, nombre, calificación (1-5) y comentario.' });
    }
    db.prepare(`INSERT INTO reviews (product_id, product_title, author, email, rating, title, body)
                VALUES (@product_id, @product_title, @author, @email, @rating, @title, @body)`).run(review);
    res.status(201).json({ ok: true, message: 'Gracias, tu reseña será publicada tras ser revisada.' });
  });

  // ---------- Admin ----------
  const safeEq = (a, b) => {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  };
  const auth = (req, res, next) =>
    safeEq(req.get('x-admin-password') || '', adminPassword) ? next() : res.status(401).json({ error: 'No autorizado' });

  app.use('/admin/api', auth);

  app.get('/admin/api/reviews', (req, res) => {
    const { status, q } = req.query;
    const where = [];
    const params = [];
    if (['pending', 'approved', 'rejected'].includes(status)) { where.push('status = ?'); params.push(status); }
    if (q) {
      where.push('(body LIKE ? OR author LIKE ? OR title LIKE ? OR product_title LIKE ?)');
      params.push(...Array(4).fill(`%${q}%`));
    }
    const rows = db
      .prepare(`SELECT * FROM reviews ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`)
      .all(...params);
    res.json(rows);
  });

  app.get('/admin/api/stats', (req, res) => {
    const by = Object.fromEntries(
      db.prepare('SELECT status, COUNT(*) c FROM reviews GROUP BY status').all().map((r) => [r.status, r.c])
    );
    const avg = db.prepare(`SELECT ROUND(AVG(rating),2) a FROM reviews WHERE status='approved'`).get().a || 0;
    res.json({ pending: by.pending || 0, approved: by.approved || 0, rejected: by.rejected || 0, average: avg });
  });

  app.patch('/admin/api/reviews/:id', (req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
    if (!cur) return res.status(404).json({ error: 'No existe' });
    const { status, reply } = req.body || {};
    if (status !== undefined) {
      if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });
      db.prepare('UPDATE reviews SET status = ? WHERE id = ?').run(status, id);
    }
    if (reply !== undefined) {
      const text = clean(reply, 1000);
      db.prepare('UPDATE reviews SET reply = ?, replied_at = ? WHERE id = ?')
        .run(text || null, text ? new Date().toISOString() : null, id);
    }
    res.json(db.prepare('SELECT * FROM reviews WHERE id = ?').get(id));
  });

  app.delete('/admin/api/reviews/:id', (req, res) => {
    const r = db.prepare('DELETE FROM reviews WHERE id = ?').run(Number(req.params.id));
    res.status(r.changes ? 200 : 404).json({ ok: !!r.changes });
  });

  app.get('/admin/api/export.csv', (req, res) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = db.prepare('SELECT * FROM reviews ORDER BY id DESC').all();
    const cols = ['id', 'product_id', 'product_title', 'author', 'email', 'rating', 'title', 'body', 'status', 'reply', 'created_at'];
    res.type('text/csv').send([cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
  });

  // ---------- Archivos estáticos ----------
  app.get('/widget.js', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.sendFile(path.join(__dirname, '..', 'public', 'widget.js'));
  });
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
  app.get('/', (req, res) => res.redirect('/admin'));
  app.get('/health', (req, res) => res.send('ok'));

  return app;
}

if (require.main === module) {
  const db = openDb(process.env.DB_PATH || './data/reviews.db');
  const app = createApp({
    db,
    adminPassword: process.env.ADMIN_PASSWORD,
    allowedOrigins: process.env.ALLOWED_ORIGINS || '*',
  });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Reviews app en http://localhost:${port}`));
}

module.exports = { createApp };
