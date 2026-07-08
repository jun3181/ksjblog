import { createHash, timingSafeEqual } from "node:crypto";

export function createAdminToken() {
  const loginId = process.env.LOGIN_ID || "";
  const password = process.env.LOGIN_PASSWORD || "";
  return createHash("sha256").update(`${loginId}:${password}:ksjblog-admin`).digest("hex");
}

export function isAdminRequest(request) {
  const authorization = request.headers.authorization || "";
  const receivedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedToken = createAdminToken();
  if (!receivedToken || receivedToken.length !== expectedToken.length) return false;

  return timingSafeEqual(Buffer.from(receivedToken), Buffer.from(expectedToken));
}
