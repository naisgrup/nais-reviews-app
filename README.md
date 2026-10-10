# Nais Reviews App

App de reseñas para tu tienda Shopify:

- **Widget** para tu tienda: muestra estrellas, promedio y reseñas, y un formulario para que los clientes dejen la suya.
- **Panel de administración** (optimizado para iPhone): aprobar, rechazar, borrar, responder públicamente, buscar y exportar a CSV.
- Las reseñas nuevas quedan **pendientes** hasta que tú las apruebas. Anti-spam incluido (campo trampa + límite por IP).

## Probar en local
```bash
npm install
ADMIN_PASSWORD=mi-clave npm start     # http://localhost:3000/admin
npm test
```

## Publicarla (desde el iPhone)
1. En GitHub, conecta este repo a [Render](https://render.com) → **New → Blueprint** (usa `render.yaml`).
2. Cuando lo pida, define `ADMIN_PASSWORD` (tu contraseña del panel).
3. Al terminar tendrás una URL como `https://nais-reviews-app.onrender.com`. Abre `/admin` en Safari y pulsa *Compartir → Añadir a pantalla de inicio* para tenerla como app.

> El disco persistente de Render es de pago. Sin disco, las reseñas se borran en cada reinicio.

## Instalarla en tu tienda Shopify
En *Tienda online → Temas → ⋯ → Editar código → Sections/`main-product.liquid`* (o snippet de producto), pega:

```liquid
<div id="nais-reviews" data-product-id="{{ product.id }}" data-product-title="{{ product.title | escape }}"></div>
<script src="https://TU-APP.onrender.com/widget.js" defer></script>
```

Opcional: pon en `ALLOWED_ORIGINS` el dominio de tu tienda (ej. `mitienda.com,mitienda.myshopify.com`) para que solo ella pueda enviar reseñas.

## API
| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/products/:id/reviews` | Reseñas aprobadas + promedio |
| POST | `/api/reviews` | Enviar reseña (queda pendiente) |
| * | `/admin/api/...` | Moderación (cabecera `x-admin-password`) |

## Próximos pasos posibles
Importar reseñas existentes, correo automático pidiendo reseña tras el pedido, insignia de "compra verificada" (webhooks de Shopify), fotos en reseñas, y empaquetarla como app oficial de Shopify (OAuth + app embebida) si la quieres publicar en la App Store.
