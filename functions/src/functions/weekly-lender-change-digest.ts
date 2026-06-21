import { onSchedule } from "firebase-functions/v2/scheduler";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { collections } from "../config/firestore";
import {
  sendLenderChangeDigestEmail,
  type LenderChangeDigestRow,
} from "../services/lender-email";
import type { ChangeSeverity } from "../types/policy-change";
import { DEMO_ORG_ID } from "../constants";

const SEVERITY_RANK: Record<ChangeSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

/**
 * Weekly lender digest of policy changes. Every Monday 07:30 America/Chicago,
 * rolls up the past 7 days of `policyChanges` per org and emails each org's
 * admin a single summary. Best-effort: a failure for one org never blocks the
 * others. Demo org is skipped.
 */
export const weeklyLenderChangeDigest = onSchedule(
  {
    schedule: "30 7 * * 1",
    timeZone: "America/Chicago",
    region: "us-central1",
    memory: "256MiB",
    retryCount: 1,
  },
  async () => {
    const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const since = Timestamp.fromMillis(sinceMs);

    const snap = await collections.policyChanges
      .where("createdAt", ">=", since)
      .get();

    // Group changes by org.
    const byOrg = new Map<string, LenderChangeDigestRow[]>();
    const borrowerNameCache = new Map<string, string>();

    for (const doc of snap.docs) {
      const c = doc.data() as {
        organizationId?: string;
        borrowerId?: string;
        severity?: ChangeSeverity;
        summary?: string;
        createdAt?: Timestamp;
      };
      const orgId = c.organizationId;
      if (!orgId || orgId === DEMO_ORG_ID) continue;

      let borrowerName = "A borrower";
      const borrowerId = c.borrowerId;
      if (borrowerId) {
        if (borrowerNameCache.has(borrowerId)) {
          borrowerName = borrowerNameCache.get(borrowerId)!;
        } else {
          try {
            const bSnap = await collections.borrowers.doc(borrowerId).get();
            const b = bSnap.data();
            if (b) {
              borrowerName =
                `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim() || borrowerName;
            }
          } catch {
            // best-effort
          }
          borrowerNameCache.set(borrowerId, borrowerName);
        }
      }

      const detectedAt = c.createdAt
        ? c.createdAt.toDate().toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : "";

      const row: LenderChangeDigestRow = {
        borrowerName,
        summary: c.summary ?? "Coverage change detected",
        severity: c.severity ?? "info",
        detectedAt,
      };
      const list = byOrg.get(orgId) ?? [];
      list.push(row);
      byOrg.set(orgId, list);
    }

    let sent = 0;
    for (const [orgId, rows] of byOrg) {
      // Most severe / most recent first.
      rows.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
      const ok = await sendLenderChangeDigestEmail(orgId, rows);
      if (ok) sent += 1;
    }

    logger.info("weekly lender change digest complete", {
      orgsWithChanges: byOrg.size,
      emailsSent: sent,
    });
  },
);
