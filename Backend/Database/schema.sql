CREATE TABLE organizations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(30) NOT NULL
        CHECK (type IN ('academic', 'non_academic')),
    primary_color VARCHAR(7) NOT NULL DEFAULT '#1E3ABA'
        CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT NOT NULL
        REFERENCES organizations(id) ON DELETE RESTRICT,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL
        CHECK (role IN ('admin', 'doctor', 'student')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (organization_id, email)
);

CREATE INDEX idx_users_organization_id
    ON users (organization_id);
