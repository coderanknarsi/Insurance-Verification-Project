import type { CarrierAdapter } from "./types";
import { stateFarmAdapter } from "./state-farm/adapter";
import { progressiveAdapter } from "./progressive/adapter";
import { allstateAdapter } from "./allstate/adapter";
import { nationalGeneralAdapter } from "./national-general/adapter";
import { geicoAdapter } from "./geico/adapter";
import { nationwideAdapter } from "./nationwide/adapter";

const adapters: Record<string, CarrierAdapter> = {
  [stateFarmAdapter.id]: stateFarmAdapter,
  [progressiveAdapter.id]: progressiveAdapter,
  [allstateAdapter.id]: allstateAdapter,
  [nationalGeneralAdapter.id]: nationalGeneralAdapter,
  [geicoAdapter.id]: geicoAdapter,
  [nationwideAdapter.id]: nationwideAdapter,
};

/**
 * Resolve a carrier adapter by id. The backend uses underscore-canonical ids
 * (e.g. `state_farm`) while operator adapters are keyed with hyphens
 * (e.g. `state-farm`), so we normalize separators before lookup.
 */
export function getCarrierAdapter(id: string): CarrierAdapter | undefined {
  if (adapters[id]) return adapters[id];
  const normalized = id.replace(/_/g, "-");
  return adapters[normalized];
}

export function listCarrierAdapters(): CarrierAdapter[] {
  return Object.values(adapters);
}

/**
 * Adapters that are actually implemented and safe to drive. The operator only
 * monitors and offers login for these; stub adapters are excluded so they
 * don't generate failing heartbeats or login attempts.
 */
export function listReadyCarrierAdapters(): CarrierAdapter[] {
  return Object.values(adapters).filter((a) => a.ready === true);
}
