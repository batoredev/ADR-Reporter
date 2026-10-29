/** Change to true, rebuild and redeploy the API to allow paid Claude fallback.
 * An API key or AI_PROVIDER environment variable cannot override this switch.
 * Ollama/Gemini account billing is controlled in those providers' consoles;
 * use accounts without paid billing if you want free-tier usage only.
 */
export const ALLOW_PAID_AI: boolean = false;
