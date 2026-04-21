# Mejoradora Granada

Landing estática en HTML con funciones serverless en Vercel para OCR de facturas y guardado de leads en Supabase.

## Estructura

```text
/
  index.html
  logo_mejoradora.png
  api/
    create-lead.js
    gemini.js
```

## Variables de entorno (Vercel)

Configúralas en `Project Settings -> Environment Variables`:

- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Después de añadir o cambiar variables, haz un redeploy del proyecto.

## Requisitos operativos

- Debe existir el bucket de Supabase Storage `invoices`.
- `api/create-lead.js` sube la factura al bucket y luego inserta el lead en `public.leads`.
- El límite práctico de archivo es `10 MB`. El frontend y el backend lo validan para evitar errores de payload y timeouts en Vercel.

## Desarrollo

En Vercel, `api/create-lead.js` y `api/gemini.js` se detectan automáticamente como funciones serverless.
