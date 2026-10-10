# Nais Reviews App

App de reseñas para **una o varias tiendas Shopify**:

- **Widget** para el tema de cada tienda: estrellas, promedio, reseñas y formulario para que los clientes dejen la suya.
- **Panel de administración** (hecho para el móvil): selector de tienda, aprobar/rechazar/borrar, responder, buscar, **importar CSV** y **exportar CSV**.
- Las reseñas nuevas quedan **pendientes** hasta que las apruebas. Anti-spam: campo trampa + límite por IP.
- Las reseñas importadas se marcan como *importadas* y muestran una etiqueta configurable (por defecto "Imported review"). Solo la insignia "Compra verificada" indica compra real.

## Probar en local
```bash
npm install
ADMIN_PASSWORD=mi-clave npm start     # http://localhost:3000/admin
npm test
```

## Publicarla
Necesita un servidor siempre encendido (Shopify no puede guardar ni recibir las reseñas por sí solo).
1. En [Render](https://render.com): **New → Blueprint** y elige este repo (usa `render.yaml`).
2. Define `ADMIN_PASSWORD`. El disco persistente (1 GB) es de pago: sin él, se pierden los datos al reiniciar.
3. Abre `https://TU-APP.onrender.com/admin` y añádela a la pantalla de inicio.

## Añadir una tienda (se repite por cada tienda)
1. En el panel: **+ Tienda** y escribe el dominio de Shopify (`mitienda.myshopify.com`).
2. En el tema de esa tienda (*Tienda online → Temas → Editar código*), en la plantilla del producto pega:
```liquid
<div id="nais-reviews" data-shop="{{ shop.permanent_domain }}" data-product-id="{{ product.handle }}" data-product-title="{{ product.title | escape }}"></div>
<script src="https://TU-APP.onrender.com/widget.js" defer></script>
```
3. Opcional: en `ALLOWED_ORIGINS` pon los dominios de tus tiendas para que solo ellas puedan enviar reseñas.

Una tienda no registrada en el panel no puede enviar ni mostrar reseñas.

## Importar y exportar (desde el panel)
Abre **Importar / exportar**:
- **Importar CSV:** columnas `product, author, rating, body` (opcionales: `title, review_date, email, verified, reply`). `product` es el *handle* del producto (la parte final de su URL). Acepta también nombres en español y el formato de Judge.me (`product_handle`, `reviewer_name`...). Fechas `2026-09-01` o `01/09/2026`. Puedes importarlas como pendientes o aprobadas.
- **Exportar CSV:** descarga todas las reseñas de la tienda seleccionada. Ese mismo archivo se puede importar en otra tienda.
- **Aprobar todas las pendientes:** útil tras importar.

Importa solo reseñas reales de tus clientes o con permiso expreso. No cambies el texto de reseñas ajenas ni las presentes como de tu tienda.

## API
| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/:tienda/products/:producto/reviews` | Reseñas aprobadas + promedio |
| POST | `/api/:tienda/reviews` | Enviar reseña (queda pendiente) |
| * | `/admin/api/...` | Panel (cabecera `x-admin-password`) |

## Límites actuales
Una sola contraseña de administrador para todas las tiendas. No es una app instalable desde la tienda de apps de Shopify (eso requeriría cuenta de Partner, OAuth y revisión de Shopify). Estaría bien añadir después: correo automático pidiendo reseña tras el pedido, fotos y verificación de compra con webhooks.
