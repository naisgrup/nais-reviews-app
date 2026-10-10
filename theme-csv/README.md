# Reseñas desde un CSV (sin servidor)

Sección de tema que muestra reseñas leídas de un archivo CSV, con el mismo diseño que «Reseñas con foto».

- `deload-csv-reviews.liquid` → va en `sections/` del tema.
- `nais-reviews.csv` → va en `assets/` del tema (ejemplo de formato; las filas de ejemplo son inventadas).

Columnas: `product` (handle del producto), `author`, `review_date` (`2026-09-28` o `28/09/2026`), `rating` (1-5), `title`, `body`, `verified` (`true`/`false`), `photo` (URL, opcional) y opcional `status` (`hidden` oculta la fila).
Muestra las más recientes del producto de la página. Solo la columna `verified = true` muestra la insignia «Verified purchase».
