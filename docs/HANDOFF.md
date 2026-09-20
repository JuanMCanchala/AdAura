# Handoff

Para quien siga desde otra sesión. El plan completo está en [PLAN.md](./PLAN.md); esto es solo lo que hace falta para arrancar sin releerlo.

## Arrancar en un minuto

```bash
npm install
npm run contracts:test    # 17/17 — necesita forge en el PATH
npm run test              # 18/18
npm run dev               # http://localhost:3000
```

Si `forge` no está: descargar `foundry_v1.8.3_win32_amd64.zip` de los releases de foundry-rs y ponerlo en el PATH. Acá está en `C:\Users\canch\bin\foundry`.

## Todo verde, hoy

|                |                              |
| -------------- | ---------------------------- |
| `forge test`   | 17/17                        |
| `vitest`       | 18/18                        |
| `tsc --noEmit` | limpio                       |
| `next build`   | compila                      |
| `npm run sim`  | PASS en los 5 seeds probados |

## Lo siguiente, en orden

1. **Fondear el deployer.** `0xE99B67867E96833583ccadCFcF13499A10605544` en https://hskchain.net/faucet. Tiene captcha: lo tiene que hacer una persona.
2. **Desplegar.**
   ```bash
   cd contracts
   forge script script/Deploy.s.sol --rpc-url https://testnet.hsk.xyz --broadcast --private-key $DEPLOYER_PRIVATE_KEY
   ```
   Copiar las dos direcciones que imprime a `TREASURY_ADDRESS` y `TOKEN_ADDRESS` en el `.env` de la raíz, y reiniciar `npm run dev`.
3. **Probar el botón "Run it on chain"** del dashboard. Es el único camino que todavía no se ejecutó contra una cadena real — esperar fricción ahí (gas, nonces, timeouts del RPC).
4. **Deploy a Vercel.** Root directory `apps/web`. Las variables de `.env` van como env vars del proyecto.
5. **Video de 2–3 min** siguiendo el guion de la sección 7 de PLAN.md, y submission en Devfolio ("EAG Global Buildathon").

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
