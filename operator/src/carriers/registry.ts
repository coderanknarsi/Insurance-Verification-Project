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

export function getCarrierAdapter(id: string): CarrierAdapter | undefined {
  return adapters[id];
}

export function listCarrierAdapters(): CarrierAdapter[] {
  return Object.values(adapters);
}
