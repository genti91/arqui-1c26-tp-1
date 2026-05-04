# arVault - Servicio de cambio de monedas :money_with_wings: :currency_exchange:

La idea es tener un servicio que permita comprar y vender monedas dentro de la wallet. Se usan cuentas internas manejadas por la empresa. Por ahora, no se pueden configurar límites, el único límite es que una cuenta se quede sin plata.

Este servicio **no maneja seguridad**, eso lo resuelve vaultSec, para cuando llega al nginx, el request está autenticado y autorizado. TODO: replicar vaultSec!!! :fearful:.

## Configuración

El servicio tiene un Dockerfile para poder armar una imagen de Docker y levantarlo.

### Almacenamiento

El storage de cuentas, tasas y log vive en Redis. Los archivos JSON se usan solo para inicializar Redis cuando arranca vacio. Tienen que existir 3 archivos en el directorio `./seed`:

`accounts.json`

Tiene un array con las cuentas de la empresa, con la moneda y el saldo actual. Ejemplo de una cuenta:

    {
        "id": 1,
        "currency": "ARS",
        "balance": 2000000
    }

`rates.json`

Tiene un objeto con las tasas de cambio. Ejemplo de una tasa:

    "ARS": {
        "BRL": 0.00553,
        "EUR": 0.00091,
        "USD": 0.00094
    }

`log.json`

Tiene un array con el log de transacciones del sistema. Ejemplo de una entrada de log:

    {
        "id": "Uml8yqzZ4Mjgk2tKuN6mL",
        "ts": "2025-02-10T00:10:25.202Z",
        "ok": true,
        "request": {
        "baseCurrency": "USD",
        "counterCurrency": "ARS",
        "baseAmount": 100,
        "baseAccountId": 11,
        "counterAccountId": 10
        },
        "exchangeRate": 1064,
        "counterAmount": 106400,
        "obs": null
    }

## Endpoints

### Tasas de cambio

`GET /rates`

Devuelve las tasas de cambio vigentes.

`PUT /rates`

Permite alterar la tasa entre dos monedas. Calcula la recíproca.

    {
    "baseCurrency": "USD",
    "counterCurrency": "ARS",
    "rate": 1064
    }

- `baseCurrency`: Moneda de origen
- `counterCurrency`: Moneda de destino
- `rate`: Tasa de cambio de la moneda origen hacia la destino. La recíproca se calcula como 1/tasa. Notar que no ganamos plata con la operación de cambio.

TODO

- Manejar distintos valores para ganar plata cuando tengamos una buena base de usuarios :smiling_imp:
- Soportar tiers de usuarios para que, si pagan algo por mes, tengan mejor tasa :rocket:

### Cuentas

`GET /accounts`

Devuelve las cuentas internas, sirve para chequear saldos.

`PUT /accounts/<id>/balance`

Actualiza el saldo de una cuenta. No me gusta cómo está hecho esto, otro servicio debería ocuparse de esto (el que hace las transferencias?)

### Cambio

`POST /exchange`

Ejecuta una operación de cambio de monedas

    {
        "baseCurrency": "USD",
        "counterCurrency": "ARS",
        "baseAmount": 100.0,
        "baseAccountId": 11,
        "counterAccountId": 10
    }

- `baseCurrency`: Moneda origen de la transacción
- `counterCurrency`: Moneda destino de la transacción
- `baseAmount`: Importe en moneda origen a cambiar
- `baseAccountId`: ID de la cuenta origen para la operación de cambio (cuenta del cliente)
- `counterAccountId`: ID de la cuenta destino para la operación de cambio (cuenta del cliente)

Este endpoint busca en las cuentas propias las que correspondan a las monedas. Se valida que haya saldo suficiente para efectuar la operación **en la cuenta propia**. **No** se valida que haya saldo en la cuenta del cliente, se espera que lo haga la UI y que no permita la operación.

Todas las operaciones se registran en un log. Ver más abajo.

### Logs

`GET /logs?page=1&limit=50`

Devuelve el log de operaciones persistido en Redis, paginado en orden cronologico.

- `page`: pagina a consultar. Debe ser un entero positivo. Default: `1`.
- `limit`: cantidad de entradas por pagina. Debe ser un entero positivo. Default: `50`. La API aplica un maximo interno de `100`.

Respuesta:

    {
        "items": [
            {
                "id": "Uml8yqzZ4Mjgk2tKuN6mL",
                "ts": "2025-02-10T00:10:25.202Z",
                "ok": true,
                "request": {
                    "baseCurrency": "USD",
                    "counterCurrency": "ARS",
                    "baseAmount": 100,
                    "baseAccountId": 11,
                    "counterAccountId": 10
                },
                "exchangeRate": 1064,
                "counterAmount": 106400,
                "obs": null
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 50,
            "totalItems": 1,
            "totalPages": 1
        }
    }

### Contrato de rutas actualizado

Todas las rutas responden JSON. Cuando una validación falla, la respuesta tiene este formato:

    {
        "errorCode": "INVALID_BASE_AMOUNT",
        "obs": "Invalid base amount"
    }

Errores comunes:

- `400 INVALID_JSON`: el body no es JSON válido.
- `503 STORAGE_UNAVAILABLE`: Redis no está disponible.

Las validaciones devuelven `400` y no modifican cuentas, tasas ni logs. Los montos de wallet se normalizan a 2 decimales antes de responder o persistir.

Rutas disponibles:

- `GET /accounts`: devuelve las cuentas internas ordenadas por `id`.
- `PUT /accounts/:id/balance`: actualiza una cuenta interna y devuelve solo la cuenta modificada. `id` debe ser entero positivo y `balance` debe ser un número finito mayor o igual a 0. Errores: `INVALID_ACCOUNT_ID`, `INVALID_BALANCE`, `ACCOUNT_NOT_FOUND`.
- `GET /rates`: devuelve las tasas de cambio vigentes.
- `PUT /rates`: actualiza una tasa y guarda la recíproca como `1 / rate`. Las monedas deben existir, no estar vacías y ser distintas; `rate` debe ser positivo, finito y con recíproca finita. Errores: `INVALID_BASE_CURRENCY`, `INVALID_COUNTER_CURRENCY`, `SAME_CURRENCY`, `INVALID_RATE`.
- `POST /exchange`: ejecuta una operación de cambio. Errores de validación: `INVALID_BASE_CURRENCY`, `INVALID_COUNTER_CURRENCY`, `SAME_CURRENCY`, `INVALID_BASE_AMOUNT`, `INVALID_BASE_ACCOUNT_ID`, `INVALID_COUNTER_ACCOUNT_ID`, `RATE_NOT_FOUND`, `INVALID_COUNTER_AMOUNT`.
- `GET /logs`: devuelve logs paginados. Acepta `page` y `limit`; el `limit` efectivo nunca supera `100`. Errores: `INVALID_PAGE`, `INVALID_LIMIT`. Reemplaza al endpoint viejo `GET /log`. `GET /log` ya no existe.

Si `POST /exchange` no tiene saldo suficiente en la cuenta propia de la moneda destino, devuelve `409 INSUFFICIENT_COUNTER_FUNDS` y registra la operación fallida en el log.

Una respuesta exitosa de `POST /exchange` tiene esta forma:

    {
        "id": "Uml8yqzZ4Mjgk2tKuN6mL",
        "ts": "2025-02-10T00:10:25.202Z",
        "ok": true,
        "request": {
            "baseCurrency": "USD",
            "counterCurrency": "ARS",
            "baseAccountId": 11,
            "counterAccountId": 10,
            "baseAmount": 100
        },
        "exchangeRate": 1064,
        "counterAmount": 106400,
        "obs": null
    }

Una respuesta exitosa de `PUT /accounts/:id/balance` tiene esta forma:

    {
        "id": 1,
        "currency": "ARS",
        "balance": 2000000
    }

Una respuesta exitosa de `GET /rates` y `PUT /rates` tiene esta forma:

    {
        "USD": {
            "ARS": 1064
        },
        "ARS": {
            "USD": 0.0009398496240601503
        }
    }

## Metricas de negocio

Cuando una operacion de `POST /exchange` se completa exitosamente, el servicio emite metricas StatsD (hacia Graphite) con acumulados por moneda:

- `exchange-api.business.volume.<MONEDA>`: volumen operado acumulado por moneda (compras + ventas).
- `exchange-api.business.net.<MONEDA>`: neto acumulado por moneda (compras suman, ventas restan).

Configuracion por variables de entorno (opcionales):

- `STATSD_HOST` (default: `graphite`)
- `STATSD_PORT` (default: `8125`)
- `STATSD_PREFIX` (default: `exchange-api`)

## TODO

- Redis es el storage runtime. Los archivos JSON quedan solo como seed inicial.
- No valida casi nada, solo que los parámetros de los JSON tengan algún valor :collision:
- Ver el tema del manejo de las cuentas, debería ser responsabilidad de otro servicio.
