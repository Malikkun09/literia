import { servePublishedDocument } from "@/lib/serve-document";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  return servePublishedDocument(id, "inline");
}
