"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction, type ProfileState } from "@/app/(app)/reports/actions";

interface ProfileValues {
  name: string;
  email: string;
  occupation: string;
  address: string;
  pin: string;
  phone: string;
}

export function ProfileForm({ initial }: { initial: ProfileValues }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateProfileAction, {});
  return (
    <form action={action} className="space-y-4 rounded-lg border bg-card p-5">
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
