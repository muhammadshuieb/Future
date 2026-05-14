import bcrypt from "bcryptjs";

const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/;

/** Bcrypt hashes for `users.password_hash` (staff panel). */
export async function hashStaffPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function isBcryptStaffHash(stored: string): boolean {
  return BCRYPT_PREFIX.test(String(stored ?? "").trim());
}
