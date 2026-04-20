import type { CarrierModule } from "./types.js";
import { ProgressiveModule } from "./progressive/module.js";
import { NationalGeneralModule } from "./national-general/module.js";
import { StateFarmModule } from "./state-farm/module.js";
import { AllstateModule } from "./allstate/module.js";

/** Registry of all available carrier modules */
const modules: Map<string, CarrierModule> = new Map();

function register(mod: CarrierModule): void {
  modules.set(mod.carrierId, mod);
}

// Register all carrier modules
register(new ProgressiveModule());
register(new NationalGeneralModule());
register(new StateFarmModule());
register(new AllstateModule());

/**
 * Look up a carrier module by name.
 * Handles common name variants (case-insensitive, with/without spaces).
 */
export function getCarrierModule(carrierName: string): CarrierModule | null {
  const normalized = carrierName.toLowerCase().trim().replace(/\s+/g, "_");

  // Direct match on carrierId
  if (modules.has(normalized)) {
    return modules.get(normalized)!;
  }

  // Try matching on display name
  for (const mod of modules.values()) {
    if (mod.carrierName.toLowerCase() === carrierName.toLowerCase().trim()) {
      return mod;
    }
  }

  return null;
}

/** Returns all registered carrier IDs */
export function listCarrierIds(): string[] {
  return Array.from(modules.keys());
}
