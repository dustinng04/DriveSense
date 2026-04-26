import type { Pool, PoolClient } from "pg";
import { pool } from "./pool.js";

export async function withUserTransaction<T>(
  userId: string | null,
  task: (client: PoolClient) => Promise<T>,
  dbPool: Pool = pool,
): Promise<T> {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    if (userId) {
      await client.query("select set_config('app.current_user_id', $1, true)", [userId]);
    }
    const result = await task(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
