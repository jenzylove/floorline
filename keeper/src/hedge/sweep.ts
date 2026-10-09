/**
 * Operator sweep. In "api" mode the hedge runs from the operator's own Perpl account (registered with
 * Perpl under the operator's builder code), not from the vault. To keep depositors whole, each hedge
 * cycle is closed with a sweep: if the hedge made money over the cycle, that profit is owed to the
 * vault and is sent to it as a public AUSD transfer. If it lost, the operator absorbs the loss.
 *
 * A cycle starts when the vault first has exposure to hedge, and ends when exposure is back to zero
 * and the short is fully closed. Hedge profit is the change in the account's equity over the cycle,
 * so fees and funding are included. Deposits into or withdrawals from the account during a cycle
 * would distort it, so the ledger records the equity it saw at both ends for anyone to check.
 */
export interface SweepDue {
  startedAt: string;
  endedAt: string;
  equityStart: number; // AUSD
  equityEnd: number; // AUSD
  hedgePnl: number; // AUSD, end - start
  owedToVault: number; // max(hedgePnl, 0)
}

export class CycleLedger {
  private start?: { at: string; equity: number };

  get open(): boolean {
    return this.start !== undefined;
  }

  /** Feed one observation per loop. Returns a sweep when a cycle ends. */
  observe(targetUnits: number, currentLots: number, equity: number, now = new Date()): SweepDue | undefined {
    if (!Number.isFinite(equity)) return undefined;
    if (!this.start) {
      if (targetUnits > 0 || currentLots > 0) this.start = { at: now.toISOString(), equity };
      return undefined;
    }
    if (targetUnits === 0 && currentLots === 0) {
      const s = this.start;
      this.start = undefined;
      const hedgePnl = round6(equity - s.equity);
      return {
        startedAt: s.at,
        endedAt: now.toISOString(),
        equityStart: s.equity,
        equityEnd: equity,
        hedgePnl,
        owedToVault: Math.max(0, hedgePnl),
      };
    }
    return undefined;
  }
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
