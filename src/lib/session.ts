import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: "MEMBER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  emailVerified: boolean;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, status: true, emailVerified: true },
  });
  if (!user) return null;
  if (user.status !== "ACTIVE") return null;
  return user as CurrentUser;
}

export async function requireVerifiedMember(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  if (!user.emailVerified) throw new Error("UNVERIFIED");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  if (user.role !== "ADMIN") throw new Error("FORBIDDEN");
  return user;
}
