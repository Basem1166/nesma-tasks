import bcrypt from "bcryptjs";
import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[a-z]/, "Password needs a lowercase letter")
  .regex(/[A-Z]/, "Password needs an uppercase letter")
  .regex(/[0-9]/, "Password needs a digit");

export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Used to keep login timing constant when the email does not exist.
export const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5bU9yE3s8xUu0XQ2nM7o0wJb3fF1G2y";
