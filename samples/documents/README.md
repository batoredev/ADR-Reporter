# Fictional document samples

Use `fictional-lab-report.pdf` to check two investigation results and a partial, explicitly approximate date. No
medication or reaction should be invented. Use `fictional-discharge-summary.pdf` to check reaction/history text,
medication start and stop dates, and treatment of the reaction. “Improved” must not become a made-up resolution date.

Upload either PDF and select **Read with AI**. Gemini must be configured for PDFs while paid Claude is disabled.
Check source text, uncertain values and field placement before applying. For Ollama image extraction, use the JPG/PNG
samples in `samples/prescriptions/`.

These files can be regenerated with `node scripts/make-document-samples.mjs`. All details are invented for testing.
