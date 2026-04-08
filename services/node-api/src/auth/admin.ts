import { config } from "../config.js";

/**
 * Creates a user in Supabase auth.users using the REST API and the service role key.
 * This should ONLY be called from the OAuth callback when a user logs in for the first time.
 */
export async function getOrCreateAuthUser(email: string): Promise<string> {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured for direct login.");
  }

  const adminHeaders = {
    "Content-Type": "application/json",
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
  };

  // 1. Try to find the user by email
  // The admin API /admin/users endpoint can be searched or we can try to create and handle conflict.
  // We'll create the user. If they exist, Supabase returns 422 or 400 with a specific error,
  // but it's cleaner to query /admin/users if possible.
  // Actually, the simplest way is to fetch users and filter by email, or use the GET /admin/users endpoint.
  const listResponse = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
    method: "GET",
    headers: adminHeaders,
  });

  if (!listResponse.ok) {
    throw new Error(`Failed to list Supabase users: ${await listResponse.text()}`);
  }

  const data = await listResponse.json() as { users: Array<{ id: string; email: string }> };
  const existingUser = data.users.find((u) => u.email === email);

  if (existingUser) {
    return existingUser.id;
  }

  // 2. Create the user
  const createResponse = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      email,
      email_confirm: true, // Auto-confirm since they authenticated via OAuth
      // Generate a random secure password since they login via OAuth
      password: crypto.randomUUID() + crypto.randomUUID(),
    }),
  });

  if (!createResponse.ok) {
    throw new Error(`Failed to create Supabase user: ${await createResponse.text()}`);
  }

  const createdData = await createResponse.json() as { id: string };
  return createdData.id;
}
