"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loaded } from "@/components/data/page-state";
import { useUser } from "@/components/data/session";
import { actions } from "@/lib/api/actions";
import { refreshData, useApi } from "@/lib/api/use-api";
import { describeAccess } from "@/lib/domain/access";
import type { ProfileView as Profile } from "@/server/api/views";

interface ProfileValues {
  name: string;
  email: string;
  occupation: string;
  address: string;
  pin: string;
  phone: string;
}

export function ProfileView() {
  const user = useUser();
  const state = useApi<Profile>("/profile");
  return (
    <Loaded state={state}>
      {(profile) => (
        <div className="mx-auto max-w-2xl space-y-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
            <p className="text-muted-foreground">
              {describeAccess(user)}
              {profile.designation ? ` · ${profile.designation}` : ""}
            </p>
          </div>
          <ProfileForm
            initial={{
              name: profile.name,
              email: profile.email,
              occupation: profile.occupation ?? "",
              address: profile.address ?? "",
              pin: profile.pin ?? "",
              phone: profile.phone ?? "",
            }}
          />
        </div>
      )}
    </Loaded>
  );
}

function ProfileForm({ initial }: { initial: ProfileValues }) {
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});
  const [pending, setPending] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (k: string) => String(form.get(k) ?? "");
    setPending(true);
    const result = await actions.updateProfile({
      name: field("name"),
      occupation: field("occupation"),
      address: field("address"),
      pin: field("pin"),
      phone: field("phone"),
    });
    setPending(false);
    setState(result.ok ? { saved: true } : { error: result.error });
    if (result.ok) refreshData();
  }

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-4 rounded-lg border bg-card p-5">
      <p className="text-[13px] text-muted-foreground">
        These details fill section D (item 16) of the PvPI form. They are copied into a report when you submit it, so
        later changes do not alter reports already submitted.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={initial.name} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={initial.email} disabled />
        <p className="text-xs text-muted-foreground">Your sign-in email cannot be changed here.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="occupation">Occupation</Label>
          <Input id="occupation" name="occupation" defaultValue={initial.occupation} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Contact number</Label>
          <Input id="phone" name="phone" defaultValue={initial.phone} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="address">Address</Label>
        <Input id="address" name="address" defaultValue={initial.address} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pin">PIN code</Label>
        <Input id="pin" name="pin" defaultValue={initial.pin} inputMode="numeric" maxLength={6} className="w-32" />
      </div>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p className="flex items-center gap-1.5 text-sm text-success" role="status">
          <CheckCircle2 className="size-4" aria-hidden /> Profile saved.
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        Save profile
      </Button>
    </form>
  );
}
