import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { isAdminRequest } from "./_auth.js";

let sql;

function getDatabase() {
  if (!process.env.POSTGRES_URL) throw new Error("POSTGRES_URL is not configured");
  if (!sql) sql = postgres(process.env.POSTGRES_URL, { max: 1, idle_timeout: 20 });
  return sql;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ success: false });
  }
  if (!isAdminRequest(request)) return response.status(401).json({ success: false });

  try {
    const { dataUrl = "" } = request.body || {};
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
    if (!match) return response.status(400).json({ success: false });

    const database = getDatabase();
    await database`
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (
        'blog-media',
        'blog-media',
        true,
        10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
      )
      on conflict (id) do update set public = true
    `;

    const mimeType = match[1];
    const extension = mimeType.split("/")[1].replace("jpeg", "jpg");
    const objectPath = `media/${Date.now()}-${randomUUID()}.${extension}`;
    const uploadResponse = await fetch(
      `${process.env.SUPABASE_URL}/storage/v1/object/blog-media/${objectPath}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
          "apikey": process.env.SUPABASE_SECRET_KEY,
          "Content-Type": mimeType,
          "x-upsert": "false",
        },
        body: Buffer.from(match[2], "base64"),
      },
    );

    if (!uploadResponse.ok) {
      throw new Error(`Storage upload failed: ${await uploadResponse.text()}`);
    }

    return response.status(200).json({
      success: true,
      url: `${process.env.SUPABASE_URL}/storage/v1/object/public/blog-media/${objectPath}`,
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ success: false, error: "Media upload failed" });
  }
}
