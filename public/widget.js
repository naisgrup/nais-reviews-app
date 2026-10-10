/* Widget de reseñas. Uso en el tema de Shopify:
   <div id="nais-reviews" data-shop="{{ shop.permanent_domain }}" data-product-id="{{ product.handle }}" data-product-title="{{ product.title | escape }}"></div>
   <script src="https://TU-APP.onrender.com/widget.js" defer></script> */
(function () {
  var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  var API = new URL(script.src).origin;
  var root = document.getElementById('nais-reviews');
  if (!root) return;
  var shop = root.dataset.shop, pid = root.dataset.productId, ptitle = root.dataset.productTitle || '';
  if (!shop || !pid) return;
  var base = API + '/api/' + encodeURIComponent(shop);

  var css = '#nais-reviews{font-family:inherit;max-width:720px;margin:2rem auto}' +
    '#nais-reviews .nr-star{color:#f5a623;letter-spacing:2px}#nais-reviews .nr-muted{color:#777;font-size:.85em}' +
    '#nais-reviews .nr-card{border-top:1px solid #e5e5e5;padding:14px 0}' +
    '#nais-reviews .nr-tag{display:inline-block;margin-left:6px;padding:1px 8px;border:1px solid #ccc;border-radius:99px;font-size:.75em;color:#555}' +
    '#nais-reviews .nr-reply{background:#f6f6f6;border-left:3px solid #999;margin:8px 0 0;padding:8px 12px;font-size:.92em}' +
    '#nais-reviews input,#nais-reviews textarea,#nais-reviews select{width:100%;padding:10px;margin:6px 0;border:1px solid #ccc;border-radius:6px;font:inherit;box-sizing:border-box}' +
    '#nais-reviews button{padding:10px 18px;border:0;border-radius:6px;background:#111;color:#fff;font:inherit;cursor:pointer}' +
    '#nais-reviews .nr-hp{position:absolute;left:-9999px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function stars(n) { n = Math.round(n); return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }

  function render(data) {
    var h = '<h2>Reseñas de clientes</h2>';
    h += data.count
      ? '<p><span class="nr-star">' + stars(data.average) + '</span> <strong>' + data.average + '</strong> <span class="nr-muted">(' + data.count + ' reseñas)</span></p>'
      : '<p class="nr-muted">Aún no hay reseñas. ¡Sé el primero!</p>';
    data.reviews.forEach(function (r) {
      var tag = r.verified ? '<span class="nr-tag">Compra verificada</span>' : (r.source === 'import' && data.imported_label ? '<span class="nr-tag">' + esc(data.imported_label) + '</span>' : '');
      h += '<div class="nr-card"><span class="nr-star">' + stars(r.rating) + '</span> <strong>' + esc(r.title) + '</strong>' + tag +
        '<p>' + esc(r.body) + '</p><div class="nr-muted">' + esc(r.author) + ' · ' + esc(r.created_at.slice(0, 10)) + '</div>' +
        (r.reply ? '<div class="nr-reply"><strong>Respuesta de la tienda:</strong><br>' + esc(r.reply) + '</div>' : '') + '</div>';
    });
    h += '<form id="nr-form" class="nr-card"><h3>Escribe una reseña</h3>' +
      '<select name="rating" required><option value="">Calificación…</option><option value="5">★★★★★ Excelente</option><option value="4">★★★★ Muy bueno</option><option value="3">★★★ Bueno</option><option value="2">★★ Regular</option><option value="1">★ Malo</option></select>' +
      '<input name="author" placeholder="Tu nombre" maxlength="80" required>' +
      '<input name="email" type="email" placeholder="Email (no se publica)" maxlength="120">' +
      '<input name="title" placeholder="Título" maxlength="120">' +
      '<textarea name="body" rows="4" placeholder="Tu opinión" maxlength="2000" required></textarea>' +
      '<input class="nr-hp" name="website" tabindex="-1" autocomplete="off">' +
      '<button type="submit">Enviar reseña</button> <span id="nr-msg" class="nr-muted"></span></form>';
    root.innerHTML = h;
    document.getElementById('nr-form').addEventListener('submit', submit);
  }

  function submit(e) {
    e.preventDefault();
    var f = e.target, msg = document.getElementById('nr-msg');
    var body = Object.fromEntries(new FormData(f)); body.product_id = pid; body.product_title = ptitle;
    msg.textContent = 'Enviando…';
    fetch(base + '/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (x.ok) { f.reset(); msg.textContent = x.j.message || '¡Gracias!'; } else { msg.textContent = x.j.error || 'Error al enviar.'; }
      })
      .catch(function () { msg.textContent = 'Error de conexión.'; });
  }

  fetch(base + '/products/' + encodeURIComponent(pid) + '/reviews').then(function (r) { return r.json(); }).then(render)
    .catch(function () { root.innerHTML = ''; });
})();
