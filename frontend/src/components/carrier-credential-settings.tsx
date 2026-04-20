"use client";

import { useEffect, useState } from "react";
import { KeyRound, Plus, Trash2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  callSaveCarrierCredential,
  callGetCarrierCredentials,
  callDeleteCarrierCredential,
} from "@/lib/api";
import type { CarrierCredentialMeta } from "@/lib/api";

const SUPPORTED_CARRIERS = [
  { id: "progressive", name: "Progressive (PROVE)" },
  { id: "state_farm", name: "State Farm (B2B)" },
  { id: "allstate", name: "Allstate (AXCIS)" },
];

interface CarrierCredentialSettingsProps {
  organizationId: string;
}

export function CarrierCredentialSettings({ organizationId }: CarrierCredentialSettingsProps) {
  const [credentials, setCredentials] = useState<CarrierCredentialMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [carrierId, setCarrierId] = useState("progressive");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadCredentials = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await callGetCarrierCredentials({ organizationId });
      setCredentials(res.data.credentials);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load credentials");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (organizationId) loadCredentials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const handleSave = async () => {
    if (!username.trim() || !password.trim()) {
      setError("Username and password are required");
      return;
    }

    const carrier = SUPPORTED_CARRIERS.find((c) => c.id === carrierId);
    if (!carrier) return;

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await callSaveCarrierCredential({
        organizationId,
        carrierId,
        carrierName: carrier.name,
        username: username.trim(),
        password,
      });
      setSuccess(`${carrier.name} credentials saved successfully`);
      setShowForm(false);
      setUsername("");
      setPassword("");
      setTimeout(() => setSuccess(null), 4000);
      await loadCredentials();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save credentials");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    setError(null);
    setSuccess(null);
    try {
      await callDeleteCarrierCredential({ organizationId, carrierId: id });
      setSuccess("Credentials removed");
      setTimeout(() => setSuccess(null), 3000);
      await loadCredentials();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete credentials");
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-card-bg border border-border-subtle rounded-xl p-8">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-carbon-light">Loading carrier credentials...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
            <KeyRound className="w-4.5 h-4.5 text-accent" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-offwhite">Carrier Credentials</h2>
            <p className="text-xs text-carbon-light">
              Manage login credentials for automated insurance verification portals
            </p>
          </div>
        </div>
        {!showForm && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Carrier
          </Button>
        )}
      </div>

      {/* Status messages */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-400" />
          <p className="text-sm text-green-400">{success}</p>
        </div>
      )}

      {/* Existing credentials list */}
      {credentials.length > 0 && (
        <div className="bg-card-bg border border-border-subtle rounded-xl divide-y divide-border-subtle">
          {credentials.map((cred) => (
            <div key={cred.carrierId} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-sm font-medium text-offwhite">{cred.carrierName}</p>
                <p className="text-xs text-carbon-light mt-0.5">
                  {cred.active ? "Active" : "Inactive"}
                  {cred.lastVerifiedAt && ` · Last verified ${new Date(cred.lastVerifiedAt).toLocaleDateString()}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${cred.active ? "bg-green-400" : "bg-carbon"}`} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(cred.carrierId)}
                  disabled={deleting === cred.carrierId}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  {deleting === cred.carrierId ? (
                    <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {credentials.length === 0 && !showForm && (
        <div className="bg-card-bg border border-border-subtle rounded-xl p-8 text-center">
          <KeyRound className="w-8 h-8 text-carbon mx-auto mb-3" />
          <p className="text-sm text-carbon-light">No carrier credentials configured yet.</p>
          <p className="text-xs text-carbon mt-1">Add credentials to enable automated verification.</p>
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <div className="bg-card-bg border border-border-subtle rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-offwhite">Add Carrier Credentials</h3>

          <div>
            <label className="block text-xs text-carbon-light mb-1.5">Carrier</label>
            <select
              value={carrierId}
              onChange={(e) => setCarrierId(e.target.value)}
              className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            >
              {SUPPORTED_CARRIERS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-carbon-light mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Portal username"
              autoComplete="off"
              className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
          </div>

          <div>
            <label className="block text-xs text-carbon-light mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Portal password"
              autoComplete="new-password"
              className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-sm text-offwhite placeholder:text-carbon focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !username.trim() || !password.trim()}
            >
              {saving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5" />
                  Encrypting & Saving...
                </>
              ) : (
                "Save Credentials"
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setUsername("");
                setPassword("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          <p className="text-xs text-carbon-light">
            Credentials are encrypted with AES-256-GCM before storage. They are never stored in plaintext.
          </p>
        </div>
      )}
    </div>
  );
}
