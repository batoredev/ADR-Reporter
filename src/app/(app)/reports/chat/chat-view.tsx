"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, FileText, Loader2, Paperclip, Send } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { WorkspaceTabs, WorkspaceTabPanel } from "@/components/ui/workspace-tabs";
import { PageError, PageLoading } from "@/components/data/page-state";
import { FileLink } from "@/components/data/protected-file";
import { useRequireAccess } from "@/components/data/session";
import { FactReview } from "@/components/report-chat/fact-review";
import { EscalateButton } from "@/components/case/escalate-button";
import { inputClass } from "@/components/report-form/fields";
import { actions } from "@/lib/api/actions";
import { ApiError, apiFile } from "@/lib/api/client";
import { toolError } from "@/lib/api/tool-error";
import { preparePdfPages } from "@/lib/api/prepare-pdf";
import { canReport } from "@/lib/domain/access";
import { UPLOAD_LIMITS } from "@/lib/domain/report-chat";
import { files, pages } from "@/lib/routes";
import type { ReportChatView } from "@/server/workflow/report-chat";

export function ChatReportView() {
  const allowed = useRequireAccess(canReport);
  const id = useSearchParams().get("id") ?? "";
  if (!allowed) return null;
  if (!id) return <PageError error={new ApiError("No report was chosen.", 404)} />;
  return <ChatSession key={id} id={id} />;
}

function ChatSession({ id }: { id: string }) {
  const [data, setData] = useState<ReportChatView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [screen, setScreen] = useState("conversation");
  const [sideTab, setSideTab] = useState("details");
  const [preparing, setPreparing] = useState<string | null>(null);
  const [preparationErrors, setPreparationErrors] = useState<Record<string, string>>({});
  const [initAttempt, setInitAttempt] = useState(0);
  const initialized = useRef(false);
  const mounted = useRef(false),
    reading = useRef(false),
    preparation = useRef(false);
  const messageAttempt = useRef<{ content: string; requestId: string; questionKey: string | null } | null>(null);
  const uploadAttempt = useRef<{ signature: string; requestId: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const historyPanel = useRef<HTMLDivElement>(null);
  const lastMessageId = data?.messages.at(-1)?.id;
  useEffect(() => {
    const panel = historyPanel.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [lastMessageId]);
  const refresh = useCallback(async () => {
    const result = await actions.chat(id);
    if (!mounted.current) return;
    if (result.ok) setData(result.data);
    else setError(toolError(result.error));
  }, [id]);
  useEffect(() => {
    mounted.current = true;
    initialized.current = false;
    void (async () => {
      setError(null);
      const result = await actions.startChat(id);
      if (!mounted.current) return;
      if (!result.ok) {
        setError(toolError(result.error));
        return;
      }
      initialized.current = true;
      await refresh();
    })();
    const timer = setInterval(() => {
      if (initialized.current) void refresh();
    }, 4000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [id, refresh, initAttempt]);

  useEffect(() => {
    if (
      !data ||
      reading.current ||
      !data.jobs.some(
        (j) =>
          (j.status === "QUEUED" && new Date(j.nextAttemptAt) <= new Date()) ||
          (j.status === "RUNNING" && j.leaseUntil && new Date(j.leaseUntil) < new Date()),
      )
    )
      return;
    reading.current = true;
    void actions
      .chatProcess(id)
      .then((result) => {
        if (mounted.current && !result.ok) setError(toolError(result.error));
      })
      .finally(() => {
        reading.current = false;
        if (mounted.current) void refresh();
      });
  }, [data, id, refresh]);

  useEffect(() => {
    if (!data || preparation.current) return;
    const doc = data.documents.find(
      (d) =>
        d.mimeType === "application/pdf" &&
        !preparationErrors[d.id] &&
        data.jobs.some((j) => j.documentId === d.id && j.status === "WAITING_PAGES"),
    );
    if (!doc) return;
    const pagesToPrepare = data.jobs
      .filter((j) => j.documentId === doc.id && j.status === "WAITING_PAGES")
      .map((j) => j.pageNumber);
    preparation.current = true;
    void (async () => {
      try {
        const source = await apiFile(files.document(id, doc.id));
        await preparePdfPages(
          source.blob,
          pagesToPrepare,
          async (pageNumber, file) => {
            if (!mounted.current) throw new Error("Preparation paused. Reopen this report to continue.");
            const form = new FormData();
            form.set("file", file);
            const result = await actions.chatPage(id, doc.id, pageNumber, form);
            if (!result.ok) throw new Error(result.error);
          },
          (message) => {
            if (mounted.current) setPreparing(`${doc.name}: ${message}`);
          },
        );
      } catch {
        if (mounted.current)
          setPreparationErrors((errors) => ({
            ...errors,
            [doc.id]:
              "This PDF could not be prepared. Retry, remove its password, or upload clear photos of its pages.",
          }));
      } finally {
        preparation.current = false;
        if (mounted.current) {
          setPreparing(null);
          void refresh();
        }
      }
    })();
  }, [data, id, refresh, preparationErrors]);

  async function upload(selected: File[]) {
    if (!selected.length) return;
    if (
      selected.length > UPLOAD_LIMITS.files ||
      selected.some((f) => f.size > UPLOAD_LIMITS.fileBytes) ||
      selected.reduce((n, f) => n + f.size, 0) > UPLOAD_LIMITS.batchBytes
    ) {
      setError("Use up to 20 JPG, PNG or PDF files, 10 MB each and 50 MB total.");
      return;
    }
    const signature = selected.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join("|");
    const attempt =
      uploadAttempt.current?.signature === signature
        ? uploadAttempt.current
        : { signature, requestId: crypto.randomUUID() };
    uploadAttempt.current = attempt;
    const form = new FormData();
    form.set("requestId", attempt.requestId);
    selected.forEach((f) => form.append("files", f));
    setBusy("upload");
    setError(null);
    const result = await actions.chatUpload(id, form);
    if (result.ok) {
      uploadAttempt.current = null;
      await refresh();
      setSideTab("documents");
      if (screen !== "conversation") setScreen("documents");
    } else setError(toolError(result.error));
    setBusy(null);
    if (fileInput.current) fileInput.current.value = "";
  }
  async function send(content: string, retry?: { requestId: string; questionKey: string | null }) {
    if (!data || !content.trim()) return;
    const attempt = retry
      ? { ...retry, content }
      : messageAttempt.current?.content === content
        ? messageAttempt.current
        : { content, requestId: crypto.randomUUID(), questionKey: data.question?.key ?? null };
    messageAttempt.current = attempt;
    setBusy("message");
    setError(null);
    const result = await actions.chatMessage(id, {
      ...attempt,
      revision: data.revision,
      lockVersion: data.lockVersion,
    });
    if (result.ok) {
      setData(result.data);
      setText("");
      messageAttempt.current = null;
      if (result.data.groups.length) setSideTab("details");
    } else {
      setError(toolError(result.error));
      await refresh();
    }
    setBusy(null);
  }
  async function apply(input: unknown) {
    setBusy("apply");
    setError(null);
    const result = await actions.chatApply(id, input);
    if (result.ok) setData(result.data);
    else {
      setError(toolError(result.error));
      await refresh();
    }
    setBusy(null);
    return result.ok;
  }
  if (!data)
    return error ? (
      <div className="space-y-4">
        <PageError error={new ApiError(error, 400)} />
        <Button onClick={() => setInitAttempt((n) => n + 1)}>Try again</Button>
      </div>
    ) : (
      <PageLoading />
    );
  const disabled = Boolean(busy) || data.activeMessage;
  const waiting = data.jobs.filter((j) => ["WAITING_PAGES", "QUEUED", "RUNNING"].includes(j.status)).length;
  const done = data.jobs.filter((j) => j.status === "SUCCEEDED").length;
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{data.caseNumber} · Draft</p>
          <h1 className="mt-1 text-3xl font-semibold">Report assistant</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Add your documents, check the details, then answer what is missing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={pages.caseEdit(id)}>Open form</Link>
          </Button>
          <Button asChild>
            <Link href={pages.caseSubmit(id)}>Review report</Link>
          </Button>
        </div>
      </div>
      {data.potentiallySerious ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-serious/30 bg-serious-soft p-4 text-sm text-serious">
          <p>
            This report is potentially serious.{" "}
            {data.hasOpenEscalation
              ? "An urgent escalation is open."
              : "Escalate urgently when needed; you can finish the report afterwards."}
          </p>
          {!data.hasOpenEscalation ? <EscalateButton caseId={id} /> : null}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/25 bg-card p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <nav aria-label="Report assistant panels" className="flex gap-1 overflow-x-auto border-b lg:hidden">
        {[
          ["conversation", "Conversation"],
          ["details", `Details (${data.groups.length})`],
          ["documents", `Files (${data.documents.length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={screen === key}
            className={cn(
              "min-h-12 shrink-0 border-b-2 border-transparent px-3 text-sm font-medium",
              screen === key && "border-primary text-primary",
            )}
            onClick={() => {
              setScreen(key);
              if (key !== "conversation") setSideTab(key);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section
          className={cn("min-w-0 space-y-4", screen !== "conversation" && "hidden lg:block")}
          aria-label="Report conversation"
        >
          <div
            className="space-y-3 rounded-xl border border-dashed bg-card p-5"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!disabled) void upload(Array.from(e.dataTransfer.files));
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Add related documents</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Prescriptions, photos, clinical notes and lab reports.
                </p>
              </div>
              <Button type="button" variant="outline" disabled={disabled} onClick={() => fileInput.current?.click()}>
                <Paperclip aria-hidden />
                {busy === "upload" ? "Uploading…" : "Add documents"}
              </Button>
            </div>
            <input
              ref={fileInput}
              aria-label="Report documents"
              type="file"
              multiple
              accept="image/jpeg,image/png,application/pdf"
              className="sr-only"
              disabled={disabled}
              onChange={(e) => void upload(Array.from(e.target.files ?? []))}
            />
            <p className="text-xs text-muted-foreground">
              Up to 20 files · 10 MB each · 50 MB per batch. PDFs: up to 20 pages each, 100 pages per batch.
            </p>
            {preparing || data.processing ? (
              <p role="status" className="flex items-start gap-2 text-sm text-primary">
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
                {preparing ??
                  `Reading your documents: ${done} of ${data.jobs.length} pages complete. You can return later to continue.`}
              </p>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b px-5 py-4">
              <h2 className="font-semibold">Conversation</h2>
            </div>
            <div
              className="max-h-[28rem] space-y-4 overflow-y-auto p-5"
              aria-label="Conversation history"
              ref={historyPanel}
            >
              <p className="max-w-lg rounded-xl bg-secondary p-4 text-sm leading-relaxed">
                Start by adding all documents for this fictional report. I will suggest the details they contain and ask
                about what is still missing. You can also enter information here.
              </p>
              {data.messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-xl rounded-xl p-4 text-sm leading-relaxed whitespace-pre-wrap",
                    message.role === "USER" ? "ml-auto bg-info-soft" : "bg-secondary",
                  )}
                >
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">
                    {message.role === "USER" ? "You" : message.role === "SYSTEM" ? "Saved" : "Report assistant"}
                  </p>
                  <p>{message.content}</p>
                  {message.status === "FAILED" || (message.status === "PENDING" && !data.activeMessage) ? (
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() =>
                        message.requestId &&
                        void send(message.content, { requestId: message.requestId, questionKey: message.questionKey })
                      }
                    >
                      Retry message
                    </Button>
                  ) : message.status === "PENDING" ? (
                    <span className="mt-2 block text-xs text-muted-foreground">Reading your answer…</span>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="space-y-4 border-t p-5">
              {data.processing ? (
                <p className="text-sm text-muted-foreground">
                  I will check what is missing after all available pages have been read. You can add notes while you
                  wait.
                </p>
              ) : data.groups.length ? (
                <div className="space-y-2">
                  <p className="text-sm">
                    There are {data.groups.length} suggested details to check before the next question.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSideTab("details");
                      setScreen("details");
                    }}
                  >
                    Review suggested details
                  </Button>
                </div>
              ) : data.question ? (
                <div className="space-y-3">
                  <h3 className="font-medium">{data.question.text}</h3>
                  {data.question.options ? (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(data.question.options).map(([value, label]) => (
                        <Button
                          key={value}
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => void send(value)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    onClick={() => void send("I don't know")}
                  >
                    I don&apos;t know this detail
                  </Button>
                </div>
              ) : (
                <p className="flex items-start gap-2 text-sm text-success">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {data.completeness.ready
                    ? "The required details are complete. Review the report before submitting."
                    : "We have reached the available answers. The report still needs the mandatory details shown below before submission."}
                </p>
              )}
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(text);
                }}
              >
                <label htmlFor="chat-answer" className="block text-sm font-medium">
                  Your answer or additional details
                </label>
                <textarea
                  id="chat-answer"
                  className={inputClass + " h-auto py-3"}
                  rows={3}
                  maxLength={4000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Enter the details you know…"
                  disabled={disabled}
                />
                <Button type="submit" disabled={disabled || !text.trim()}>
                  {busy === "message" ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}Send
                  answer
                </Button>
              </form>
            </div>
          </div>
          {data.completeness.missing.length ? (
            <div className="rounded-xl border bg-card p-5">
              <h2 className="text-sm font-semibold">Required before submission</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {data.completeness.missing.map((f) => (
                  <li key={f.path}>{f.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
        <aside className={cn("min-w-0 space-y-4", screen === "conversation" && "hidden lg:block")}>
          <WorkspaceTabs
            label="Report detail panels"
            value={sideTab}
            onValueChange={(value) => {
              setSideTab(value);
              if (screen !== "conversation") setScreen(value);
            }}
            tabs={[
              { value: "details", label: `Suggested details (${data.groups.length})` },
              { value: "documents", label: `Files (${data.documents.length})` },
            ]}
          >
            <WorkspaceTabPanel value="details">
              <FactReview data={data} busy={disabled || data.processing} onApply={apply} />
            </WorkspaceTabPanel>
            <WorkspaceTabPanel value="documents" className="space-y-4">
              {!data.documents.length ? (
                <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                  No documents added yet.
                </div>
              ) : (
                data.documents.map((doc) => {
                  const jobs = data.jobs.filter((j) => j.documentId === doc.id);
                  return (
                    <section key={doc.id} className="space-y-3 rounded-xl border bg-card p-4">
                      <FileLink path={files.document(id, doc.id)} className="break-all text-sm font-medium">
                        <FileText className="size-4 shrink-0" aria-hidden />
                        {doc.name}
                      </FileLink>
                      <p className="text-xs text-muted-foreground">
                        {doc.pageCount} page{doc.pageCount === 1 ? "" : "s"} ·{" "}
                        {jobs.filter((j) => j.status === "SUCCEEDED").length} read
                      </p>
                      {doc.patientMatch === "DIFFERENT" ? (
                        <p className="text-xs text-warning">Patient initials need checking.</p>
                      ) : null}
                      {jobs.map((job) => (
                        <div key={job.id} className="space-y-1 border-t pt-2 text-xs">
                          <p>
                            Page {job.pageNumber}:{" "}
                            {job.status === "SUCCEEDED"
                              ? "Read"
                              : job.status === "FAILED"
                                ? "Could not read"
                                : job.status === "WAITING_PAGES"
                                  ? "Waiting for preparation"
                                  : job.status === "RUNNING"
                                    ? "Reading…"
                                    : "Queued"}
                          </p>
                          {job.error ? <p className="text-warning">{job.error}</p> : null}
                          {job.status === "FAILED" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={disabled}
                              onClick={() =>
                                void actions.chatRetryJob(id, job.id).then(async (result) => {
                                  if (!result.ok) setError(toolError(result.error));
                                  await refresh();
                                })
                              }
                            >
                              Retry page {job.pageNumber}
                            </Button>
                          ) : null}
                        </div>
                      ))}
                      {preparationErrors[doc.id] ? (
                        <div className="space-y-2">
                          <p className="text-xs text-warning">{preparationErrors[doc.id]}</p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setPreparationErrors((errors) => {
                                const next = { ...errors };
                                delete next[doc.id];
                                return next;
                              })
                            }
                          >
                            Retry preparation
                          </Button>
                        </div>
                      ) : null}
                    </section>
                  );
                })
              )}
              {waiting ? (
                <p className="text-xs text-muted-foreground">
                  {waiting} page{waiting === 1 ? "" : "s"} remaining. Progress is saved.
                </p>
              ) : null}
            </WorkspaceTabPanel>
          </WorkspaceTabs>
        </aside>
      </div>
    </div>
  );
}
