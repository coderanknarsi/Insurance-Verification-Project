import { onCall, HttpsError } from "firebase-functions/v2/https";
import { collections } from "../config/firestore";
import { db } from "../config/firebase";
import { requireAuth, requireOrg } from "../middleware/auth";
import {
  getOrgVerificationDay,
  getPolicyVerificationState,
  VerificationState,
} from "../services/verification-eligibility";

interface GetOrgVerificationStatusInput {
  organizationId: string;
}

interface GetOrgVerificationStatusResponse {
  /** Assigned weekday (1=Mon … 5=Fri). */
  verificationDayOfWeek: 1 | 2 | 3 | 4 | 5;
  /** True if user explicitly set this day. */
  isOverride: boolean;
  /** Epoch ms of the next assigned-weekday-7am-CT slot. */
  nextSweepAt: number;
  /** Epoch ms of the most recent completed sweep for this org, or null. */
  lastSweepAt: number | null;
  inScopeCounts: {
    pendingUpload: number;
    insuredSupported: number;
    insuredUnsupported: number;
    insuredNoCreds: number;
  };
}

/**
 * Returns dashboard-level verification metadata: which weekday is this org's
 * sweep day, when the last sweep ran, when the next will run, and counts
 * across the four lifecycle states.
 */
export const getOrgVerificationStatus = onCall(
  { region: "us-central1" },
  async (request): Promise<GetOrgVerificationStatusResponse> => {
    const { user } = await requireAuth(request);
    const data = request.data as GetOrgVerificationStatusInput | undefined;
    if (!data?.organizationId) {
      throw new HttpsError("invalid-argument", "organizationId is required");
    }
    requireOrg(user, data.organizationId);

    const orgDoc = await db
      .collection("organizations")
      .doc(data.organizationId)
      .get();
    if (!orgDoc.exists) {
      throw new HttpsError("not-found", "Organization not found");
    }
    const orgData = orgDoc.data()!;
    const override = orgData.settings?.verificationDayOfWeek;
    const day = getOrgVerificationDay(data.organizationId, override);
    const isOverride = typeof override === "number";

    const credsSnap = await db
      .collection("organizations")
      .doc(data.organizationId)
      .collection("carrierCredentials")
      .where("active", "==", true)
      .get();
    const activeCarriers = new Set(credsSnap.docs.map((d) => d.id));

    const policiesSnap = await collections.policies
      .where("organizationId", "==", data.organizationId)
      .get();

    const counts = {
      pendingUpload: 0,
      insuredSupported: 0,
      insuredUnsupported: 0,
      insuredNoCreds: 0,
    };
    for (const policyDoc of policiesSnap.docs) {
      const state = getPolicyVerificationState(
        policyDoc.data() as never,
        data.organizationId,
        activeCarriers,
      );
      switch (state) {
        case VerificationState.PENDING_UPLOAD:
          counts.pendingUpload++;
          break;
        case VerificationState.INSURED_SUPPORTED:
          counts.insuredSupported++;
          break;
        case VerificationState.INSURED_UNSUPPORTED:
          counts.insuredUnsupported++;
          break;
        case VerificationState.INSURED_NO_CREDS:
          counts.insuredNoCreds++;
          break;
      }
    }

    // Last completed sweep that included this org.
    const lastRunSnap = await db
      .collection("dataFeedRuns")
      .where("orgsProcessed", "array-contains", data.organizationId)
      .orderBy("completedAt", "desc")
      .limit(1)
      .get();
    const lastSweepAt = lastRunSnap.empty
      ? null
      : lastRunSnap.docs[0].data().completedAt?.toMillis?.() ?? null;

    return {
      verificationDayOfWeek: day,
      isOverride,
      nextSweepAt: nextSweepAtMs(day),
      lastSweepAt,
      inScopeCounts: counts,
    };
  },
);

/**
 * Compute the next 7am America/Chicago slot for the given weekday (1..5).
 * Returns epoch ms.
 */
function nextSweepAtMs(targetWeekday: 1 | 2 | 3 | 4 | 5): number {
  // We compute by walking forward from "now" up to 7 days, asking for the
  // weekday + hour in America/Chicago. As soon as we find a day matching
  // targetWeekday whose 7am-CT instant is in the future, return it.
  const now = new Date();
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(candidate).map((p) => [p.type, p.value]),
    );
    const weekdayMap: Record<string, number> = {
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
    };
    const weekdayNum = weekdayMap[parts.weekday];
    if (weekdayNum !== targetWeekday) continue;

    // Build a 7am-CT instant for this calendar date.
    // Chicago is UTC-6 (CST) or UTC-5 (CDT). Use Intl to figure offset.
    const ymd = `${parts.year}-${parts.month}-${parts.day}`;
    const naiveCT = new Date(`${ymd}T07:00:00`); // local-time of server
    const ctTime = computeChicagoInstant(parts.year, parts.month, parts.day, 7);
    void naiveCT;
    if (ctTime > now.getTime()) return ctTime;
  }
  // Fallback — shouldn't happen, but return a week from now.
  return now.getTime() + 7 * 24 * 60 * 60 * 1000;
}

/** Returns epoch ms of {y}-{m}-{d}T{h}:00 in America/Chicago. */
function computeChicagoInstant(
  y: string,
  m: string,
  d: string,
  hour: number,
): number {
  // Construct the wall-clock timestamp as if it were UTC, then subtract the
  // current Chicago UTC offset for that date.
  const utcAsIfChicago = Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    hour,
    0,
    0,
  );
  // Find Chicago offset on that date by formatting the instant.
  const probe = new Date(utcAsIfChicago);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "shortOffset",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(probe);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-6";
  // Parse "GMT-5" or "GMT-6" → numeric hours
  const m2 = /GMT([+-]\d+)/.exec(offsetPart);
  const offsetHours = m2 ? Number(m2[1]) : -6;
  return utcAsIfChicago - offsetHours * 60 * 60 * 1000;
}
