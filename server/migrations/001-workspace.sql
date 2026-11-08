CREATE TABLE nw_people (
  id text PRIMARY KEY,
  role text NOT NULL,
  network_key text,
  system_id text,
  facility_id text,
  payload jsonb NOT NULL
);
CREATE INDEX nw_people_coverage ON nw_people (network_key, system_id, facility_id);

CREATE TABLE nw_incidents (
  id text PRIMARY KEY,
  network_key text NOT NULL,
  system_id text NOT NULL,
  facility_id text NOT NULL,
  stage text NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX nw_incidents_network ON nw_incidents (network_key, system_id, facility_id);

CREATE TABLE nw_assignments (
  id text PRIMARY KEY,
  case_id text NOT NULL UNIQUE REFERENCES nw_incidents (id),
  recipient_id text NOT NULL REFERENCES nw_people (id),
  payload jsonb NOT NULL
);
CREATE INDEX nw_assignments_recipient ON nw_assignments (recipient_id);

CREATE TABLE nw_transitions (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES nw_incidents (id),
  revision integer NOT NULL,
  action text NOT NULL,
  actor_id text REFERENCES nw_people (id),
  recipient_id text REFERENCES nw_people (id),
  happened_at bigint NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE (case_id, revision)
);

CREATE TABLE nw_sessions (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES nw_people (id),
  expires_at bigint NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX nw_sessions_person ON nw_sessions (person_id, expires_at);

CREATE TABLE nw_invites (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES nw_people (id),
  expires_at bigint NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE nw_shifts (
  id text PRIMARY KEY REFERENCES nw_sessions (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('off', 'available', 'busy')),
  expires_at bigint,
  payload jsonb NOT NULL
);

CREATE TABLE nw_subscriptions (
  id text PRIMARY KEY REFERENCES nw_sessions (id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES nw_people (id),
  endpoint_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL
);

CREATE TABLE nw_push_attempts (
  id text PRIMARY KEY,
  assignment_id text NOT NULL REFERENCES nw_assignments (id),
  recipient_id text NOT NULL REFERENCES nw_people (id),
  status text NOT NULL,
  ordinal bigint GENERATED ALWAYS AS IDENTITY,
  payload jsonb NOT NULL
);
CREATE INDEX nw_push_assignment ON nw_push_attempts (assignment_id, ordinal);

CREATE TABLE nw_recordings (
  id uuid PRIMARY KEY,
  owner_hash text NOT NULL,
  network_key text NOT NULL,
  title text NOT NULL,
  recorded_from timestamptz NOT NULL,
  recorded_through timestamptz NOT NULL,
  file_ref text NOT NULL UNIQUE,
  checksum text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nw_recordings_owner ON nw_recordings (owner_hash);
