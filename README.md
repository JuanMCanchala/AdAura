# Darwin Agents

**Una economía de agentes de marketing autónomos donde el presupuesto lo custodia Ethereum y la estrategia la encuentra la selección natural.**

Ethereum Builders Tour — Cali, Colombia · 19–20 sep 2026
Tracks: _AI x Ethereum & Agent Economy_ (EAG) · _AI Agents_ / _AI × Web3_ (HashKey Chain)

---

## El problema

Cuando alguien quiere vender algo, tiene que adivinar la estrategia de marketing: plataforma, público, tono, formato, llamada a la acción. Esa adivinanza cuesta dinero y casi nunca se mide bien.

## Qué hace este proyecto

El usuario carga un producto y un presupuesto. El sistema crea una **población de agentes autónomos**, cada uno con:

- una **estrategia distinta** (su genoma: plataforma, público, formato, tono, CTA, agresividad de puja, frecuencia),
- una **wallet propia** en Ethereum,
- un **presupuesto acotado por contrato**.

Los agentes gastan para conseguir conversiones. Cada cierto número de ciclos:

- los que pierden plata **se apagan**,
- los rentables **se reproducen** con una mutación pequeña y observable,
- el hijo hereda parte del presupuesto no gastado del padre.

Nadie le dice al sistema qué funciona. Lo descubre pagando por equivocarse unas cuantas veces.

## Por qué Ethereum, y no una base de datos

El presupuesto de un agente **no es un número en un prompt**. Es una variable de estado, y pasarse hace que la transacción **revierta**.

`AgentTreasury.spend()` comprueba cuatro techos independientes antes de mover un solo token:

| Techo         | Qué impide                                                     |
| ------------- | -------------------------------------------------------------- |
| `allowance`   | Que un agente gaste más de lo que se le asignó en toda su vida |
| `epochCap`    | Que queme todo su presupuesto en un día                        |
| `globalCap`   | Que la población entera pase del límite de la campaña          |
| liquidez real | Que se prometa dinero que la tesorería no tiene                |

Además, el **árbol evolutivo completo se reconstruye solo con los eventos** `AgentRegistered` y `AgentReproduced`, que llevan el padre y el hash del genoma. Un indexador no necesita confiar en nuestra base de datos.

El humano conserva siempre el interruptor: `setPaused()` congela a toda la población y `withdraw()` recupera lo que los agentes no quemaron.

## Estado

| Componente | Estado |
| --- | --- |
| `AgentTreasury.sol` + `MockUSD.sol` | listo — 17/17 tests |
| Motor evolutivo (genoma, mercado, selección) | listo — 18/18 tests, converge en 5 seeds |
| Dashboard, wizard y storefront | listo |
| Integración on-chain (wallet por agente) | código listo, falta desplegar |
| Pagos agente→servicio vía x402 / MPP | código listo, falta probar contra la testnet |

Plan completo y ruta pendiente en [docs/PLAN.md](docs/PLAN.md). Para retomar desde otra sesión, [docs/HANDOFF.md](docs/HANDOFF.md).

## Cómo correrlo

```bash
npm install

# contratos
npm run contracts:test        # forge test

# el motor, sin cadena ni UI
npm run sim                   # 25 generaciones, compara contra el óptimo global

# la app
npm run dev                   # http://localhost:3000
```

### La verificación que importa

`npm run sim` corre la evolución en seco y luego **calcula por fuerza bruta el óptimo global** sobre las 40.500 estrategias posibles, para comparar contra lo que la población encontró sola. Si la población no mejora, el script falla con código 1. El proyecto se niega a fingir que funciona.

## Redes

| Red                   | chainId  | RPC                       | Explorer                               |
| --------------------- | -------- | ------------------------- | -------------------------------------- |
| HashKey Chain Testnet | 133      | `https://testnet.hsk.xyz` | https://testnet-explorer.hskchain.net/ |
| Ethereum Sepolia      | 11155111 | —                         | —                                      |

No se usa dinero real. `MockUSD` es un ERC20 de prueba con faucet abierto.

## Arquitectura

```
contracts/        Foundry — AgentTreasury (custodia, límites, linaje) + MockUSD
apps/web/
  lib/genome.ts     el espacio de estrategias (40.500 combinaciones)
  lib/market.ts     simulador con verdad latente oculta, derivada del producto
  lib/evolution.ts  fitness, selección, mutación, reproducción, inmigración
  lib/engine.ts     el bucle: un tick = un día de mercado
  scripts/sim.ts    verificación headless
```

## Licencia

MIT
