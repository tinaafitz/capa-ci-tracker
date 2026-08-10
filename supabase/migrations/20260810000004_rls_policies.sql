-- Migration: Row-Level Security Policies
-- Enable RLS on all tables and define access policies.

-- ============================================================
-- Enable RLS on all tables
-- ============================================================
ALTER TABLE builds           ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs       ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ANON: no access to any table
-- (No policies created for anon = implicit deny when RLS is on)
-- ============================================================

-- ============================================================
-- AUTHENTICATED: full read/write on all operational tables
-- Small team (4-6), all engineers, no row-level segregation needed.
-- ============================================================

-- builds: authenticated can read all, write all (no delete -- immutable once ingested)
CREATE POLICY "authenticated_builds_select"
  ON builds FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_builds_insert"
  ON builds FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_builds_update"
  ON builds FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- support_tickets: authenticated can CRUD
CREATE POLICY "authenticated_tickets_select"
  ON support_tickets FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_tickets_insert"
  ON support_tickets FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_tickets_update"
  ON support_tickets FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_tickets_delete"
  ON support_tickets FOR DELETE
  TO authenticated
  USING (true);

-- activities: authenticated can read all, insert (for notes), no update/delete (immutable audit log)
CREATE POLICY "authenticated_activities_select"
  ON activities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_activities_insert"
  ON activities FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- tasks: authenticated can CRUD
CREATE POLICY "authenticated_tasks_select"
  ON tasks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated_tasks_insert"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_tasks_update"
  ON tasks FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated_tasks_delete"
  ON tasks FOR DELETE
  TO authenticated
  USING (true);

-- agent_runs: authenticated can read (observability), no write
-- (Only service_role writes to agent_runs from Edge Functions)
CREATE POLICY "authenticated_agent_runs_select"
  ON agent_runs FOR SELECT
  TO authenticated
  USING (true);
