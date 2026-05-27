// Firebase Auth for the operator app.
// Phase 1: implement email/password sign-in using firebase/auth, persist
// the refresh token in Windows Credential Manager via keytar so the user
// only signs in once per machine.

import { logger } from "../shared/logger";

export interface OperatorSession {
  uid: string;
  email: string;
  idToken: string;
}

export async function getCurrentSession(): Promise<OperatorSession | null> {
  logger.debug("getCurrentSession not implemented (Phase 1)");
  return null;
}

export async function signInWithEmailPassword(
  _email: string,
  _password: string,
): Promise<OperatorSession> {
  throw new Error("signInWithEmailPassword not implemented (Phase 1)");
}

export async function signOut(): Promise<void> {
  logger.debug("signOut not implemented (Phase 1)");
}
