# Mejoradora Granada

Landing estática en HTML para captación de leads energéticos, preparada para desplegarse en Vercel.

## Estructura

```text
/
  index.html
  logo-mejoradora-granada.png
  api/
    gemini.js
```

## Despliegue en Vercel

1. Sube este proyecto a GitHub.
2. Importa el repositorio en Vercel.
3. En `Settings > Environment Variables`, crea esta variable:

```text
GEMINI_API_KEY=tu_api_key_real
```

4. Haz un nuevo despliegue.

## Importante

- El logo usa ruta relativa: `logo-mejoradora-granada.png`
- La API key de Gemini no está en `index.html`
- La llamada a Gemini pasa por `api/gemini.js`
- No subas archivos `.env` al repositorio

## Desarrollo

Si pruebas la web en Vercel, la ruta `/api/gemini` quedará disponible automáticamente como función serverless.
