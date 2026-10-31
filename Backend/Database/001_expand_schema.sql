BEGIN;

-- Keep users identifiable within their organization.
ALTER TABLE users
    ADD CONSTRAINT uq_users_id_organization
    UNIQUE (id, organization_id);

-- Platform administrators are independent of any organization.
CREATE TABLE platform_admins (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Each course belongs to one organization and has one responsible doctor.
CREATE TABLE courses (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT NOT NULL
        REFERENCES organizations(id) ON DELETE RESTRICT,
    doctor_user_id BIGINT NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_courses_doctor_same_organization
        FOREIGN KEY (doctor_user_id, organization_id)
        REFERENCES users(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT uq_courses_id_organization
        UNIQUE (id, organization_id),

    CONSTRAINT uq_courses_name_per_organization
        UNIQUE (organization_id, name)
);

-- Students can enroll in multiple courses.
CREATE TABLE course_enrollments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT NOT NULL,
    course_id BIGINT NOT NULL,
    student_user_id BIGINT NOT NULL,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_enrollment_course_same_organization
        FOREIGN KEY (course_id, organization_id)
        REFERENCES courses(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_enrollment_student_same_organization
        FOREIGN KEY (student_user_id, organization_id)
        REFERENCES users(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT uq_course_student
        UNIQUE (course_id, student_user_id)
);

-- Lectures, notes and other learning materials.
CREATE TABLE course_materials (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT NOT NULL,
    course_id BIGINT NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    file_url TEXT NOT NULL,
    material_type VARCHAR(30) NOT NULL
        CHECK (material_type IN ('lecture', 'sheet', 'resource')),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_material_course_same_organization
        FOREIGN KEY (course_id, organization_id)
        REFERENCES courses(id, organization_id)
        ON DELETE RESTRICT
);

-- Assignments and their deadlines.
CREATE TABLE assignments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT NOT NULL,
    course_id BIGINT NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    file_url TEXT,
    deadline TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_assignment_course_same_organization
        FOREIGN KEY (course_id, organization_id)
        REFERENCES courses(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT uq_assignments_id_organization
        UNIQUE (id, organization_id)
);

-- Student submissions and optional grades.
CREATE TABLE submissions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id BIGINT NOT NULL,
    assignment_id BIGINT NOT NULL,
    student_user_id BIGINT NOT NULL,
    file_url TEXT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    grade NUMERIC(5,2)
        CHECK (grade IS NULL OR (grade >= 0 AND grade <= 100)),
    feedback TEXT,

    CONSTRAINT fk_submission_student_same_organization
        FOREIGN KEY (student_user_id, organization_id)
        REFERENCES users(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_submission_assignment_same_organization
        FOREIGN KEY (assignment_id, organization_id)
        REFERENCES assignments(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT uq_assignment_student
        UNIQUE (assignment_id, student_user_id)
);

-- Indexes for common lookups.
CREATE INDEX idx_courses_organization
    ON courses(organization_id);

CREATE INDEX idx_courses_doctor
    ON courses(doctor_user_id);

CREATE INDEX idx_enrollments_student
    ON course_enrollments(student_user_id);

CREATE INDEX idx_materials_course
    ON course_materials(course_id);

CREATE INDEX idx_assignments_course_deadline
    ON assignments(course_id, deadline);

CREATE INDEX idx_submissions_student
    ON submissions(student_user_id);

COMMIT;
