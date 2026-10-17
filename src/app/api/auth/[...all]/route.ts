import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/auth";

const handler = (req: Request) => {
  const { GET, POST } = toNextJsHandler(getAuth());
  return req.method === "GET" ? GET(req) : POST(req);
};

export { handler as GET, handler as POST };
