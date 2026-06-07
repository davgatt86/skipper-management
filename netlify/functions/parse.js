// netlify/functions/parse.js
// Proxies parse requests to the Anthropic API using a server-side key.
// The browser never sees ANTHROPIC_API_KEY. Set it in Netlify:
//   Site settings -> Environment variables -> ANTHROPIC_API_KEY

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server missing ANTHROPIC_API_KEY" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Bad JSON body" }) };
  }

  const { media, mediaType, prompt, text } = payload;
  if (!prompt || (!media && !text)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing prompt, and one of media or text" }) };
  }

  // Build the message content. Media (PDF/image) when provided; otherwise a
  // plain-text block (used for spreadsheet rows that the browser already read).
  let content;
  if (media) {
    const isPdf = (mediaType || "").includes("pdf");
    const doc = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: media } }
      : { type: "image", source: { type: "base64", media_type: mediaType || "image/png", data: media } };
    content = [doc, { type: "text", text: prompt }];
  } else {
    content = [{ type: "text", text: prompt + "\n\n----- DATA -----\n" + text }];
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        messages: [{ role: "user", content }],
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return {
        statusCode: resp.status,
        body: JSON.stringify({ error: (data && data.error && data.error.message) || `Anthropic ${resp.status}` }),
      };
    }
    // Return just the joined text so the client can extract JSON from it
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return { statusCode: 200, body: JSON.stringify({ text }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
