import fs from "fs";
import path from "path";

/**
 * Simple uploader that POSTs a local file to the server's /upload endpoint using
 * the global fetch/FormData available in Node 18+.
 * Returns the parsed JSON response from the server.
 */
export async function uploadLocalFile(serverBaseUrl: string, localFilePath: string) {
  const abs = path.resolve(localFilePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }

  const form = new FormData();
  const stream = fs.createReadStream(abs);
  form.append("file", stream, path.basename(abs));

  const resp = await fetch(`${serverBaseUrl.replace(/\/+$/, "")}/upload`, {
    method: "POST",
    body: form,
    // Note: when using FormData in Node, fetch will set the Content-Type header with boundary automatically.
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Upload failed: ${resp.status} ${resp.statusText}: ${txt}`);
  }

  return await resp.json();
}

export default uploadLocalFile;
