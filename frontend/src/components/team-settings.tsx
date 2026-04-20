"use client";

import { useEffect, useState } from "react";
import { Users, UserPlus, Mail, Shield, Eye, Trash2, X, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  callGetTeamMembers,
  callInviteTeamMember,
  callRevokeInvite,
  callRemoveTeamMember,
  type TeamMember,
  type TeamInvite,
} from "@/lib/api";

interface TeamSettingsProps {
  organizationId: string;
  currentUserRole: string | null;
}

const roleLabels: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  ADMIN: { label: "Admin", color: "text-blue-400 bg-blue-500/10 border-blue-500/20", icon: Shield },
  MANAGER: { label: "Manager", color: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: Shield },
  VIEWER: { label: "Viewer", color: "text-carbon-light bg-surface border-border-subtle", icon: Eye },
};

export function TeamSettings({ organizationId, currentUserRole }: TeamSettingsProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("MANAGER");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isAdmin = currentUserRole === "ADMIN";

  const loadTeam = async () => {
    try {
      const result = await callGetTeamMembers({ organizationId });
      setMembers(result.data.members);
      setInvites(result.data.invites);
    } catch {
      setError("Failed to load team members.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTeam();
  }, [organizationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await callInviteTeamMember({
        organizationId,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setSuccessMsg(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
      setShowInviteDialog(false);
      await loadTeam();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send invite.";
      setError(msg);
    } finally {
      setInviting(false);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    setError(null);
    try {
      await callRevokeInvite({ organizationId, inviteId });
      await loadTeam();
    } catch {
      setError("Failed to revoke invite.");
    }
  };

  const handleRemove = async (userId: string, email: string) => {
    if (!confirm(`Remove ${email} from your organization? They will lose access immediately.`)) {
      return;
    }
    setError(null);
    try {
      await callRemoveTeamMember({ organizationId, userId });
      await loadTeam();
    } catch {
      setError("Failed to remove team member.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-accent-blue animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-blue/10 border border-accent-blue/20 flex items-center justify-center">
            <Users className="w-5 h-5 text-accent-blue" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-offwhite">Team Members</h2>
            <p className="text-sm text-carbon-light">
              {members.length} member{members.length !== 1 ? "s" : ""}
              {invites.length > 0 && ` · ${invites.length} pending`}
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button
            onClick={() => setShowInviteDialog(true)}
            className="bg-accent-blue hover:bg-accent-blue/90 text-white gap-2"
          >
            <UserPlus className="w-4 h-4" />
            Invite Member
          </Button>
        )}
      </div>

      {/* Status Messages */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
          {successMsg}
        </div>
      )}

      {/* Members List */}
      <div className="bg-card-bg border border-border-subtle rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-subtle">
          <p className="text-xs font-semibold text-carbon-light uppercase tracking-wider">Active Members</p>
        </div>
        <div className="divide-y divide-border-subtle">
          {members.map((member) => {
            const roleMeta = roleLabels[member.role] ?? roleLabels.VIEWER;
            return (
              <div key={member.id} className="flex items-center justify-between px-4 py-3 hover:bg-surface/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-surface border border-border-subtle flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-offwhite">
                      {(member.displayName || member.email)[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-offwhite truncate">
                      {member.displayName || member.email}
                    </p>
                    <p className="text-xs text-carbon-light truncate">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${roleMeta.color}`}>
                    {roleMeta.label}
                  </span>
                  {isAdmin && member.role !== "ADMIN" && (
                    <button
                      onClick={() => handleRemove(member.id, member.email)}
                      className="p-1.5 rounded-lg text-carbon-light hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Remove member"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending Invites */}
      {invites.length > 0 && (
        <div className="bg-card-bg border border-border-subtle rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <p className="text-xs font-semibold text-carbon-light uppercase tracking-wider">Pending Invitations</p>
          </div>
          <div className="divide-y divide-border-subtle">
            {invites.map((invite) => {
              const roleMeta = roleLabels[invite.role] ?? roleLabels.VIEWER;
              const daysLeft = Math.ceil((invite.expiresAt - Date.now()) / (1000 * 60 * 60 * 24));
              return (
                <div key={invite.id} className="flex items-center justify-between px-4 py-3 hover:bg-surface/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                      <Mail className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-offwhite truncate">{invite.email}</p>
                      <p className="text-xs text-carbon-light flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Expires in {daysLeft} day{daysLeft !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${roleMeta.color}`}>
                      {roleMeta.label}
                    </span>
                    {isAdmin && (
                      <button
                        onClick={() => handleRevoke(invite.id)}
                        className="p-1.5 rounded-lg text-carbon-light hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Revoke invite"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Invite Dialog */}
      {showInviteDialog && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowInviteDialog(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-card-bg border border-border-subtle rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-accent-blue" />
                  <h3 className="text-base font-semibold text-offwhite">Invite Team Member</h3>
                </div>
                <button onClick={() => setShowInviteDialog(false)} className="p-1 rounded-lg text-carbon-light hover:text-offwhite transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleInvite} className="p-6 space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm text-offwhite">Email Address</Label>
                  <Input
                    type="email"
                    required
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="bg-surface border-border-subtle text-offwhite placeholder:text-carbon-light"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-offwhite">Role</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setInviteRole("MANAGER")}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                        inviteRole === "MANAGER"
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                          : "border-border-subtle bg-surface text-carbon-light hover:border-border-subtle/80"
                      }`}
                    >
                      <Shield className="w-5 h-5" />
                      <span className="text-xs font-medium">Manager</span>
                      <span className="text-[10px] opacity-70">Full borrower access</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setInviteRole("VIEWER")}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                        inviteRole === "VIEWER"
                          ? "border-gray-400/40 bg-gray-500/10 text-gray-300"
                          : "border-border-subtle bg-surface text-carbon-light hover:border-border-subtle/80"
                      }`}
                    >
                      <Eye className="w-5 h-5" />
                      <span className="text-xs font-medium">Viewer</span>
                      <span className="text-[10px] opacity-70">Read-only dashboard</span>
                    </button>
                  </div>
                </div>

                <p className="text-xs text-carbon-light leading-relaxed">
                  An email invitation will be sent with a link to join your organization.
                  The invite expires in 7 days.
                </p>

                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowInviteDialog(false)}
                    className="flex-1 border-border-subtle text-carbon-light hover:text-offwhite"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={inviting || !inviteEmail.trim()}
                    className="flex-1 bg-accent-blue hover:bg-accent-blue/90 text-white gap-2"
                  >
                    {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    Send Invite
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
