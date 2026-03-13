"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { callCreateVerificationRequest } from "@/lib/api";

interface VerifyNowDialogProps {
  organizationId: string;
  borrowerId: string;
  vehicleId: string;
  borrowerName: string;
  vehicleLabel: string;
}

type WidgetState = "idle" | "loading" | "ready" | "completed" | "error";

export function VerifyNowDialog({
  organizationId,
  borrowerId,
  vehicleId,
  borrowerName,
  vehicleLabel,
}: VerifyNowDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<WidgetState>("idle");
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(async () => {
    setOpen(true);
    setState("loading");
    setError(null);

    try {
      const response = await callCreateVerificationRequest({
        organizationId,
        borrowerId,
        vehicleId,
      });
      setInvitationUrl(response.data.invitationUrl);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create verification request.");
      setState("error");
    }
  }, [organizationId, borrowerId, vehicleId]);

  const handleClose = () => {
    setOpen(false);
    setState("idle");
    setInvitationUrl(null);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? handleOpen() : handleClose())}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-accent hover:bg-accent-hover text-white">Verify Now</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl bg-card-bg border-border-subtle text-offwhite">
        <DialogHeader>
          <DialogTitle className="text-offwhite">Insurance Verification</DialogTitle>
          <DialogDescription className="text-carbon-light">
            Verify insurance for {borrowerName} — {vehicleLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[400px]">
          {state === "loading" && (
            <div className="flex h-[400px] items-center justify-center">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <p className="text-carbon-light">Preparing verification...</p>
              </div>
            </div>
          )}

          {state === "error" && (
            <div className="flex h-[400px] flex-col items-center justify-center gap-4">
              <p className="text-red-400">{error}</p>
              <Button variant="outline" onClick={handleOpen} className="border-border-subtle text-carbon-light hover:text-offwhite hover:bg-surface">
                Retry
              </Button>
            </div>
          )}

          {state === "ready" && invitationUrl && (
            <div className="space-y-4">
              <div className="rounded-md border border-border-subtle bg-surface p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Badge variant="outline" className="border-accent/30 text-accent">MeasureOne</Badge>
                  <span className="text-sm text-carbon-light">
                    Hand the device to the borrower to complete verification
                  </span>
                </div>
                {/*
                  MeasureOne M1-Link Widget Integration
                  
                  In production, this iframe loads MeasureOne's hosted verification flow
                  where the borrower connects their insurance account.
                  
                  The widget handles:
                  - Insurance provider selection
                  - Secure login to the borrower's insurance portal
                  - Data extraction and verification
                  
                  On completion, MeasureOne fires a webhook (Phase 4)
                  which updates the policy status automatically.
                */}
                <iframe
                  src={invitationUrl}
                  className="h-[500px] w-full rounded-md border border-border-subtle"
                  title="MeasureOne Insurance Verification"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                />
              </div>

              <p className="text-xs text-carbon-light">
                The borrower should log into their insurance provider above. Once complete,
                the policy status will update automatically within a few minutes.
              </p>
            </div>
          )}

          {state === "completed" && (
            <div className="flex h-[400px] flex-col items-center justify-center gap-4">
              <Badge className="bg-green-500/15 text-green-400 border border-green-500/30">Verification Complete</Badge>
              <p className="text-carbon-light">
                Insurance details have been submitted. Status will update shortly.
              </p>
              <Button variant="outline" onClick={handleClose} className="border-border-subtle text-carbon-light hover:text-offwhite hover:bg-surface">
                Close
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
