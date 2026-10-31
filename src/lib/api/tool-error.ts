/** Keep service configuration and provider diagnostics out of product messages. */
export function toolError(message: string): string {
  if (/AI|Ollama|Gemini|Claude|Anthropic|provider|model|API[_ -]?key|schema|tokens?|rate.limit|quota/i.test(message)) {
    return "This step could not be completed. Try again shortly, or enter the details manually.";
  }
  return message;
}
