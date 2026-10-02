import type { RegistryHub } from '../../data/RegistryHub';
import type { RegistryEntry } from '../../entities/types';

/**
 * The reference tabs: bestiary, weapons, Signs, alchemy, conditions, and critical wounds.
 *
 * A read-only window onto the registry. It renders whatever content is registered, so a creature
 * or Sign added by a content pack appears here without touching this file.
 *
 * Extracted from the presentation bridge unchanged in what it shows; only its ownership and its
 * formatting moved.
 */

export interface RegistryPanelDeps {
  registry: RegistryHub;
  esc(value: unknown): string;
  byId(id: string): HTMLElement | null;
}

/** Writes every registry list and count into its container. */
export function renderRegistryViews(deps: RegistryPanelDeps): void {
  const { registry, esc } = deps;
  const write = (id: string, html: string): void => { const node = deps.byId(id); if (node) node.innerHTML = html; };
  const text = (id: string, value: string): void => { const node = deps.byId(id); if (node) node.textContent = value; };
  const rows = (items: Iterable<RegistryEntry>, row: (entry: RegistryEntry) => string): string =>
    [...items].map(entry => `<div class="registry-item">${row(entry)}</div>`).join('');

  text('bestCount', `${registry.bestiary.size} profiles`);
  text('weaponCount', `${registry.weapons.size} items`);
  text('signCount', `${registry.signs.size} Signs`);

  const bestiary = [...registry.bestiary.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  write('bestList', rows(bestiary, entry =>
    `<b>${esc(entry.name)}</b><small class="muted"> · ${esc(entry.family)} · ${esc(entry.source ?? '')}</small>`
    + `<div>${entry.hp ?? entry.maxHp} HP · ${entry.armor ?? 0} SP · ${entry.attacks?.length ?? 0} attacks</div>`));

  write('weaponList', rows(registry.weapons.values(), entry =>
    `<b>${esc(entry.name)}</b><div>${esc(entry.damage)} ${esc(entry.type)} · WA ${entry.wa ?? 0} · ${esc(String(entry.range))}</div>`
    + `<small class="muted">${esc((entry.effects ?? []).join(', '))}</small>`));

  write('signList', rows(registry.signs.values(), entry =>
    `<b>${esc(entry.name)}</b><small class="muted"> · ${esc(entry.element)}${entry.alternate ? ' · alternate' : ''}</small>`
    + `<div>${esc(entry.description)}</div>`));

  const alchemy = [...registry.alchemy.values()];
  write('potionList', rows(alchemy.filter(entry => entry.kind === 'potion' || entry.kind === 'decoction'), entry =>
    `<b>${esc(entry.name)}</b><div>${esc(entry.tox)} toxicity · ${esc(entry.duration)}</div><small>${esc(entry.desc)}</small>`));
  write('bombList', rows(alchemy.filter(entry => entry.kind === 'bomb'), entry =>
    `<b>${esc(entry.name)}</b><div>${esc(entry.damage ?? 'status')} · ${esc(entry.desc)}</div>`));
  write('oilList', rows(alchemy.filter(entry => entry.kind === 'oil'), entry =>
    `<b>${esc(entry.name)}</b><div>+${esc(entry.bonus)} damage when appropriate</div>`));

  write('conditionList', rows(registry.conditions.values(), entry =>
    `<b>${esc(entry.name)}</b><div>${esc(entry.description)}</div>`));

  write('criticalList', rows(registry.criticalWounds.values(), entry =>
    `<b>${esc(String(entry.tier).toUpperCase())} — ${esc(entry.name)}</b><div>${esc(entry.fresh)}</div>`
    + `<small class="muted">Stabilized: ${esc(entry.stabilized)} · Treated: ${esc(entry.treated)}</small>`));

  // Magic reference. Augments and focuses are new content, so they get their own list when the
  // page provides a container for them; the reference tabs work with or without it.
  write('augmentList', rows(registry.signAugments.values(), entry =>
    `<b>${esc(entry.name)}</b><small class="muted"> · +${esc(entry.staCost)} STA · ${esc(entry.ruleStatus)}</small>`
    + `<div>${esc(entry.description)}</div>`));
  write('focusList', rows(registry.focusItems.values(), entry =>
    `<b>${esc(entry.name)}</b><small class="muted"> · Focus ${esc(entry.value)}${entry.greater ? ' · Greater' : ''}</small>`
    + `<div>${esc(entry.description)}</div>`));
}
