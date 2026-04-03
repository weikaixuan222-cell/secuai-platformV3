import { query } from "../db/client.js";
import type { CreateUserInput, UserRow } from "../db/types.js";

export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const result = await query<UserRow>(
    `
      INSERT INTO users (email, password_hash, display_name, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [input.email, input.passwordHash, input.displayName, input.status ?? "active"]
  );

  return result.rows[0];
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `
      SELECT *
      FROM users
      WHERE email = $1
      LIMIT 1
    `,
    [email]
  );

  return result.rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `
      SELECT *
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function updateUserLastLoginAt(id: string): Promise<void> {
  await query(
    `
      UPDATE users
      SET last_login_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `,
    [id]
  );
}
