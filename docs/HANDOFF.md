# Handoff

Para quien siga desde otra sesión. El plan completo está en [PLAN.md](./PLAN.md); esto es solo lo que hace falta para arrancar sin releerlo.

## Arrancar en un minuto

```bash
npm install
npm run contracts:test    # 17/17 — necesita forge en el PATH
npm run test              # 20/20
npm run dev               # http://localhost:3000
```

Si `forge` no está: descargar `foundry_v1.8.3_win32_amd64.zip` de los releases de foundry-rs y ponerlo en el PATH. Acá está en `C:\Users\canch\bin\foundry`.

## Todo verde, hoy

|                |                              |
| -------------- | ---------------------------- |
| `forge test`   | 17/17                        |
| `vitest`       | 20/20                        |
| `tsc --noEmit` | limpio                       |
| `next build`   | compila                      |
| `npm run sim`  | PASS en los 5 seeds probados |

### El camino on-chain ya se ejecutó (contra Anvil, no contra HashKey)

Los 6 pasos de `/api/prove` corren enteros contra un EVM real: se levanta un nodo local con
el mismo chainId 133, se despliega con el mismo `Deploy.s.sol`, y el agente registra wallet,
paga su x402 firmando él mismo, recibe el inventario y **la cadena le rechaza el sobregiro**.

```bash
anvil --chain-id 133 --port 8545 --silent &
cd contracts && forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
# copiar las dos direcciones a apps/web/.env.local con RPC_URL=http://127.0.0.1:8545
```

Ojo con dos cosas que salieron de ahí:

- **El sobregiro revierte con `EpochCapExceeded`, no con `AllowanceExceeded`.** El techo diario
  es 12× más apretado que el de por vida (`epochCap = perAgent / 12`), así que muerde primero.
  Los dos son reales y los dos tienen test; el guion del pitch ya dice el correcto.
- **Falta montar Anvil no prueba gas real.** Contra HashKey esperar fricción en gas, nonces y
  timeouts del RPC, que es justo lo que un nodo local no reproduce.

## Lo siguiente, en orden

1. **Fondear el deployer.** `0xE99B67867E96833583ccadCFcF13499A10605544` en https://hskchain.net/faucet. Tiene captcha: lo tiene que hacer una persona.
2. **Desplegar.**
   ```bash
   cd contracts
   forge script script/Deploy.s.sol --rpc-url https://testnet.hsk.xyz --broadcast --private-key $DEPLOYER_PRIVATE_KEY
   ```
   Copiar las dos direcciones que imprime a `TREASURY_ADDRESS` y `TOKEN_ADDRESS` en el `.env` de la raíz, y reiniciar `npm run dev`.
3. **Probar el botón "Run it on chain"** del dashboard contra HashKey. Los 6 pasos ya corren
   enteros contra Anvil (ver abajo), así que la lógica está verificada; lo que falta es la
   fricción que solo da una red de verdad: gas, nonces y timeouts del RPC.
4. **Deploy a Vercel.** Root directory `apps/web`. Las variables van como env vars del
   proyecto — la lista completa y comentada está en `.env.example`.

   La app **no necesita cadena para desplegarse**: sin `TREASURY_ADDRESS` / `TOKEN_ADDRESS`
   el wizard, el dashboard, la evolución y el storefront funcionan igual, y el panel
   "Prove it on chain" explica qué falta en vez de romperse. Así que se puede publicar la URL
   antes de tener los contratos y llenar las direcciones después.

   Dos cosas que ya están resueltas y conviene no deshacer:

   - **Next tiene que ir en 15.5.25 o más.** Con 15.5.4 el build termina bien y Vercel
     **rechaza el deploy**: `Vulnerable version of Next.js detected` (CVE-2025-66478). No es
     un aviso, es un bloqueo.
   - `apps/web/vercel.json` fija `maxDuration` de `/api/prove` en **60s**. El plan de la
     cuenta es Hobby, que no permite más, y pedir 120 hace fallar el deploy.
   - `vercel deploy` **sin deployment de producción previo apunta a producción**, no a
     preview. Para un preview cuando el proyecto está vacío, desplegar dos veces o usar el
     dashboard. No es lo que uno espera del nombre del comando.
   - El filesystem de Vercel es de solo lectura, así que el cursor de wallets no se puede
     persistir. El fallback reparte bloques con un contador de proceso, no con el reloj: dos
     campañas creadas en el mismo segundo tendrían el mismo bloque y volvería el
     `AgentExists()`. Hay test que lo cubre.
5. **Video de 2–3 min** siguiendo el guion de la sección 7 de PLAN.md, y submission en Devfolio ("EAG Global Buildathon").

## Un bug que ya se arregló y conviene no volver a introducir

**Correr la demo dos veces contra el mismo despliegue fallaba con `AgentExists()`.**

`AgentTreasury` indexa agentes **por dirección y de forma global**, no por campaña. La sesión
reiniciaba la derivación HD en 0 con cada campaña nueva, así que la segunda campaña volvía a
derivar las wallets de la primera y el contrato la rechazaba. En vivo eso significa que el
botón "Prove it on chain" funciona en la primera campaña y revienta en la segunda.

El arreglo (`lib/store.ts`): cada campaña reclama un **bloque de 256 índices** de derivación
mediante un cursor persistido en `data/wallet-cursor.json`. `lib/store.test.ts` lo cubre —
si alguien vuelve a poner `nextWalletIndex: 0` en `startCampaign`, ese test se pone rojo.

## Cosas que conviene saber antes de tocar el código

- **El dinero son micro-dólares enteros**, nunca floats. `usd(49)` → `49_000_000`. Coincide con los 6 decimales de `MockUSD`.
- **Si cambias algo en `contracts/src`, corre `npm run abi -w web`.** Los ABIs de `apps/web/lib/abi.ts` se generan desde los artefactos de Foundry; si no los regeneras, la app y los contratos divergen en silencio.
- **`lib/evolution.test.ts` es el guardián del pitch.** El test "improves mean ROI over 18 generations" falla si la población deja de aprender en cualquiera de 5 seeds. Si lo ves rojo, no lo relajes: algo se rompió de verdad.
- **La escala del presupuesto importa y no es obvia.** Ver sección 6 de PLAN.md. Con presupuestos chicos la población se extingue sin vender nada, y no es un bug del código.
- **`reactStrictMode` está en `false`** a propósito: el doble render de dev haría parecer que los ticks corren dos veces sobre el estado del módulo.
- **La sesión vive en memoria del proceso**, con snapshot en `apps/web/data/campaign.json`. Reiniciar el server conserva la población pero re-siembra el generador de ruido.

## Convenciones del repo

- Commits y push con la cuenta **jucollas** (`jucollas <webflash@somosflash.com>`, ya fijado en el config local del repo). Los commits hasta `1a499f5` van como `Juan <canchalajuanmanuel@gmail.com>`, de cuando el repo vivía en la otra cuenta.
- **Sin trailer `Co-Authored-By`.**
- Repo público: https://github.com/jucollas/darwin-agents

  Se movió desde `JuanMCanchala/darwin-agents` porque **Vercel solo deja conectar un repo
  personal a su dueño**: un colaborador no puede, por más invitación que acepte. Sin eso la
  integración de git nunca enlaza y no hay deploy automático.

## La red publicitaria

`lib/ads/` es una interfaz con una sola implementación: un simulador local. El agente no sabe
cuál está detrás, y ese es el punto — `AD_PLATFORM` decide, y el resto del código no cambia.

```
Agente → AdPlatform (interfaz) → MockAdPlatform   (hoy)
                               → AdsterraAdapter  (después)
```

**El simulador no inventa ventas.** Vende impresiones, convierte algunas en clics y devuelve
cada clic por separado; si ese clic termina en venta lo decide el mismo recorrido de landing
que haría un visitante real. Por eso la atribución que muestra la demo es la de verdad.

### Demo reproducible

```
AD_PLATFORM=mock
DEMO_SCENARIO=competition     # semilla 999
```

15 ticks dan +170% de ROI agregado: un campeón en +422% que **sube** su presupuesto a 150%,
dos hijos rentables, y cuatro agentes que **pausan su propia campaña**. Los números salen de
la simulación; la semilla solo evita que el pitch dependa de la suerte.

### Para añadir Adsterra después

Un archivo nuevo, `lib/ads/adsterra.ts`, que implemente `AdPlatform` contra la API v3
(verificada): `createCampaign` → `POST /advertiser/campaign.json`, `pauseCampaign` y
`updateBudget` → `PATCH /advertiser/campaign/{id}.json`, `getStats` →
`GET /advertiser/stats.json`, y `recordConversion` → el postback a `pbterra.com`. Más una
rama en `lib/ads/index.ts`. **Nada de `engine.ts` ni de los agentes se toca.**

Ojo con lo que no es código: Adsterra pide depósito mínimo de $100, KYC después del primer
pago, y moderación antes de que una campaña entregue. Por eso el simulador es el camino de
la demo y no un parche temporal.

### Si escribes un harness headless

Llama a `resetAgentCounter()` antes de cada corrida. `startCampaign()` ya lo hace; sin eso
dos corridas con la misma semilla dan economía idéntica pero etiquetas distintas (A01 vs
A11) y parece que la simulación no es determinista cuando sí lo es.

## Dónde están los huecos declarados

- ~~`lib/creative.ts` no existe~~ — **ya existe**. Cada agente escribe su propio pitch a
  partir del genoma, la descripción y la foto del producto, y el navegador lo dice en voz
  alta (`components/PitchStage.tsx`, `app/api/pitch`).

  **La foto es un asset de la publicación, no entrada del modelo.** El agente decide qué
  decir a partir del brief de texto y su genoma; la imagen se adjunta al post terminado,
  como en un anuncio de verdad. Además de ser la semántica correcta, es lo que hace viable
  un modelo local: una imagen son ~1.000 tokens de prompt contra unos cientos del texto.

  Dos cosas que conviene no romper: **sin `ANTHROPIC_API_KEY` la demo sigue funcionando**
  (cae al fallback de plantillas, que igual da un pitch distinto por genoma), y la voz es la
  del navegador (Web Speech API), no un servicio — no cuesta, no necesita key y no se puede
  caer en vivo. `voiceFor()` deriva tono y velocidad del genoma para que dos estrategias
  distintas suenen distinto.
- No hay cruce entre estrategias, solo mutación (`lib/genome.ts`, función `mutate`).
- `Market.peek()` devuelve `null`; se dejó como gancho para un "¿cuál era la respuesta?" post-demo. El dato real lo calcula `bruteForceBest`.
