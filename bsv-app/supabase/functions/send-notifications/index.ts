type Withdrawal = {
  memberName: string;
  taskName: string;
  shiftTitle: string;
  shiftId: string;
  date: string;
  start: string;
  end: string;
  withdrawnAt: string;
};

type OutboxNotification = {
  id: string;
  event_key: string;
  recipient: string;
  payload: Withdrawal;
  lease_token: string;
};

const emailPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error("configuration_missing");
  return value;
}

function configuration() {
  const supabase = new URL(required("SUPABASE_URL"));
  const app = new URL(required("APP_URL"));
  for (const url of [supabase, app]) {
    if (url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") {
      throw new Error("configuration_invalid_url");
    }
  }
  const sender = required("RESEND_FROM_EMAIL");
  const cronSecret = required("CRON_SECRET");
  if (!emailPattern.test(sender) || sender.length > 254 || cronSecret.length < 32) {
    throw new Error("configuration_invalid");
  }
  return {
    supabaseOrigin: supabase.origin,
    appOrigin: app.origin,
    serviceKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    resendKey: required("RESEND_API_KEY"),
    sender,
    cronSecret,
  };
}

type Configuration = ReturnType<typeof configuration>;

async function secretMatches(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (let position = 0; position < providedBytes.length; position++) {
    difference |= providedBytes[position] ^ expectedBytes[position];
  }
  return difference === 0;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function validPayload(payload: unknown): payload is Withdrawal {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const value = payload as Record<string, unknown>;
  const limits: Record<string, number> = {
    memberName: 120, taskName: 120, shiftTitle: 160, shiftId: 100,
    date: 10, start: 5, end: 5, withdrawnAt: 19,
  };
  if (Object.keys(value).length !== Object.keys(limits).length) return false;
  for (const [key, maximum] of Object.entries(limits)) {
    if (typeof value[key] !== "string" || !value[key] || value[key].length > maximum) return false;
  }
  return /^[A-Za-z0-9_-]{1,100}$/.test(value.shiftId as string) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date as string) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value.start as string) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value.end as string) &&
    /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value.withdrawnAt as string);
}

async function rpc<T>(config: Configuration, name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${config.supabaseOrigin}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("database_rpc_failed");
  return await response.json() as T;
}

async function deliver(config: Configuration, notification: OutboxNotification): Promise<string> {
  let delivered = false;
  let permanentFailure = false;
  let errorCode = "provider_network_error";
  let messageId: string | null = null;
  if (!validPayload(notification.payload) || typeof notification.recipient !== "string" ||
    notification.recipient.length > 254 || !emailPattern.test(notification.recipient) ||
    !/^withdraw:\d+:[A-Za-z0-9_-]{1,100}$/.test(notification.event_key)) {
    permanentFailure = true;
    errorCode = "invalid_notification";
  } else {
    const payload = notification.payload;
    const link = `${config.appOrigin}/?shift=${encodeURIComponent(payload.shiftId)}`;
    const details = `${payload.memberName} hat sich von ${payload.taskName} abgemeldet.\n` +
      `${payload.shiftTitle}, ${payload.date}, ${payload.start}-${payload.end} (Europe/Berlin).\n` +
      `Abmeldung: ${payload.withdrawnAt} (Europe/Berlin).\n` +
      "Der Platz war zum Zeitpunkt der Abmeldung frei. Der aktuelle Stand ist im Dienstplan sichtbar.";
    const html = `<p>${escapeHtml(details).replace(/\n/g, "<br>")}</p>` +
      `<p><a href="${escapeHtml(link)}">Dienstplan oeffnen</a></p>`;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": notification.event_key,
        },
        body: JSON.stringify({
          from: config.sender,
          to: [notification.recipient],
          subject: "BSV Dienstplan: Abmeldung",
          text: `${details}\n${link}`,
          html,
        }),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      if (response.ok) {
        const result: unknown = await response.json();
        if (result && typeof result === "object" && "id" in result && typeof result.id === "string") {
          delivered = true;
          messageId = result.id;
        } else {
          errorCode = "provider_invalid_response";
        }
      } else {
        errorCode = `provider_http_${response.status}`;
        permanentFailure = response.status >= 400 && response.status < 500 &&
          ![408, 409, 425, 429].includes(response.status);
      }
    } catch {
      errorCode = "provider_network_error";
    }
  }
  try {
    const finished = await rpc<boolean>(config, "finish_notification", {
      notification_id: notification.id,
      claim_token: notification.lease_token,
      delivered,
      message_id: messageId,
      error_code: errorCode,
      permanent_failure: permanentFailure,
    });
    return finished ? (delivered ? "sent" : "not_sent") : "lease_lost";
  } catch {
    return "completion_failed";
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  try {
    const config = configuration();
    const provided = request.headers.get("x-cron-secret") ?? "";
    if (provided.length > 1024 || !await secretMatches(provided, config.cronSecret)) {
      return new Response(null, { status: 401 });
    }
    const notifications = await rpc<OutboxNotification[]>(config, "claim_notifications", { batch_size: 20 });
    const counts: Record<string, number> = { claimed: notifications.length, sent: 0, not_sent: 0, lease_lost: 0, completion_failed: 0 };
    for (let position = 0; position < notifications.length; position += 5) {
      const outcomes = await Promise.all(notifications.slice(position, position + 5).map((notification) => deliver(config, notification)));
      for (const outcome of outcomes) counts[outcome]++;
    }
    return Response.json(counts, { status: counts.completion_failed || counts.lease_lost ? 503 : 200 });
  } catch {
    return Response.json({ error: "dispatcher_unavailable" }, { status: 503 });
  }
});