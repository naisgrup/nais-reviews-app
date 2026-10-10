const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { openDb } = require('./db');
const { parseCsv, toCsv } = require('./csv');

const STATUSES = ['pending', 'approved', 'rejected'];
const EXPORT_COLS = ['shop', 'product', 'author', 'email', 'rating', 'title', 'body', 'review_date', 'verified', 'status', 'reply', 'source'];

// Nombres de columna aceptados al importar (inglés, español y formato Judge.me)
const ALIASES = {
  product: ['product', 'product_handle', 'product_id', 'handle', 'producto'],
  author: ['author', 'reviewer_name', 'autor', 'name', 'nombre'],
  email: ['email', 'reviewer_email', 'correo'],
  rating: ['rating', 'estrellas', 'stars'],
  title: ['title', 'titulo', 'título'],
  body: ['body', 'texto', 'review', 'comentario'],
  date: ['review_date', 'date', 'fecha'],
  verified: ['verified', 'verified_purchase', 'verificada'],
  reply: ['reply', 'respuesta'],
};
const pick = (row, key) => {
  for (const a of ALIASES[key]) if (row[a] !== undefined && String(row[a]).trim() !== '') return String(row[a]).trim();
  return '';
};

function parseDate(s) {
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]} 00:00:00`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')} 00:00:00`;
  return null;
}

const normShop = (s) => String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

function createApp({ db, adminPassword, allowedOrigins = '*' }) {
  if (!adminPassword) throw new Error('Falta ADMIN_PASSWORD');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '20kb' }));

  const origins = allowedOrigins === '*' ? null : allowedOrigins.split(',').map((s) => s.trim()).filter(Boolean);
  const originOk = (o) => !origins || (o && origins.some((a) => o === a || o === `https://${a}`));

  app.use('/api', (req, res, next) => {
    const o = req.headers.origin;
    if (o && originOk(o)) res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const hits = new Map();
  const rateLimit = (max, windowMs) => (req, res, next) => {
    const now = Date.now();
    const arr = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Demasiados intentos, prueba más tarde.' });
    arr.push(now);
    hits.set(req.ip, arr);
    next();
  };
  const clean = (v, max) => String(v ?? '').trim().slice(0, max);

  const getShop = (domain) => db.prepare('SELECT * FROM shops WHERE domain = ?').get(normShop(domain));
  const needShop = (req, res, next) => {
    const shop = getShop(req.params.shop);
    if (!shop) return res.status(404).json({ error: 'Tienda no registrada' });
    req.shop = shop;
    next();
  };

  // ---------- API pública (la usa el widget) ----------
  app.get('/api/:shop/products/:productId/reviews', needShop, (req, res) => {
    const pid = String(req.params.productId);
    const reviews = db
      .prepare(`SELECT id, author, rating, title, body, reply, replied_at, created_at, verified, source
                FROM reviews WHERE shop = ? AND product_id = ? AND status = 'approved' ORDER BY created_at DESC, id DESC LIMIT 100`)
      .all(req.shop.domain, pid);
    const s = db
      .prepare(`SELECT COUNT(*) AS count, ROUND(AVG(rating), 2) AS average
                FROM reviews WHERE shop = ? AND product_id = ? AND status = 'approved'`)
      .get(req.shop.domain, pid);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ count: s.count, average: s.average || 0, imported_label: req.shop.imported_label, reviews });
  });

  app.post('/api/:shop/reviews', needShop, rateLimit(5, 10 * 60 * 1000), (req, res) => {
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ok: true }); // honeypot anti-bots
    const rating = Number(b.rating);
    const review = {
      shop: req.shop.domain,
      product_id: clean(b.product_id, 128),
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
    db.prepare(`INSERT INTO reviews (shop, product_id, product_title, author, email, rating, title, body)
                VALUES (@shop, @product_id, @product_title, @author, @email, @rating, @title, @body)`).run(review);
    res.status(201).json({ ok: true, message: 'Gracias, tu reseña será publicada tras ser revisada.' });
  });

  // ---------- Admin ----------
  const safeEq = (a, b) => {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  };
  app.use('/admin/api', (req, res, next) =>
    safeEq(req.get('x-admin-password') || '', adminPassword) ? next() : res.status(401).json({ error: 'No autorizado' }));

  app.get('/admin/api/shops', (req, res) => {
    res.json(db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM reviews r WHERE r.shop = s.domain) AS reviews,
      (SELECT COUNT(*) FROM reviews r WHERE r.shop = s.domain AND r.status = 'pending') AS pending
      FROM shops s ORDER BY s.created_at`).all());
  });

  app.post('/admin/api/shops', (req, res) => {
    const domain = normShop(req.body?.domain);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return res.status(400).json({ error: 'Dominio no válido (ej. mitienda.myshopify.com)' });
    db.prepare('INSERT OR IGNORE INTO shops (domain, name) VALUES (?, ?)').run(domain, clean(req.body?.name, 80) || domain);
    res.status(201).json(getShop(domain));
  });

  app.patch('/admin/api/shops/:shop', needShop, (req, res) => {
    if (req.body?.imported_label !== undefined) {
      db.prepare('UPDATE shops SET imported_label = ? WHERE domain = ?').run(clean(req.body.imported_label, 60), req.shop.domain);
    }
    res.json(getShop(req.shop.domain));
  });

  const shopFromQuery = (req, res) => {
    const shop = getShop(req.query.shop);
    if (!shop) res.status(400).json({ error: 'Indica una tienda registrada (?shop=...)' });
    return shop;
  };

  app.get('/admin/api/reviews', (req, res) => {
    const shop = shopFromQuery(req, res); if (!shop) return;
    const where = ['shop = ?']; const params = [shop.domain];
    if (STATUSES.includes(req.query.status)) { where.push('status = ?'); params.push(req.query.status); }
    if (req.query.q) {
      where.push('(body LIKE ? OR author LIKE ? OR title LIKE ? OR product_id LIKE ?)');
      params.push(...Array(4).fill(`%${req.query.q}%`));
    }
    res.json(db.prepare(`SELECT * FROM reviews WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT 500`).all(...params));
  });

  app.get('/admin/api/stats', (req, res) => {
    const shop = shopFromQuery(req, res); if (!shop) return;
    const by = Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM reviews WHERE shop = ? GROUP BY status').all(shop.domain).map((r) => [r.status, r.c]));
    const avg = db.prepare(`SELECT ROUND(AVG(rating),2) a FROM reviews WHERE shop = ? AND status='approved'`).get(shop.domain).a || 0;
    res.json({ pending: by.pending || 0, approved: by.approved || 0, rejected: by.rejected || 0, average: avg });
  });

  app.patch('/admin/api/reviews/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM reviews WHERE id = ?').get(id)) return res.status(404).json({ error: 'No existe' });
    const { status, reply } = req.body || {};
    if (status !== undefined) {
      if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Estado inválido' });
      db.prepare('UPDATE reviews SET status = ? WHERE id = ?').run(status, id);
    }
    if (reply !== undefined) {
      const text = clean(reply, 1000);
      db.prepare('UPDATE reviews SET reply = ?, replied_at = ? WHERE id = ?').run(text || null, text ? new Date().toISOString() : null, id);
    }
    res.json(db.prepare('SELECT * FROM reviews WHERE id = ?').get(id));
  });

  app.delete('/admin/api/reviews/:id', (req, res) => {
    const r = db.prepare('DELETE FROM reviews WHERE id = ?').run(Number(req.params.id));
    res.status(r.changes ? 200 : 404).json({ ok: !!r.changes });
  });

  // Aprobar/rechazar todas las de un estado de una vez (útil tras importar)
  app.post('/admin/api/bulk', (req, res) => {
    const { shop: d, from, to } = req.body || {};
    const shop = getShop(d);
    if (!shop || !STATUSES.includes(from) || !STATUSES.includes(to)) return res.status(400).json({ error: 'Datos no válidos' });
    const r = db.prepare('UPDATE reviews SET status = ? WHERE shop = ? AND status = ?').run(to, shop.domain, from);
    res.json({ updated: r.changes });
  });

  // Importar CSV (cuerpo = texto del CSV). Marca las filas como source='import'.
  app.post('/admin/api/import', express.text({ type: '*/*', limit: '8mb' }), (req, res) => {
    const shop = shopFromQuery(req, res); if (!shop) return;
    const status = STATUSES.includes(req.query.status) ? req.query.status : 'pending';
    const rows = parseCsv(req.body || '');
    if (!rows.length) return res.status(400).json({ error: 'El archivo está vacío o no tiene filas.' });
    const ins = db.prepare(`INSERT INTO reviews (shop, product_id, author, email, rating, title, body, status, reply, replied_at, created_at, verified, source)
      VALUES (@shop, @product_id, @author, @email, @rating, @title, @body, @status, @reply, @replied_at, COALESCE(@created_at, datetime('now')), @verified, 'import')`);
    const errors = []; let imported = 0;
    db.transaction(() => {
      rows.forEach((r, i) => {
        const rating = Number(pick(r, 'rating'));
        const data = {
          shop: shop.domain, product_id: clean(pick(r, 'product'), 128), author: clean(pick(r, 'author'), 80),
          email: clean(pick(r, 'email'), 120), rating, title: clean(pick(r, 'title'), 120), body: clean(pick(r, 'body'), 2000),
          status, reply: clean(pick(r, 'reply'), 1000) || null, replied_at: null,
          created_at: parseDate(pick(r, 'date')), verified: /^(true|1|yes|si|sí)$/i.test(pick(r, 'verified')) ? 1 : 0,
        };
        if (!data.product_id || !data.author || !data.body || !Number.isInteger(rating) || rating < 1 || rating > 5) {
          errors.push(`Fila ${i + 2}: falta producto, autor, texto o estrellas (1-5)`);
          return;
        }
        ins.run(data); imported++;
      });
    })();
    res.json({ imported, skipped: errors.length, errors: errors.slice(0, 20) });
  });

  app.get('/admin/api/export.csv', (req, res) => {
    const shop = shopFromQuery(req, res); if (!shop) return;
    const rows = db.prepare('SELECT * FROM reviews WHERE shop = ? ORDER BY created_at, id').all(shop.domain)
      .map((r) => ({ ...r, product: r.product_id, review_date: r.created_at.slice(0, 10), verified: r.verified ? 'true' : 'false' }));
    res.set('Content-Disposition', `attachment; filename="resenas-${shop.domain}.csv"`).type('text/csv').send(toCsv(EXPORT_COLS, rows));
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
  const app = createApp({ db, adminPassword: process.env.ADMIN_PASSWORD, allowedOrigins: process.env.ALLOWED_ORIGINS || '*' });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Reviews app en http://localhost:${port}`));
}

module.exports = { createApp };
