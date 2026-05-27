import type { AiAction } from "../carriers/types";
import { logger } from "../shared/logger";

/**
 * AI vision fallback (Phase 6). Hard-capped to a few actions per VIN to keep
 * scope bounded and surface oddities for human review.
 *
 * Disabled by default — set OPERATOR_AI_ASSIST=1 to enable. The implementation
 * is a stub today: it returns a "pause-for-human" action which causes the
 * adapter to escalate to human review. Wiring a real Gemini/Claude call lives
 * here in a future iteration.
 */
export class AiAssistant {
  private readonly maxActionsPerVin: number;
  private actionsThisVin = 0;

  constructor() {
    this.maxActionsPerVin = Number(process.env.OPERATOR_AI_MAX_ACTIONS ?? 3);
  }

  isEnabled(): boolean {
    return process.env.OPERATOR_AI_ASSIST === "1";
  }

  resetForVin(): void {
    this.actionsThisVin = 0;
  }

  async suggest(prompt: string): Promise<AiAction> {
    if (!this.isEnabled()) {
      return { action: "pause-for-human", reason: "AI assist disabled" };
    }
    if (this.actionsThisVin >= this.maxActionsPerVin) {
      return {
        action: "pause-for-human",
        reason: `AI action cap reached (${this.maxActionsPerVin})`,
      };
    }
    this.actionsThisVin += 1;
    logger.info(`[ai-assist] prompt: ${prompt.slice(0, 200)}`);
    // TODO Phase 6.1: call Gemini/Claude with tool schema. For now, pause.
    return {
      action: "pause-for-human",
      reason: "AI assist stub — implement model call in Phase 6.1",
    };
  }
}
