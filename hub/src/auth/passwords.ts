import { hash, verify, type Options } from "@node-rs/argon2";

const ARGON2_OPTIONS: Options = {
  memoryCost: 19456, // 19 MiB — OWASP 2024 minimum
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hashedPassword: string,
  password: string
): Promise<boolean> {
  try {
    return await verify(hashedPassword, password);
  } catch {
    return false;
  }
}
