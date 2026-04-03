import { query } from "../db/client.js";
import type { CreateUserSessionInput, UserSessionRow } from "../db/types.js";

export async function createUserSession(input: CreateUserSessionInput): Promise<UserSessionRow> {
  const result = await query<UserSessionRow>(
    `
      INSERT INTO user_sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
      RETURNING *
    `,
    [input.userId, input.tokenHash, input.expiresAt]
  );

  return result.rows[0];
}

export async function findActiveUserSessionByTokenHash(
  tokenHash: string
): Promise<UserSessionRow | null> {
  const result = await query<UserSessionRow>(
    `
      SELECT *
      FROM user_sessions
      WHERE token_hash = $1
        AND expires_at > NOW()
      LIMIT 1
    `,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}

export async function touchUserSession(sessionId: string): Promise<void> {
  await query(
    `
      UPDATE user_sessions
      SET last_used_at = NOW()
      WHERE id = $1
    `,
    [sessionId]
  );
}

export async function deleteExpiredUserSessions(): Promise<number> {
  const result = await query<{ deleted_count: string }>(
    `
      WITH deleted AS (
        DELETE FROM user_sessions
        WHERE expires_at <= NOW()
        RETURNING 1
      )
      SELECT COUNT(*)::text AS deleted_count
      FROM deleted
    `
  );

  return Number(result.rows[0]?.deleted_count ?? 0);
}

export async function deleteUserSessionByTokenHash(tokenHash: string): Promise<void> {
  await query(
    `
      DELETE FROM user_sessions
      WHERE token_hash = $1
    `,
    [tokenHash]
  );
}
