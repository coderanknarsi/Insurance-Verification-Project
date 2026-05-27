import type { CarrierAdapter } from "./types";
import { stateFarmAdapter } from "./state-farm/adapter";

const adapters: Record<string, CarrierAdapter> = {
  [stateFarmAdapter.id]: stateFarmAdapter,
};

export function getCarrierAdapter(id: string): CarrierAdapter | undefined {
  return adapters[id];
}

export function listCarrierAdapters(): CarrierAdapter[] {
  return Object.values(adapters);
}
