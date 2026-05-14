import bcrypt from "bcryptjs";

export async function hashPortalPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPortalPassword(plain: string, hash: string): Promise<boolean> {
  const h = String(hash ?? "").trim();
  if (!h) return false;
  return bcrypt.compare(plain, h);
}
