import postgres from "postgres";
import { isAdminRequest } from "./_auth.js";

let sql;

function getDatabase() {
  if (!process.env.POSTGRES_URL) throw new Error("POSTGRES_URL is not configured");
  if (!sql) sql = postgres(process.env.POSTGRES_URL, { max: 1, idle_timeout: 20 });
  return sql;
}

async function ensureContentRow(database) {
  await database`
    create table if not exists blog_content (
      id integer primary key,
      posts jsonb not null default '[]'::jsonb,
      categories jsonb not null default '[]'::jsonb,
      updated_at timestamptz not null default now()
    )
  `;
  await database`
    insert into blog_content (id)
    values (1)
    on conflict (id) do nothing
  `;
}

export default async function handler(request, response) {
  try {
    const database = getDatabase();
    await ensureContentRow(database);

    if (request.method === "GET") {
      const [content] = await database`
        select posts, categories
        from blog_content
        where id = 1
      `;
      return response.status(200).json(content);
    }

    if (request.method === "PUT") {
      if (!isAdminRequest(request)) return response.status(401).json({ success: false });

      const posts = Array.isArray(request.body?.posts) ? request.body.posts : [];
      const categories = Array.isArray(request.body?.categories) ? request.body.categories : [];
      await database`
        update blog_content
        set posts = ${database.json(posts)},
            categories = ${database.json(categories)},
            updated_at = now()
        where id = 1
      `;
      return response.status(200).json({ success: true });
    }

    if (request.method === "POST" && request.query?.action === "comment") {
      const { postId, comment } = request.body || {};
      if (!postId || !comment?.content) return response.status(400).json({ success: false });

      const [content] = await database`select posts from blog_content where id = 1`;
      const posts = Array.isArray(content?.posts) ? content.posts : [];
      const nextPosts = posts.map((post) => (
        String(post.id) === String(postId)
          ? { ...post, comments: [...(Array.isArray(post.comments) ? post.comments : []), comment] }
          : post
      ));
      await database`
        update blog_content
        set posts = ${database.json(nextPosts)}, updated_at = now()
        where id = 1
      `;
      return response.status(200).json({ success: true, posts: nextPosts });
    }

    response.setHeader("Allow", "GET, PUT, POST");
    return response.status(405).json({ success: false });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ success: false, error: "Database request failed" });
  }
}
