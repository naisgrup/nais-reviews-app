const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const { parseCsv, toCsv } = require('../src/csv');

async function start() {
  const app = createApp({ db: openDb(':memory:'), adminPassword: 'secreto' });
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const A = { 'x-admin-password': 'secreto', 'Content-Type': 'application/json' };
  const admin = (p, o = {}) => fetch(`${base}/admin/api${p}`, { ...o, headers: { ...A, ...(o.headers || {}) } });
  await admin('/shops', { method: 'POST', body: JSON.stringify({ domain: 'a.myshopify.com' }) });
  await admin('/shops', { method: 'POST', body: JSON.stringify({ domain: 'https://B.myshopify.com/' }) });
  return { base, admin, close: () => srv.close() };
}
const J = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('flujo completo: enviar, moderar, publicar, responder', async () => {
  const { base, admin, close } = await start();
  try {
    let r = await fetch(`${base}/api/a.myshopify.com/reviews`, J({ product_id: 'almohada', author: 'Ana', rating: 5, body: 'Genial' }));
    assert.strictEqual(r.status, 201);
    let pub = await (await fetch(`${base}/api/a.myshopify.com/products/almohada/reviews`)).json();
    assert.strictEqual(pub.count, 0);
    const list = await (await admin('/reviews?shop=a.myshopify.com&status=pending')).json();
    assert.strictEqual(list.length, 1);
    await admin(`/reviews/${list[0].id}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved', reply: '¡Gracias Ana!' }) });
    pub = await (await fetch(`${base}/api/a.myshopify.com/products/almohada/reviews`)).json();
    assert.strictEqual(pub.count, 1);
    assert.strictEqual(pub.reviews[0].reply, '¡Gracias Ana!');
    assert.ok(!('email' in pub.reviews[0]));
  } finally { close(); }
});

test('las tiendas están aisladas y una no registrada se rechaza', async () => {
  const { base, admin, close } = await start();
  try {
    await fetch(`${base}/api/a.myshopify.com/reviews`, J({ product_id: 'p', author: 'Ana', rating: 5, body: 'x' }));
    assert.strictEqual((await (await admin('/reviews?shop=a.myshopify.com')).json()).length, 1);
    assert.strictEqual((await (await admin('/reviews?shop=b.myshopify.com')).json()).length, 0);
    assert.strictEqual((await fetch(`${base}/api/c.myshopify.com/reviews`, J({ product_id: 'p', author: 'x', rating: 5, body: 'x' }))).status, 404);
    assert.strictEqual((await fetch(`${base}/api/c.myshopify.com/products/p/reviews`)).status, 404);
  } finally { close(); }
});

test('validación, honeypot y autenticación', async () => {
  const { base, admin, close } = await start();
  try {
    assert.strictEqual((await fetch(`${base}/api/a.myshopify.com/reviews`, J({ product_id: 'p', author: 'x', rating: 9, body: 'x' }))).status, 400);
    await fetch(`${base}/api/a.myshopify.com/reviews`, J({ product_id: 'p', author: 'bot', rating: 5, body: 'spam', website: 'x' }));
    assert.strictEqual((await (await admin('/reviews?shop=a.myshopify.com')).json()).length, 0);
    assert.strictEqual((await fetch(`${base}/admin/api/shops`)).status, 401);
    assert.strictEqual((await fetch(`${base}/admin/api/shops`, { headers: { 'x-admin-password': 'mal' } })).status, 401);
  } finally { close(); }
});

test('importar CSV (comillas, saltos de línea, formato Judge.me), exportar y re-importar', async () => {
  const { base, admin, close } = await start();
  try {
    const csv = '﻿title,body,rating,review_date,reviewer_name,product_handle,curated\r\n' +
      '"Genial, de verdad","Línea 1\nLínea ""2""",5,17/06/2024,Ana,almohada,no\r\n' +
      'Regular,Cumple,3,2024-03-22,Luis,almohada,no\r\n' +
      'Mala fila,,9,,,almohada,no\r\n';
    const imp = await admin('/import?shop=a.myshopify.com&status=approved', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv });
    const res = await imp.json();
    assert.deepStrictEqual([res.imported, res.skipped], [2, 1]);
    const pub = await (await fetch(`${base}/api/a.myshopify.com/products/almohada/reviews`)).json();
    assert.strictEqual(pub.count, 2);
    assert.strictEqual(pub.average, 4);
    const ana = pub.reviews.find((r) => r.author === 'Ana');
    assert.strictEqual(ana.body, 'Línea 1\nLínea "2"');
    assert.strictEqual(ana.created_at.slice(0, 10), '2024-06-17');
    assert.strictEqual(ana.source, 'import');
    assert.strictEqual(ana.verified, 0);

    const exp = await (await admin('/export.csv?shop=a.myshopify.com')).text();
    assert.strictEqual(parseCsv(exp).length, 2);
    const again = await (await admin('/import?shop=b.myshopify.com&status=pending', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: exp })).json();
    assert.strictEqual(again.imported, 2);
    assert.strictEqual((await (await admin('/stats?shop=b.myshopify.com')).json()).pending, 2);
    assert.strictEqual((await (await admin('/bulk', { method: 'POST', body: JSON.stringify({ shop: 'b.myshopify.com', from: 'pending', to: 'approved' }) })).json()).updated, 2);
  } finally { close(); }
});

test('csv: ida y vuelta', () => {
  const rows = [{ a: 'x,y', b: 'li"nea\nnueva' }];
  assert.deepStrictEqual(parseCsv(toCsv(['a', 'b'], rows)), rows);
});
