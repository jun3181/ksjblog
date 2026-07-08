const visits = globalThis.__stackChatVisits || {
  seenIps: new Set(),
  count: 0,
};

globalThis.__stackChatVisits = visits;

function getVisitorIp(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const firstForwardedIp = forwardedIp?.split(",")[0]?.trim();

  return (
    firstForwardedIp ||
    request.headers["x-real-ip"] ||
    request.socket?.remoteAddress ||
    "unknown"
  );
}

export default function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ success: false });
  }

  const visitorIp = getVisitorIp(request);
  const wasSeen = visits.seenIps.has(visitorIp);

  if (!wasSeen) {
    visits.seenIps.add(visitorIp);
    visits.count += 1;
  }

  return response.status(200).json({
    success: true,
    count: visits.count,
    counted: !wasSeen,
  });
}
