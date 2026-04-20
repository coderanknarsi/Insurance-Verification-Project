"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { getClientAuth } from "@/lib/firebase";
import { getClientFunctions } from "@/lib/firebase";

interface UserProfile {
  organizationId: string;
  role: string;
  email: string;
  displayName: string;
}

const PENDING_ORGANIZATION_NAME_KEY = "pendingOrganizationName";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  organizationId: string | null;
  role: string | null;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  organizationId: null,
  role: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getClientAuth(), async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          // Check for invite token in URL
          const params = new URLSearchParams(window.location.search);
          const inviteToken = params.get("invite") ?? undefined;
          const organizationName = sessionStorage.getItem(PENDING_ORGANIZATION_NAME_KEY) ?? undefined;

          const getUserProfile = httpsCallable<{ inviteToken?: string; organizationName?: string }, UserProfile>(
            getClientFunctions(),
            "getUserProfile"
          );
          const result = await getUserProfile({ inviteToken, organizationName });
          setOrganizationId(result.data.organizationId);
          setRole(result.data.role);

          if (organizationName) {
            sessionStorage.removeItem(PENDING_ORGANIZATION_NAME_KEY);
          }

          // Clean invite token from URL after use
          if (inviteToken) {
            const url = new URL(window.location.href);
            url.searchParams.delete("invite");
            window.history.replaceState({}, "", url.toString());
          }
        } catch {
          sessionStorage.removeItem(PENDING_ORGANIZATION_NAME_KEY);
          setOrganizationId(null);
          setRole(null);
        }
      } else {
        setOrganizationId(null);
        setRole(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, organizationId, role }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
