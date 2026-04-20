/** Types for the AI agent observe → reason → act loop */

export type ActionType =
  | "CLICK"
  | "TYPE"
  | "SELECT"
  | "WAIT"
  | "PRESS_KEY"
  | "SCROLL"
  | "EXTRACT"
  | "DONE"
  | "CAPTCHA_DETECTED"
  | "FETCH_MFA_CODE"
  | "ERROR";

export interface AgentAction {
  type: ActionType;
  /** CSS selector or element ID to target */
  selector?: string;
  /** Text to type (for TYPE action) */
  text?: string;
  /** Option value to select (for SELECT action) */
  value?: string;
  /** Key to press (for PRESS_KEY action — e.g. "Enter", "Tab") */
  key?: string;
  /** Direction for SCROLL */
  direction?: "up" | "down";
  /** Amount in pixels for SCROLL */
  amount?: number;
  /** Wait duration in ms */
  waitMs?: number;
  /** Extracted data (for DONE action) */
  data?: Record<string, unknown>;
  /** Reasoning for why this action was chosen */
  reasoning?: string;
  /** Error message (for ERROR action) */
  errorMessage?: string;
  /** Carrier ID for FETCH_MFA_CODE action */
  carrierId?: string;
}

export interface PageElement {
  /** Index in the element list (used as reference in actions) */
  index: number;
  /** Tag name */
  tag: string;
  /** CSS selector */
  selector: string;
  /** Visible text content (truncated) */
  text: string;
  /** Element type attribute (for inputs) */
  inputType?: string;
  /** Placeholder text */
  placeholder?: string;
  /** aria-label */
  ariaLabel?: string;
  /** Current value (for inputs/selects) */
  currentValue?: string;
  /** Whether the element is visible on screen */
  isVisible: boolean;
}

export interface AgentObservation {
  /** JPEG screenshot encoded as base64 */
  screenshotBase64: string;
  /** Page URL */
  url: string;
  /** Page title */
  title: string;
  /** Interactive elements visible on the page */
  elements: PageElement[];
}

export interface AgentTask {
  /** Human-readable description of what the agent should accomplish */
  goal: string;
  /** Carrier-specific context and hints */
  context?: string;
  /** Fields to extract when done */
  extractionSchema?: Record<string, string>;
}

export interface AgentStep {
  stepNumber: number;
  observation: { url: string; title: string; elementCount: number };
  action: AgentAction;
  durationMs: number;
}
