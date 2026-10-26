// Entry point of the Supabase Edge Function bundle (scripts/build-api.mjs).
import { setFormTemplateLoader } from "@/server/pdf/pvpi-form";
import { handleApiRequest } from "./handler";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(options: { port: number }, handler: (request: Request) => Promise<Response>): unknown;
  serve(handler: (request: Request) => Promise<Response>): unknown;
};

// The blank PvPI form is a static file of the website (public/forms, copied at build).
const FORM_TEMPLATE_URL =
  Deno.env.get("FORM_TEMPLATE_URL") ?? "https://adr-reporter.pages.dev/forms/pvpi-adrrf-v1.4.pdf";

setFormTemplateLoader(async () => {
  const response = await fetch(FORM_TEMPLATE_URL);
  if (!response.ok) throw new Error(`The PvPI form template could not be loaded from ${FORM_TEMPLATE_URL}`);
  return new Uint8Array(await response.arrayBuffer());
});

// Supabase chooses the port itself; API_PORT is only for running the bundle locally.
const port = Deno.env.get("API_PORT");
if (port) Deno.serve({ port: Number(port) }, handleApiRequest);
else Deno.serve(handleApiRequest);
