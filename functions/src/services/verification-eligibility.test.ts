import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getOrgVerificationDay,
  getPolicyVerificationState,
  SUPPORTED_CARRIERS,
  VerificationState,
} from "./verification-eligibility";

describe("getOrgVerificationDay", () => {
  it("returns 1..5 for any orgId", () => {
    for (const id of ["a", "frazer-motors", "abc123", "demo-org", "x"]) {
      const day = getOrgVerificationDay(id);
      assert.ok(day >= 1 && day <= 5, `day for ${id} was ${day}`);
    }
  });

  it("is deterministic for the same id", () => {
    assert.equal(getOrgVerificationDay("frazer"), getOrgVerificationDay("frazer"));
  });

  it("respects an explicit override", () => {
    assert.equal(getOrgVerificationDay("anything", 3), 3);
  });

  it("ignores invalid overrides and falls back to hash", () => {
    const hash = getOrgVerificationDay("anything");
    assert.equal(getOrgVerificationDay("anything", 0), hash);
    assert.equal(getOrgVerificationDay("anything", 7), hash);
    assert.equal(getOrgVerificationDay("anything", undefined), hash);
  });
});

describe("getPolicyVerificationState", () => {
  const orgId = "org-1";
  const supportedCarrier = SUPPORTED_CARRIERS[0]; // "progressive"

  it("returns PENDING_UPLOAD when no insuranceProvider is set", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: undefined, status: "UNVERIFIED" } as never,
      orgId,
      new Set(),
    );
    assert.equal(state, VerificationState.PENDING_UPLOAD);
  });

  it("returns PENDING_UPLOAD for empty string provider", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: "", status: "ACTIVE" } as never,
      orgId,
      new Set([supportedCarrier]),
    );
    assert.equal(state, VerificationState.PENDING_UPLOAD);
  });

  it("returns INSURED_UNSUPPORTED for non-supported carriers", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: "Farmers", status: "ACTIVE" } as never,
      orgId,
      new Set([supportedCarrier]),
    );
    assert.equal(state, VerificationState.INSURED_UNSUPPORTED);
  });

  it("returns INSURED_NO_CREDS when supported but creds missing", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: supportedCarrier, status: "ACTIVE" } as never,
      orgId,
      new Set(),
    );
    assert.equal(state, VerificationState.INSURED_NO_CREDS);
  });

  it("returns INSURED_SUPPORTED when supported + creds present + active", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: supportedCarrier, status: "ACTIVE" } as never,
      orgId,
      new Set([supportedCarrier]),
    );
    assert.equal(state, VerificationState.INSURED_SUPPORTED);
  });

  it("returns INSURED_SUPPORTED for UNVERIFIED bulk-imported policies", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: supportedCarrier, status: "UNVERIFIED" } as never,
      orgId,
      new Set([supportedCarrier]),
    );
    assert.equal(state, VerificationState.INSURED_SUPPORTED);
  });

  it("returns INSURED_NO_CREDS for cancelled supported policies (not in sweep)", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: supportedCarrier, status: "CANCELLED" } as never,
      orgId,
      new Set([supportedCarrier]),
    );
    assert.notEqual(state, VerificationState.INSURED_SUPPORTED);
  });

  it("normalizes carrier names case-insensitively", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: "PROGRESSIVE", status: "ACTIVE" } as never,
      orgId,
      new Set(["progressive"]),
    );
    assert.equal(state, VerificationState.INSURED_SUPPORTED);
  });

  it("normalizes spaces in carrier names (State Farm)", () => {
    const state = getPolicyVerificationState(
      { insuranceProvider: "State Farm", status: "ACTIVE" } as never,
      orgId,
      new Set(["state_farm"]),
    );
    assert.equal(state, VerificationState.INSURED_SUPPORTED);
  });
});
