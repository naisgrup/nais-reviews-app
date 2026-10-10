const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');

async function start() {
  const app = createApp({ db: openDb(':memory:'), adminPassword: 'secreto' });
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, close: () => srv.close() };
}
const J = (body, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const A = { 'x-admin-password': 'secreto', 'Content-Type': 'application/json' };

test('flujo completo: enviar, moderar, publicar, responder', async () => {
  const { base, close } = await start();
  try {
    let r = await fetch(`${base}/api/reviews`, J({ product_id: '1', author: 'Ana', rating: 5, body: 'Genial' }));
    assert.strictEqual(r.status, 201);

    // pendiente: no es público
    let pub = await (await fetch(`${base}/api/products/1/reviews`)).json();
    assert.strictEqual(pub.count, 0);

    const list = await (await fetch(`${base}/admin/api/reviews?status=pending`, { headers: A })).json();
    assert.strictEqual(list.length, 1);

    await fetch(`${base}/admin/api/reviews/${list[0].id}`, { method: 'PATCH', headers: A, body: JSON.stringify({ status: 'approved', reply: '¡Gracias Ana!' }) });
    pub = await (await fetch(`${base}/api/products/1/reviews`)).json();
    assert.strictEqual(pub.count, 1);
    assert.strictEqual(pub.average, 5);
    assert.strictEqual(pub.reviews[0].reply, '¡Gracias Ana!');
    assert.ok(!('email' in pub.reviews[0]));
  } finally { close(); }
});

test('validación, honeypot y autenticación', async () => {
  const { base, close } = await start();
  try {
    assert.strictEqual((await fetch(`${base}/api/reviews`, J({ product_id: '1', author: 'x', rating: 9, body: 'x' }))).status, 400);
    await fetch(`${base}/api/reviews`, J({ product_id: '1', author: 'bot', rating: 5, body: 'spam', website: 'x' }));
    const l = await (await fetch(`${base}/admin/api/reviews`, { headers: A })).json();
    assert.strictEqual(l.length, 0);
    assert.strictEqual((await fetch(`${base}/admin/api/reviews`)).status, 401);
    assert.strictEqual((await fetch(`${base}/admin/api/reviews`, { headers: { 'x-admin-password': 'mal' } })).status, 401);
  } finally { close(); }
});
