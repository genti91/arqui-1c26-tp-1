# Performance scripts

## Caso base

Desde `perf/`:

```sh
npm run exchange:spike
npm run exchange:load
npm run exchange:endurance
npm run api
```

## Nginx escalado

Desde la raiz del proyecto, generar el compose escalado y levantarlo:

```sh
node generate-scaled-compose.mjs nginx=3
docker compose -f docker-compose-scaled.yml up -d --build --scale api=3
```

Desde `perf/`, correr el escenario con la misma cantidad de instancias nginx:

```sh
npm run exchange:spike -- nginx=3
```

Tambien se puede correr:

```sh
npm run exchange:load -- nginx=3
npm run exchange:endurance -- nginx=3
npm run api -- nginx=3
```

Los escenarios escalados se generan en `perf/*-scaled.yaml`.

`nginx=3` define cuantas entradas nginx usan los escenarios. `--scale api=3` define cuantas replicas de API levanta Docker Compose detras de nginx.

Para frenar el entorno escalado:

```sh
docker compose -f docker-compose-scaled.yml down
```

## Cambiar N sin resetear demás servicios

Si solo se quiere cambiar la cantidad de instancias de nginx y conservar dashboards, datos de Grafana, Redis y demas volumenes:

Desde la raiz del proyecto:

```sh
node generate-scaled-compose.mjs nginx=3
docker compose -f docker-compose-scaled.yml up -d --build --remove-orphans --scale api=3
```

Despues, desde `perf/`, correr los escenarios con el mismo valor de nginx:

```sh
npm run exchange:spike -- nginx=3
```

Al cambiar solo la cantidad de replicas de API, no hace falta regenerar escenarios:

```sh
docker compose -f docker-compose-scaled.yml up -d --build --remove-orphans --scale api=5
docker compose -f docker-compose-scaled.yml restart nginx-1 nginx-2 nginx-3
```

Reiniciar nginx hace que vuelva a resolver el servicio `api` y vea las replicas actuales.
