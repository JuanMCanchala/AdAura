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

- Commits y push con la cuenta personal **JuanMCanchala** (`Juan <canchalajuanmanuel@gmail.com>`, ya fijado en el config local del repo).
- **Sin trailer `Co-Authored-By`.**
- Repo privado: https://github.com/JuanMCanchala/darwin-agents

## Dónde están los huecos declarados

- `lib/creative.ts` no existe todavía. El tipo `Creative` está en `lib/types.ts` y el campo `creative` de cada agente es `null`. Si se conecta un LLM, va ahí, y el fallback de plantilla tiene que seguir funcionando sin API key.
- No hay cruce entre estrategias, solo mutación (`lib/genome.ts`, función `mutate`).
- `Market.peek()` devuelve `null`; se dejó como gancho para un "¿cuál era la respuesta?" post-demo. El dato real lo calcula `bruteForceBest`.
