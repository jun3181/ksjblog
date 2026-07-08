import { createAdminToken } from "./_auth.js";

export default function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ success: false });
  }

  const expectedId = process.env.LOGIN_ID;
  const expectedPassword = process.env.LOGIN_PASSWORD;
  const { loginId = "", password = "" } = request.body || {};

  const success = Boolean(
    expectedId &&
    expectedPassword &&
    loginId === expectedId &&
    password === expectedPassword,
  );

  return response.status(success ? 200 : 401).json({
    success,
    token: success ? createAdminToken() : undefined,
  });
}
