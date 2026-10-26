// The API on Node.js for local development and tests: `npm run dev:api`.
import "dotenv/config";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { handleApiRequest } from "./handler";

const port = Number(process.env.API_PORT ?? 8000);

createServer(async (req, res) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    // Required by Node.js for streamed request bodies.
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
  const response = await handleApiRequest(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`ADR Reporter API on http://localhost:${port}/api`));
