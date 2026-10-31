/** Render every page locally; originals and page numbers remain the report's source of record. */
export async function preparePdfPages(
  blob: Blob,
  pageNumbers: number[],
  save: (pageNumber: number, file: File) => Promise<void>,
  progress: (message: string) => void,
) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker-${pdfjs.version}.js`;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
  });
  try {
    const pdf = await task.promise;
    for (const pageNumber of pageNumbers) {
      if (pageNumber < 1 || pageNumber > pdf.numPages) throw new Error("A saved page number does not match this PDF.");
      progress(`Preparing page ${pageNumber} of ${pdf.numPages}…`);
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, 2400 / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, background: "rgb(255,255,255)" }).promise;
      let image: Blob | null = null;
      for (const quality of [0.92, 0.84, 0.75]) {
        image = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (image && image.size <= 2 * 1024 * 1024) break;
      }
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      if (!image || image.size > 2 * 1024 * 1024)
        throw new Error("This page could not be prepared clearly. Upload a clear photo of it instead.");
      await save(pageNumber, new File([image], `page-${pageNumber}.jpg`, { type: "image/jpeg" }));
    }
  } finally {
    await task.destroy();
  }
}
