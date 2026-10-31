"use client";

import { useState, type ReactNode } from "react";
import { useController, useFormContext, useWatch, type FieldPath } from "react-hook-form";
import { AlertTriangle, MessageSquareWarning } from "lucide-react";
import { cn } from "cn";
import type { CaseFormValues } from "@/lib/domain/case-form";

export type FormPath = FieldPath<CaseFormValues>;

export const fieldId = (path: string) => `field-${path.replace(/\./g, "-")}`;

export const inputClass =
  "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:bg-secondary disabled:opacity-60 aria-invalid:border-destructive";

export interface IssueView {
  id: string;
  body: string;
  author: string;
}

export function IssueNotes({ issues }: { issues?: IssueView[] }) {
  if (!issues?.length) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {issues.map((issue) => (
        <p key={issue.id} className="flex gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-[13px] text-warning">
          <MessageSquareWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">{issue.author}:</span> {issue.body}
          </span>
        </p>
      ))}
    </div>
  );
}

interface FieldShellProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  aside?: ReactNode;
  issues?: IssueView[];
  className?: string;
  children: ReactNode;
}

export function FieldShell({ id, label, required, hint, error, aside, issues, className, children }: FieldShellProps) {
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          {required ? (
            <span className="text-destructive" aria-hidden>
              {" "}
              *
            </span>
          ) : null}
          {required ? <span className="sr-only"> (mandatory)</span> : null}
        </label>
        {aside}
      </div>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
          <AlertTriangle className="size-3" aria-hidden />
          {error}
        </p>
      ) : null}
      <IssueNotes issues={issues} />
    </div>
  );
}

function errorAt(errors: unknown, path: string): string | undefined {
  let node: unknown = errors;
  for (const key of path.split(".")) {
    if (node && typeof node === "object") node = (node as Record<string, unknown>)[key];
    else return undefined;
  }
  const message = (node as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : undefined;
}

/** "Unknown" checkbox: records the field in the given unknownFields list and clears its value. */
export function UnknownToggle({
  listPath,
  field,
  onMarked,
}: {
  listPath: FormPath;
  field: string;
  onMarked: () => void;
}) {
  const { setValue, control } = useFormContext<CaseFormValues>();
  const list = (useWatch({ control, name: listPath }) as string[] | undefined) ?? [];
  const checked = list.includes(field);
  return (
    <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
      <input
        type="checkbox"
        className="size-3.5 accent-primary"
        checked={checked}
        onChange={(e) => {
          const next = e.target.checked ? [...list, field] : list.filter((f) => f !== field);
          setValue(listPath, next as never, { shouldDirty: true });
          if (e.target.checked) onMarked();
        }}
      />
      Unknown
    </label>
  );
}

interface TextFieldProps {
  name: FormPath;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  multiline?: boolean;
  placeholder?: string;
  list?: string;
  inputMode?: "numeric" | "decimal" | "text";
  unknown?: { listPath: FormPath; field: string };
  issues?: IssueView[];
  issuePath?: string;
  className?: string;
}

export function TextField({
  name,
  label,
  required,
  hint,
  multiline,
  placeholder,
  list,
  inputMode,
  unknown,
  issues,
  issuePath,
  className,
}: TextFieldProps) {
  const {
    register,
    setValue,
    control,
    formState: { errors },
  } = useFormContext<CaseFormValues>();
  const unknownList = (useWatch({ control, name: unknown?.listPath ?? name }) as unknown) ?? [];
  const isUnknown = unknown ? Array.isArray(unknownList) && unknownList.includes(unknown.field) : false;
  const id = fieldId(issuePath ?? name);
  const error = errorAt(errors, name);
  return (
    <FieldShell
      id={id}
      label={label}
      required={required}
      hint={hint}
      error={error}
      issues={issues}
      className={className}
      aside={
        unknown ? (
          <UnknownToggle
            listPath={unknown.listPath}
            field={unknown.field}
            onMarked={() => setValue(name, "" as never, { shouldDirty: true })}
          />
        ) : null
      }
    >
      {multiline ? (
        <textarea
          id={id}
          rows={3}
          placeholder={isUnknown ? "Unknown" : placeholder}
          disabled={isUnknown}
          aria-invalid={Boolean(error)}
          className={cn(inputClass, "h-auto min-h-20 py-1.5")}
          {...register(name)}
        />
      ) : (
        <input
          id={id}
          placeholder={isUnknown ? "Unknown" : placeholder}
          list={list}
          inputMode={inputMode}
          disabled={isUnknown}
          aria-invalid={Boolean(error)}
          className={inputClass}
          autoComplete="off"
          {...register(name)}
        />
      )}
    </FieldShell>
  );
}

interface ChoiceFieldProps {
  name: FormPath;
  label: string;
  options: { value: string; label: string }[];
  required?: boolean;
  hint?: ReactNode;
  unknown?: { listPath: FormPath; field: string };
  issues?: IssueView[];
  issuePath?: string;
  className?: string;
}

/** A set of radio buttons; one may be chosen, or cleared. */
export function RadioField({
  name,
  label,
  options,
  required,
  hint,
  unknown,
  issues,
  issuePath,
  className,
}: ChoiceFieldProps) {
  const { register, setValue, control } = useFormContext<CaseFormValues>();
  const current = useWatch({ control, name }) as string;
  const unknownList = (useWatch({ control, name: unknown?.listPath ?? name }) as unknown) ?? [];
  const isUnknown = unknown ? Array.isArray(unknownList) && unknownList.includes(unknown.field) : false;
  const id = fieldId(issuePath ?? name);
  return (
    <fieldset className={cn("space-y-1", className)} id={id}>
      <div className="flex items-baseline justify-between gap-2">
        <legend className="text-[13px] font-medium">
          {label}
          {required ? <span className="text-destructive"> *</span> : null}
        </legend>
        {unknown ? (
          <UnknownToggle
            listPath={unknown.listPath}
            field={unknown.field}
            onMarked={() => setValue(name, "" as never, { shouldDirty: true })}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn("flex cursor-pointer items-center gap-1.5 text-sm", isUnknown && "opacity-50")}
          >
            <input
              type="radio"
              value={o.value}
              disabled={isUnknown}
              className="size-4 accent-primary"
              {...register(name)}
            />
            {o.label}
          </label>
        ))}
        {current && !isUnknown ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => setValue(name, "" as never, { shouldDirty: true })}
          >
            Clear
          </button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <IssueNotes issues={issues} />
    </fieldset>
  );
}

export function SelectField({ name, label, options, required, hint, issues, issuePath, className }: ChoiceFieldProps) {
  const { register } = useFormContext<CaseFormValues>();
  const id = fieldId(issuePath ?? name);
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} issues={issues} className={className}>
      <select id={id} className={inputClass} {...register(name)}>
        <option value="">Not entered</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function CheckboxGroup({
  name,
  label,
  options,
  hint,
  issues,
}: {
  name: FormPath;
  label: string;
  options: { value: string; label: string }[];
  hint?: ReactNode;
  issues?: IssueView[];
}) {
  const { register } = useFormContext<CaseFormValues>();
  return (
    <fieldset className="space-y-1" id={fieldId(name)}>
      <legend className="text-[13px] font-medium">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input type="checkbox" value={o.value} className="size-4 accent-primary" {...register(name)} />
            {o.label}
          </label>
        ))}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <IssueNotes issues={issues} />
    </fieldset>
  );
}

type Precision = "day" | "month" | "year";
const precisionOfValue = (v: string): Precision | null =>
  v.length === 10 ? "day" : v.length === 7 ? "month" : v.length === 4 ? "year" : null;

/** Date that may be exact, month-and-year, or year only, optionally approximate. */
export function PartialDateField({
  name,
  label,
  required,
  hint,
  unknown,
  disabled,
  issues,
  issuePath,
  className,
}: {
  name: FormPath;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  unknown?: { listPath: FormPath; field: string };
  disabled?: boolean;
  issues?: IssueView[];
  issuePath?: string;
  className?: string;
}) {
  const {
    register,
    setValue,
    control,
    formState: { errors },
  } = useFormContext<CaseFormValues>();
  const { field } = useController({ control, name: `${name}.value` as FormPath });
  const value = (field.value as string) ?? "";
  const [precision, setPrecision] = useState<Precision>(precisionOfValue(value) ?? "day");
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    // Follow values set from outside this control, such as an applied extraction.
    setSeenValue(value);
    const p = precisionOfValue(value);
    if (p) setPrecision(p);
  }
  const unknownList = (useWatch({ control, name: unknown?.listPath ?? name }) as unknown) ?? [];
  const isUnknown = unknown ? Array.isArray(unknownList) && unknownList.includes(unknown.field) : false;
  const off = disabled || isUnknown;
  const id = fieldId(issuePath ?? name);
  const error = errorAt(errors, `${name}.value`);

  const changePrecision = (next: Precision) => {
    setPrecision(next);
    const truncated = next === "year" ? value.slice(0, 4) : next === "month" ? value.slice(0, 7) : "";
    field.onChange(precisionOfValue(truncated) === next ? truncated : "");
  };

  return (
    <FieldShell
      id={id}
      label={label}
      required={required}
      hint={hint}
      error={error}
      issues={issues}
      className={className}
      aside={
        unknown ? (
          <UnknownToggle
            listPath={unknown.listPath}
            field={unknown.field}
            onMarked={() => {
              field.onChange("");
              setValue(`${name}.approx` as FormPath, false as never, { shouldDirty: true });
            }}
          />
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`${label}: precision`}
          className={cn(inputClass, "w-auto")}
          value={precision}
          disabled={off}
          onChange={(e) => changePrecision(e.target.value as Precision)}
        >
          <option value="day">Exact date</option>
          <option value="month">Month and year</option>
          <option value="year">Year only</option>
        </select>
        {precision === "day" ? (
          <input
            id={id}
            type="date"
            disabled={off}
            aria-invalid={Boolean(error)}
            className={cn(inputClass, "w-auto")}
            value={value}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
          />
        ) : precision === "month" ? (
          <input
            id={id}
            type="month"
            placeholder="YYYY-MM"
            disabled={off}
            aria-invalid={Boolean(error)}
            className={cn(inputClass, "w-auto")}
            value={value}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
          />
        ) : (
          <input
            id={id}
            inputMode="numeric"
            placeholder="YYYY"
            maxLength={4}
            disabled={off}
            aria-invalid={Boolean(error)}
            className={cn(inputClass, "w-24")}
            value={value}
            onChange={(e) => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onBlur={field.onBlur}
          />
        )}
        <label className={cn("flex items-center gap-1 text-xs text-muted-foreground", off && "opacity-50")}>
          <input
            type="checkbox"
            disabled={off}
            className="size-3.5 accent-primary"
            {...register(`${name}.approx` as FormPath)}
          />
          Approximate
        </label>
      </div>
    </FieldShell>
  );
}
