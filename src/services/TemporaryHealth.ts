import type { IActor } from '../entities/types';

/**
 * Temporary maximum-Health bonuses.
 *
 * A bonus is recorded against the source that granted it, so it can be removed *exactly* — the
 * problem with writing straight into `maxHp` is that nothing knows how much to give back, so the
 * increase becomes permanent and re-application stacks forever.
 *
 * `maxHp` still stores the *effective* maximum, because simulation state is plain data that is
 * structured-cloned at every transaction boundary and read as `actor.maxHp` throughout; a derived
 * accessor would not survive cloning. The base value is recoverable at any time via
 * {@link baseMaxHealth}, and revoking restores it precisely.
 *
 * This mechanism is generic. Its first user is the Full Moon potion: +30 temporary Health that
 * lasts as long as the potion does, and extra doses of it do not accumulate.
 */

/** Active bonuses keyed by the id of whatever granted them. */
export type TemporaryHealthLedger = Record<string, number>;

function ledger(actor: IActor): TemporaryHealthLedger {
  const existing = actor.temporaryMaxHp;
  if (existing && typeof existing === 'object') return existing as TemporaryHealthLedger;
  const created: TemporaryHealthLedger = {};
  actor.temporaryMaxHp = created;
  return created;
}

/** Active temporary maximum-Health bonuses, by source id. */
export function activeBonuses(actor: IActor): Readonly<TemporaryHealthLedger> {
  return (actor.temporaryMaxHp as TemporaryHealthLedger | undefined) ?? {};
}

/** True when this source currently grants a bonus. */
export function hasBonus(actor: IActor, sourceId: string): boolean {
  return (activeBonuses(actor)[sourceId] ?? 0) !== 0;
}

/** Sum of every active temporary maximum-Health bonus. */
export function bonusTotal(actor: IActor): number {
  return Object.values(activeBonuses(actor)).reduce((sum, amount) => sum + (Number(amount) || 0), 0);
}

/** Maximum Health with all temporary bonuses removed. */
export function baseMaxHealth(actor: IActor): number {
  return actor.maxHp - bonusTotal(actor);
}

/**
 * Grants a temporary maximum-Health bonus and raises current Health by the same amount.
 *
 * Bonuses from one source do not stack: granting again while the source is already active is a
 * no-op and returns `false`, so callers can refresh a duration without doubling the bonus.
 */
export function grant(actor: IActor, sourceId: string, amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const rows = ledger(actor);
  if ((rows[sourceId] ?? 0) !== 0) return false;
  rows[sourceId] = amount;
  actor.maxHp += amount;
  actor.hp += amount;
  return true;
}

/**
 * Removes one source's bonus and clamps current Health to the reduced maximum.
 * Health already below the base maximum is left alone, so expiry cannot heal.
 */
export function revoke(actor: IActor, sourceId: string): boolean {
  const rows = ledger(actor);
  const amount = rows[sourceId];
  if (!amount) return false;
  delete rows[sourceId];
  actor.maxHp -= amount;
  if (actor.hp > actor.maxHp) actor.hp = actor.maxHp;
  return true;
}

/** Removes every temporary maximum-Health bonus, e.g. when White Honey clears potion effects. */
export function revokeAll(actor: IActor): void {
  for (const sourceId of Object.keys(activeBonuses(actor))) revoke(actor, sourceId);
}
