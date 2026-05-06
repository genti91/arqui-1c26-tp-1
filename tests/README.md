# Pruebas del caso base recibido

Estas pruebas suponen el caso base recibido sin modificaciones en `app/`.

```sh
node --test tests/base-api.test.mjs
node --test tests/redis-api.test.mjs
node --test tests/healthcheck-api.test.mjs
node --test tests/base-api-known-issues.test.mjs
```

Las pruebas de known issues se basan en los problemas de validacion, contrato HTTP y endpoints administrativos documentados en el analisis. Por lo tanto, se espera que estas pruebas fallen mientras la app recibida mantenga esos problemas.
