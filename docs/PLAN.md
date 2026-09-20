# Darwin Agents — plan y ruta

Ethereum Builders Tour, Cali · 19–20 sep 2026 · Auditorio SIDOC, Icesi
Submission: Devfolio, "EAG Global Buildathon"

---

## 1. Qué estamos construyendo

Una plataforma donde el usuario carga un producto y un presupuesto, y el sistema crea una **población de agentes de marketing autónomos**. Cada agente tiene:

- una **estrategia distinta** (su genoma: plataforma, público, formato, tono, CTA, agresividad de puja, frecuencia),
- una **wallet propia** en Ethereum,
- un **presupuesto que el contrato no lo deja pasar**.

Los agentes gastan para conseguir ventas. Cada 3 ciclos hay un corte generacional: los que pierden plata se apagan, los rentables se reproducen con una mutación pequeña, y el hijo hereda parte del presupuesto no gastado del padre.

**Nadie le dice al sistema qué estrategia funciona. Lo descubre pagando por equivocarse.**

### El pitch de 20 segundos

> Hay 40.500 estrategias posibles. Nadie tiene presupuesto para probarlas una por una. Nosotros ponemos una población a competir por el dinero: los que venden se reproducen, los que no, se apagan. Y el techo de gasto no es una instrucción al modelo — es una transacción que revierte.

### Los dos claims que sostienen todo

| Claim                                               | Cómo lo probamos en vivo                                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La población **realmente aprende**                  | `npm run sim` corre 20 generaciones y compara contra el óptimo global calculado por fuerza bruta sobre las 40.500 estrategias. Falla con código 1 si no mejora. |
| El dinero del humano **está acotado por la cadena** | Botón "Run it on chain": el agente intenta gastar de más y el nodo rechaza la transacción con `EpochCapExceeded` — el techo diario, que es el que muerde primero porque `epochCap` es `perAgent / 12`. El techo de por vida (`AllowanceExceeded`) y el de la campaña (`GlobalCapExceeded`) están cubiertos por los tests del contrato. |

---

## 2. Tracks que apuntamos

Un mismo proyecto puede ganar varios premios.

| Fuente              | Track                         | Premio                  |
| ------------------- | ----------------------------- | ----------------------- |
| EAG                 | AI x Ethereum & Agent Economy | 5 × $200 USDT           |
| HashKey Chain       | AI Agents · AI × Web3         | $500 / $300 / $200 USDT |
| Ethereum Foundation | —                             | Tickets Devcon VIII     |

---

## 3. Por qué Ethereum y no una base de datos

Esta es la pregunta que va a hacer el jurado. La respuesta:

El presupuesto de un agente **no es un número en un prompt**. Es una variable de estado, y pasarse hace que la transacción **revierta**.

`AgentTreasury.spend()` comprueba cuatro techos independientes antes de mover un token:

| Techo         | Qué impide                                                                |
| ------------- | ------------------------------------------------------------------------- |
| `budget`      | Que un agente gaste más de lo que se le asignó (más lo que él mismo ganó) |
| `epochCap`    | Que queme todo su presupuesto en un día                                   |
| `globalCap`   | Que la población entera pase del límite de la campaña                     |
| liquidez real | Que se prometa dinero que la tesorería no tiene                           |

Hay un test que arma 4 agentes con $140 de allowance nominal contra un techo de $50 y comprueba que no sale **ni un centavo** de más.

Y el **árbol evolutivo completo se reconstruye solo con los eventos** `AgentRegistered` y `AgentReproduced`, que llevan el padre y el hash del genoma. Un indexador no necesita confiar en nuestra base de datos.

---

## 4. Estado actual

| Fase                   | Qué incluye                                               | Estado                                |
| ---------------------- | --------------------------------------------------------- | ------------------------------------- |
| 0 · Scaffold           | Monorepo, Foundry, Next 15, Tailwind 4                    | **listo**                             |
| 1 · Contratos          | `AgentTreasury.sol`, `MockUSD.sol`, deploy script         | **listo — 17/17 tests**               |
| 2 · Motor evolutivo    | genoma, mercado, selección, mutación, inmigración         | **listo — 20/20 tests**               |
| 3 · Capa on-chain      | `chain.ts` con viem, wallet HD por agente, ABIs generados | **probado contra Anvil, sin desplegar en HashKey** |
| 4 · x402 / MPP         | endpoint 402 real + verificación contra la cadena         | **probado de punta a punta contra Anvil** |
| 5 · Dashboard          | linaje, economía, tabla, controles, log                   | **listo**                             |
| 6 · Landing + tracking | wizard de campaña, storefront, conversión atribuida       | **listo**                             |
| 7 · Entrega            | deploy, video, Devfolio                                   | **pendiente**                         |

### Lo que falta, en orden

1. **Fondear el deployer** en la faucet de HashKey testnet — `0xE99B67867E96833583ccadCFcF13499A10605544` en https://hskchain.net/faucet (tiene captcha, lo tiene que hacer una persona).
2. **Desplegar** `MockUSD` + `AgentTreasury` en HashKey testnet (chainId 133) y llenar `TREASURY_ADDRESS` / `TOKEN_ADDRESS` en `.env`.
3. **Probar el botón "Run it on chain"** de punta a punta contra la testnet. (De punta a punta contra Anvil ya pasa; ver HANDOFF.md.)
4. **Deploy a Vercel** (root directory `apps/web`).
5. **Video de 2–3 min** + submission en Devfolio.

### Orden de sacrificio si el tiempo aprieta

Primero cae el modo de fitness avanzado, luego los creativos generados con LLM, luego Sepolia (nos quedamos solo con HashKey). **Nunca** se sacrifican: el contrato con límites, el ciclo evolutivo y el árbol de linaje.

---

## 5. Cómo está armado

```
contracts/                 Foundry
  src/AgentTreasury.sol    custodia, cuatro techos de gasto, linaje on-chain
  src/MockUSD.sol          ERC20 de prueba, 6 decimales, faucet abierta
  test/                    17 tests, uno por cada forma de pasarse del presupuesto
  script/Deploy.s.sol

apps/web/
  lib/genome.ts            el espacio de 40.500 estrategias + mutación
  lib/market.ts            simulador con verdad latente oculta
  lib/evolution.ts         fitness, selección, reproducción, inmigración
  lib/engine.ts            el bucle: un tick = un día de mercado
  lib/chain.ts             viem: wallet HD por agente, llamadas a la tesorería
  lib/x402.ts              protocolo 402: cotizar, cobrar, verificar contra la cadena
  lib/store.ts             sesión en memoria + snapshot en disco
  lib/view.ts              lo que ve el navegador (dólares, sin bigints)

  app/page.tsx             wizard de campaña
  app/dashboard/           el tablero
  app/buy/[tracking]/      storefront de prueba, conversión atribuida
  app/api/campaign         crear / leer / terminar
  app/api/tick             avanzar la simulación
  app/api/control          pausar, matar, recapar, repesar el fitness
  app/api/services/ads     el endpoint x402
  app/api/prove            el ciclo completo on-chain, para la demo
  app/api/convert          webhook de venta desde el storefront

  scripts/sim.ts           la verificación headless
  scripts/abi.ts           copia los ABIs desde los artefactos de Foundry
```

### Decisiones tomadas (y por qué)

- **Actividad simulada, no publicación real.** Los agentes no postean en Instagram. El mercado es un simulador con verdad latente derivada del producto, así que el óptimo cambia en cada campaña y no se puede memorizar. Cero dependencia de APIs de terceros que se caigan en la demo.
- **Todo el dinero en micro-dólares enteros.** Coincide exacto con los 6 decimales del ERC20 y no hay drift de coma flotante en la contabilidad.
- **Una wallet HD por agente, índice determinista.** Si el backend se reinicia, recupera las mismas direcciones en vez de dejar huérfanas las que ya fondeó.
- **El agente firma su propio `spend()`.** La tesorería no le cree al backend quién está gastando: lee `msg.sender`.
- **Los ingresos entran de verdad.** `recordRevenue` hace `transferFrom` desde el oráculo, así que la revenue de un agente es dinero que llegó, no una métrica auto-reportada.
- **Sesión en memoria + snapshot JSON.** La contabilidad de verdad vive en la cadena; esto solo cachea genomas y creativos. En Vercel el snapshot no persiste y no importa.

---

## 6. La escala del presupuesto, que no es obvia

El primer intento usaba $100 entre 6 agentes y **la población se extinguía sin una sola venta**. No era un bug del código sino de la economía:

Con un producto de $49 al 62% de margen, cada venta aporta $30. Para distinguir una estrategia buena de una con suerte hacen falta **decenas de conversiones**, y a un CTR del 1,2% y CVR del 2%, conseguir 300 clics cuesta ~$150. Evaluar **una sola** estrategia cuesta más que toda la campaña de $100.

Por eso los defaults son:

```
budget       $60.000
perAgent     budget × 3,5%   (≈ $2.100)   ← deja reserva para hijos e inmigrantes
epochCap     perAgent / 12   (≈ $175)     ← el agente vive ~12 días, no 4
```

Tres correcciones que salieron de esto y que valen para el pitch:

1. **No se juzga a un agente antes de que compre 400 clics.** Matar por 3 días sin ventas no es selección, es ruido, y se lleva por delante a la población antes de que aprenda nada.
2. **Un agente muerto libera su presupuesto no gastado.** Antes quedaba comprometido para siempre y no había con qué financiar sangre nueva.
3. **Solo se compromete parte del budget en la generación 0.** Si se reparte todo de entrada, la evolución se queda sin con qué trabajar.

---

## 7. Lo que se le enseña al jurado, en orden

1. **El wizard**: producto, precio, presupuesto. "Esto es todo lo que el usuario decide."
2. **Dashboard, generación 0**: seis agentes, seis estrategias al azar, todos perdiendo plata.
3. **Correr 20–30 días**: la tira de linaje se llena. Discos verdes que crecen, anillos sepia de los que murieron, líneas que unen hijo con padre.
4. **La tabla**: quién está vivo, qué estrategia le funcionó, cuánto gastó y cuánto ganó. Señalar un hijo: "heredó de A04, le cambió el tono y el CTA".
5. **"Prove it on chain"**: el agente pide inventario → 402 → paga desde su wallet → recibe el inventario → intenta gastar de más → **la cadena lo rechaza** (en pantalla sale `reverted with EpochCapExceeded`).
6. **El explorer**: abrir la tesorería y mostrar los eventos. "El árbol que acaban de ver se reconstruye desde acá sin confiar en nosotros."
7. **El número**: en el seed 99, la generación 0 rinde **−62%** y la generación 7 rinde **+433%**. El campeón coincide en 6 de 7 genes con el óptimo global que calculamos por fuerza bruta.

---

## 8. Correr el proyecto

```bash
npm install

npm run contracts:test    # forge test — 17 tests
npm run test              # vitest — 20 tests
npm run sim               # 20 generaciones headless vs el óptimo global
npm run dev               # http://localhost:3000
```

Para la parte on-chain hace falta un `.env` en la raíz (ya está creado y **gitignored**):

```
DEPLOYER_MNEMONIC="…"
DEPLOYER_PRIVATE_KEY=0x…
DEPLOYER_ADDRESS=0xE99B67867E96833583ccadCFcF13499A10605544

CHAIN_ID=133
RPC_URL=https://testnet.hsk.xyz
EXPLORER_URL=https://testnet-explorer.hskchain.net

TREASURY_ADDRESS=      # llenar tras el deploy
TOKEN_ADDRESS=         # llenar tras el deploy
```

Desplegar:

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url https://testnet.hsk.xyz --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

Sin `TREASURY_ADDRESS` la app funciona igual: el motor corre, el dashboard se ve, y el panel "Prove it on chain" dice qué falta.

---

## 9. Redes

| Red                   | chainId  | RPC                       | Explorer                               | Faucet                      |
| --------------------- | -------- | ------------------------- | -------------------------------------- | --------------------------- |
| HashKey Chain Testnet | 133      | `https://testnet.hsk.xyz` | https://testnet-explorer.hskchain.net/ | https://hskchain.net/faucet |
| Ethereum Sepolia      | 11155111 | —                         | —                                      | —                           |

No se usa dinero real. `MockUSD` es un ERC20 de prueba con faucet abierta.

---

## 10. Qué queda fuera del MVP, a propósito

Vale decirlo en el pitch: saber dónde está el borde es parte de la propuesta.

- Los agentes no publican de verdad en redes sociales. El mercado es simulado.
- No hay generación de creativos con LLM todavía (el hueco está en `lib/creative.ts`, el tipo `Creative` ya existe).
- Sin cruce entre estrategias, solo mutación.
- Una campaña a la vez por servidor.
- Testnet únicamente.
