import { createHash, createHmac } from "node:crypto";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function encodedPath(value: string) {
  return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function objectUrl(key: string) {
  const endpoint = new URL(required("RAILWAY_S3_ENDPOINT"));
  const bucket = required("RAILWAY_S3_BUCKET");
  const basePath = endpoint.pathname.replace(/\/$/, "");
  endpoint.pathname = `${basePath}/${encodeURIComponent(bucket)}/${encodedPath(key)}`;
  endpoint.search = "";
  return endpoint;
}

async function signedRequest(
  method: "GET" | "PUT",
  key: string,
  body?: Buffer,
  extraHeaders: Record<string, string> = {},
) {
  const accessKey = required("RAILWAY_S3_ACCESS_KEY_ID");
  const secretKey = required("RAILWAY_S3_SECRET_ACCESS_KEY");
  const region = process.env.RAILWAY_S3_REGION || "sin";
  const url = objectUrl(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body || "");
  const canonicalHeaders =
    `host:${url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${secretKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return fetch(url, {
    method,
    headers: {
      ...extraHeaders,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: body ? (Uint8Array.from(body).buffer as ArrayBuffer) : undefined,
    cache: "no-store",
  });
}

export async function getRailwayObject(key: string, range?: string | null) {
  return signedRequest("GET", key, undefined, range ? { Range: range } : {});
}

export async function putRailwayObject(key: string, body: Buffer, contentType: string) {
  const response = await signedRequest("PUT", key, body, { "Content-Type": contentType });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Railway object upload failed (${response.status}): ${details.slice(0, 300)}`);
  }
}
