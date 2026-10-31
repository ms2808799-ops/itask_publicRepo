require("dotenv").config();

const cors = require("cors");
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Local development origins plus explicitly configured hosted origins.
const allowedOrigins = new Set([
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    ...(process.env.FRONTEND_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean)
]);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(new Error("Origin is not allowed by CORS."));
    }
}));

app.disable("x-powered-by");

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
});

app.use(express.json({ limit: "8mb" }));
const uploadsDirectory = path.join(__dirname, "uploads");
app.use("/uploads", express.static(uploadsDirectory, { fallthrough: false, index: false }));

const EMAIL_MAX_LENGTH = 254;

function isHttpUrl(value, maxLength = 2000) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) return false;
    try {
        const parsed = new URL(value.trim());
        return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
        return false;
    }
}

// PostgreSQL connection pool
const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "itask_main_db",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
    idleTimeoutMillis: 30000,
    max: Number(process.env.DB_POOL_MAX || 10),
    keepAlive: true,
});

pool.on("error", (error) => {
    console.error("Unexpected idle PostgreSQL client error:", error.message);
});

// ==========================================
// Authentication Middleware
// ==========================================

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

    if (!token) {
        return res.status(401).json({
            message: "Access token is required.",
        });
    }

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET, {
            issuer: "itask-api",
            audience: "itask-frontend"
        });
        next();
    } catch (error) {
        return res.status(401).json({
            message: "Invalid or expired token.",
        });
    }
}

// ==========================================
// Authorization Middleware
// ==========================================

function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        // Only organization accounts can use these roles
        if (req.user.accountType !== "organization") {
            return res.status(403).json({
                message: "Access denied.",
            });
        }

        // Check whether the user's role is allowed
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                message: "You do not have permission to access this resource.",
            });
        }

        next();
    };
}

// ==========================================
// General Routes
// ==========================================

// Test the server
app.get("/", (req, res) => {
    res.send("iTask Backend is running!");
});

// Lightweight health endpoint for local checks and future container orchestration.
app.get("/api/readyz", async (req, res) => {
    try {
        const result = await pool.query("SELECT current_database() AS database, 1 AS ready");
        const expectedDatabase = process.env.DB_NAME || "itask_main_db";
        if (result.rows[0].database !== expectedDatabase) {
            return res.status(503).json({ status: "not_ready", service: "itask-api", database: "misconfigured" });
        }
        return res.status(200).json({ status: "ready", service: "itask-api", database: "connected" });
    } catch (error) {
        console.error("Readiness check failed:", error.message);
        return res.status(503).json({ status: "not_ready", service: "itask-api", database: "unavailable" });
    }
});

// Live endpoint
// API discovery endpoint. The root is informational; readiness is checked at /api/readyz.
app.get("/api", (req, res) => {
    res.json({
        service: "itask-api",
        status: "running",
        health: "/api/healthz",
        readiness: "/api/readyz",
        documentation: "See README_LOCAL_RUN.md for local API usage."
    });
});

app.get("/api/healthz", (req, res) => {
    res.status(200).json({
        status: "alive",
        service: "itask-api"
    });
});

// Test the database connection
app.get("/api/db-test", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT current_database() AS database"
        );

        res.json({
            message: "Database connection successful!",
            database: result.rows[0].database,
        });
    } catch (error) {
        console.error("Database connection failed:", error.message);

        res.status(500).json({
            message: "Database connection failed.",
        });
    }
});

// ==========================================
// Login API
// ==========================================

app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password, accountType, organizationId } = req.body || {};

        if (typeof email !== "string" || !email.trim() || email.trim().length > EMAIL_MAX_LENGTH ||
            typeof password !== "string" || !password || password.length > 1024 ||
            !["organization", "platform_admin"].includes(accountType)) {
            return res.status(400).json({
                message: "Email, password, and account type are required.",
            });
        }

        let result;
        let user;

        if (accountType === "platform_admin") {
            result = await pool.query(
                `SELECT id, full_name, email, password_hash
                 FROM platform_admins
                 WHERE email = $1`,
                [email.trim().toLowerCase()]
            );

            if (result.rowCount !== 1) {
                return res.status(401).json({
                    message: "Invalid email or password.",
                });
            }

            user = {
                ...result.rows[0],
                accountType: "platform_admin",
            };
        } else if (accountType === "organization") {
            if (!organizationId) {
                return res.status(400).json({
                    message: "Organization ID is required.",
                });
            }

            result = await pool.query(
                `SELECT id, organization_id, full_name,
                        email, password_hash, role
                 FROM users
                 WHERE email = $1
                   AND organization_id = $2`,
                [email.trim().toLowerCase(), organizationId]
            );

            if (result.rowCount !== 1) {
                return res.status(401).json({
                    message: "Invalid email or password.",
                });
            }

            user = {
                ...result.rows[0],
                accountType: "organization",
            };
        } else {
            return res.status(400).json({
                message: "Invalid account type.",
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                message: "Invalid email or password.",
            });
        }

        const tokenPayload = {
            sub: String(user.id),
            accountType: user.accountType,
        };

        if (user.accountType === "organization") {
            tokenPayload.organizationId = String(user.organization_id);
            tokenPayload.role = user.role;
        }

        if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
            console.error("JWT_SECRET must be configured with at least 32 characters.");
            return res.status(500).json({
                message: "Authentication is not configured on this server."
            });
        }

        const token = jwt.sign(
            tokenPayload,
            process.env.JWT_SECRET,
            {
                expiresIn: "1h",
                issuer: "itask-api",
                audience: "itask-frontend"
            }
        );

        // Never send the password hash to the client
        delete user.password_hash;

        return res.json({
            message: "Login successful.",
            token,
            user,
        });
    } catch (error) {
        console.error("Login error:", error.message);

        return res.status(500).json({
            message: "Internal server error.",
        });
    }
});

// ==========================================
// Authenticated User Route
// ==========================================

app.get("/api/auth/me", authenticateToken, (req, res) => {
    res.json({
        message: "Authenticated successfully.",
        user: req.user,
    });
});

// ==========================================
// Doctor Dashboard - Doctors Only
// ==========================================

app.get(
    "/api/doctor/dashboard",
    authenticateToken,
    authorizeRoles("doctor"),
    (req, res) => {
        res.json({
            message: "Welcome to the doctor dashboard.",
            user: req.user,
        });
    }
);

// ==========================================
// Doctor Courses - Own Organization Only
// ==========================================

app.get(
    "/api/doctor/courses",
    authenticateToken,
    authorizeRoles("doctor"),
    async (req, res) => {
        try {
            const doctorId = req.user.sub;
            const organizationId = req.user.organizationId;

            const result = await pool.query(
                `SELECT
                    id,
                    name,
                    description,
                    created_at,
                    (SELECT COUNT(*)::int FROM course_enrollments ce
                     WHERE ce.course_id = courses.id AND ce.organization_id = courses.organization_id) AS enrolled_students
                 FROM courses
                 WHERE doctor_user_id = $1
                   AND organization_id = $2
                 ORDER BY id`,
                [doctorId, organizationId]
            );

            return res.json({
                message: "Courses retrieved successfully.",
                courses: result.rows,
            });
        } catch (error) {
            console.error("Doctor courses error:", error.message);

            return res.status(500).json({
                message: "Internal server error.",
            });
        }
    }
);

// ==========================================
// Student Courses - Enrolled Courses Only
// ==========================================

app.get(
    "/api/student/courses",
    authenticateToken,
    authorizeRoles("student"),
    async (req, res) => {
        try {
            const studentId = req.user.sub;
            const organizationId = req.user.organizationId;

            const result = await pool.query(
                `SELECT
                    c.id,
                    c.name,
                    c.description,
                    c.doctor_user_id,
                    doctor.full_name AS doctor_name,
                    ce.enrolled_at
                 FROM course_enrollments AS ce
                 JOIN courses AS c
                   ON c.id = ce.course_id
                  AND c.organization_id = ce.organization_id
                 JOIN users AS doctor
                   ON doctor.id = c.doctor_user_id
                  AND doctor.organization_id = c.organization_id
                 WHERE ce.student_user_id = $1
                   AND ce.organization_id = $2
                 ORDER BY c.id`,
                [studentId, organizationId]
            );

            return res.json({
                message: "Courses retrieved successfully.",
                courses: result.rows,
            });
        } catch (error) {
            console.error("Student courses error:", error.message);

            return res.status(500).json({
                message: "Internal server error.",
            });
        }
    }
);

// Student: details, instructor, learning materials and assignment state for one enrolled course.
app.get("/api/student/courses/:courseId", authenticateToken, authorizeRoles("student"), async (req, res) => {
    try {
        const courseId = Number(req.params.courseId);
        if (!Number.isSafeInteger(courseId) || courseId <= 0) return res.status(400).json({ message: "Invalid course id." });
        const { organizationId, userId } = organizationContext(req);
        const courseResult = await pool.query(
            `SELECT c.id, c.name, c.description, u.full_name AS doctor_name
             FROM course_enrollments ce
             JOIN courses c ON c.id = ce.course_id AND c.organization_id = ce.organization_id
             JOIN users u ON u.id = c.doctor_user_id AND u.organization_id = c.organization_id
             WHERE ce.course_id = $1 AND ce.student_user_id = $2 AND ce.organization_id = $3`,
            [courseId, userId, organizationId]
        );
        if (!courseResult.rowCount) return res.status(404).json({ message: "Course not found in your enrollments." });
        const [materials, assignments] = await Promise.all([
            pool.query(`SELECT id, title, description, file_url, material_type, uploaded_at
                        FROM course_materials WHERE course_id = $1 AND organization_id = $2 ORDER BY uploaded_at DESC`, [courseId, organizationId]),
            pool.query(`SELECT a.id, a.title, a.description, a.file_url, a.deadline,
                               s.id IS NOT NULL AS submitted, s.file_url AS submission_file_url,
                               s.submitted_at, s.grade, s.feedback
                        FROM assignments a
                        LEFT JOIN submissions s ON s.assignment_id = a.id
                             AND s.student_user_id = $2 AND s.organization_id = a.organization_id
                        WHERE a.course_id = $1 AND a.organization_id = $3
                        ORDER BY a.deadline ASC`, [courseId, userId, organizationId])
        ]);
        return res.json({ course: courseResult.rows[0], materials: materials.rows, assignments: assignments.rows });
    } catch (error) {
        console.error("Student course detail error:", error.message);
        return res.status(500).json({ message: "Could not retrieve course details." });
    }
});

// Doctor: add a learning resource/book link to a course they own.
app.post("/api/doctor/courses/:courseId/materials", authenticateToken, authorizeRoles("doctor"), async (req, res) => {
    try {
        const courseId = Number(req.params.courseId);
        const { organizationId, userId } = organizationContext(req);
        const { title, description = null, fileUrl, materialType = "resource" } = req.body || {};
        if (!Number.isSafeInteger(courseId) || courseId <= 0 || typeof title !== "string" || !title.trim() || title.trim().length > 200 ||
            !isHttpUrl(fileUrl) || !["lecture", "sheet", "resource"].includes(materialType)) {
            return res.status(400).json({ message: "A valid title, HTTP(S) file URL, and material type are required." });
        }
        const result = await pool.query(
            `INSERT INTO course_materials (organization_id, course_id, title, description, file_url, material_type)
             SELECT $1, c.id, $4, $5, $6, $7 FROM courses c
             WHERE c.id = $2 AND c.organization_id = $1 AND c.doctor_user_id = $3
             RETURNING id, course_id, title, description, file_url, material_type, uploaded_at`,
            [organizationId, courseId, userId, title.trim(), typeof description === "string" ? description.trim().slice(0, 2000) : null, fileUrl.trim(), materialType]
        );
        if (!result.rowCount) return res.status(404).json({ message: "Course not found or not assigned to you." });
        return res.status(201).json({ material: result.rows[0] });
    } catch (error) {
        console.error("Doctor course material error:", error.message);
        return res.status(500).json({ message: "Could not add course material." });
    }
});

// Doctor: students enrolled in a course owned by the signed-in doctor.
app.get("/api/doctor/courses/:courseId/students", authenticateToken, authorizeRoles("doctor"), async (req, res) => {
    try {
        const courseId = Number(req.params.courseId);
        if (!Number.isSafeInteger(courseId) || courseId <= 0) return res.status(400).json({ message: "Invalid course id." });
        const { organizationId, userId } = organizationContext(req);
        const result = await pool.query(
            `SELECT c.id AS course_id, c.name AS course_name, u.id AS student_id,
                    u.full_name AS student_name, u.email, ce.enrolled_at,
                    COUNT(DISTINCT a.id)::int AS assignments_count,
                    COUNT(DISTINCT s.assignment_id)::int AS submitted_count
             FROM courses c
             JOIN course_enrollments ce ON ce.course_id = c.id AND ce.organization_id = c.organization_id
             JOIN users u ON u.id = ce.student_user_id AND u.organization_id = ce.organization_id
             LEFT JOIN assignments a ON a.course_id = c.id AND a.organization_id = c.organization_id
             LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_user_id = u.id AND s.organization_id = c.organization_id
             WHERE c.id = $1 AND c.organization_id = $2 AND c.doctor_user_id = $3
             GROUP BY c.id, c.name, u.id, u.full_name, u.email, ce.enrolled_at
             ORDER BY u.full_name`, [courseId, organizationId, userId]);
        if (!result.rowCount) {
            const owned = await pool.query("SELECT 1 FROM courses WHERE id = $1 AND organization_id = $2 AND doctor_user_id = $3", [courseId, organizationId, userId]);
            if (!owned.rowCount) return res.status(404).json({ message: "Course not found." });
        }
        return res.json({ students: result.rows });
    } catch (error) {
        console.error("Doctor course roster error:", error.message);
        return res.status(500).json({ message: "Could not retrieve course students." });
    }
});

// ==========================================
// Assignments, submissions and grading
// ==========================================

function organizationContext(req) {
    return {
        organizationId: req.user.organizationId,
        userId: req.user.sub
    };
}

// Doctor: list assignments for courses assigned to this doctor.
app.get("/api/doctor/assignments", authenticateToken, authorizeRoles("doctor"), async (req, res) => {
    try {
        const { organizationId, userId } = organizationContext(req);
        const result = await pool.query(
            `SELECT a.id, a.course_id, c.name AS course_name, a.title,
                    a.description, a.file_url, a.deadline, a.created_at,
                    COUNT(s.id)::int AS submission_count,
                    COUNT(s.id) FILTER (WHERE s.grade IS NULL)::int AS ungraded_count
             FROM assignments a
             JOIN courses c ON c.id = a.course_id
                            AND c.organization_id = a.organization_id
             LEFT JOIN submissions s ON s.assignment_id = a.id
                                    AND s.organization_id = a.organization_id
             WHERE a.organization_id = $1 AND c.doctor_user_id = $2
             GROUP BY a.id, c.name
             ORDER BY a.deadline ASC, a.id DESC`,
            [organizationId, userId]
        );

        res.json({ assignments: result.rows });
    } catch (error) {
        console.error("Doctor assignments error:", error.message);
        res.status(500).json({ message: "Could not retrieve assignments." });
    }
});

// Doctor: create an assignment only for a course they own.
app.post("/api/doctor/assignments", authenticateToken, authorizeRoles("doctor"), async (req, res) => {
    try {
        const { organizationId, userId } = organizationContext(req);
        const { courseId, title, description = null, fileUrl = null, deadline } = req.body || {};

        if (!courseId || !Number.isInteger(Number(courseId)) ||
            !title || typeof title !== "string" || !title.trim() ||
            title.trim().length > 200 || !deadline || Number.isNaN(Date.parse(deadline)) ||
            (description !== null && description !== undefined && (typeof description !== "string" || description.length > 5000)) ||
            (fileUrl !== null && fileUrl !== undefined && fileUrl !== "" && !isHttpUrl(fileUrl))) {
            return res.status(400).json({ message: "A valid courseId, title (max 200 characters), and deadline are required." });
        }

        const course = await pool.query(
            `SELECT id FROM courses
             WHERE id = $1 AND organization_id = $2 AND doctor_user_id = $3`,
            [Number(courseId), organizationId, userId]
        );

        if (!course.rowCount) {
            return res.status(404).json({ message: "Course not found for this doctor." });
        }

        const result = await pool.query(
            `INSERT INTO assignments
                (organization_id, course_id, title, description, file_url, deadline)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, course_id, title, description, file_url, deadline, created_at`,
            [organizationId, Number(courseId), title.trim(),
             typeof description === "string" ? description.trim() : null,
             typeof fileUrl === "string" && fileUrl.trim() ? fileUrl.trim() : null,
             new Date(deadline).toISOString()]
        );

        res.status(201).json({ message: "Assignment created.", assignment: result.rows[0] });
    } catch (error) {
        console.error("Create assignment error:", error.message);
        res.status(500).json({ message: "Could not create assignment." });
    }
});

// Doctor: submissions for their own assignments, optionally filtered by assignment.
app.get("/api/doctor/submissions", authenticateToken, authorizeRoles("doctor"), async (req, res) => {
    try {
        const { organizationId, userId } = organizationContext(req);
        const params = [organizationId, userId];
        let assignmentFilter = "";

        if (req.query.assignmentId !== undefined) {
            if (!Number.isInteger(Number(req.query.assignmentId))) {
                return res.status(400).json({ message: "assignmentId must be an integer." });
            }

            params.push(Number(req.query.assignmentId));
            assignmentFilter = ` AND a.id = $3`;
        }

        const result = await pool.query(
            `SELECT s.id AS submission_id, s.assignment_id, a.title AS assignment_title,
                    a.deadline, s.student_user_id, u.full_name AS student_name,
                    u.email AS student_email, s.file_url, s.submitted_at,
                    s.grade, s.feedback, c.name AS course_name
             FROM submissions s
             JOIN assignments a ON a.id = s.assignment_id
                                AND a.organization_id = s.organization_id
             JOIN courses c ON c.id = a.course_id
                            AND c.organization_id = a.organization_id
             JOIN users u ON u.id = s.student_user_id
                          AND u.organization_id = s.organization_id
             WHERE s.organization_id = $1 AND c.doctor_user_id = $2${assignmentFilter}
             ORDER BY s.grade NULLS FIRST, s.submitted_at DESC`,
            params
        );

        res.json({ submissions: result.rows });
    } catch (error) {
        console.error("Doctor submissions error:", error.message);
        res.status(500).json({ message: "Could not retrieve submissions." });
    }
});

// Doctor: grade a submission belonging to one of their assignments.
app.patch("/api/doctor/submissions/:submissionId/grade", authenticateToken, authorizeRoles("doctor"), async (req, res) => {
    try {
        const { organizationId, userId } = organizationContext(req);
        const submissionId = Number(req.params.submissionId);
        const { grade, feedback = null } = req.body || {};

        if (!Number.isInteger(submissionId) || submissionId < 1 ||
            grade === undefined || grade === null || grade === "" ||
            !Number.isFinite(Number(grade)) || Number(grade) < 0 || Number(grade) > 100 ||
            (feedback !== null && feedback !== undefined && (typeof feedback !== "string" || feedback.length > 5000))) {
            return res.status(400).json({ message: "A grade between 0 and 100 is required." });
        }

        const result = await pool.query(
            `UPDATE submissions s
             SET grade = $1, feedback = $2
             FROM assignments a
             JOIN courses c ON c.id = a.course_id AND c.organization_id = a.organization_id
             WHERE s.id = $3
               AND s.assignment_id = a.id
               AND s.organization_id = a.organization_id
               AND s.organization_id = $4
               AND c.doctor_user_id = $5
             RETURNING s.id AS submission_id, s.grade, s.feedback, s.submitted_at`,
            [Number(grade), typeof feedback === "string" ? feedback.trim() : null,
             submissionId, organizationId, userId]
        );

        if (!result.rowCount) {
            return res.status(404).json({ message: "Submission not found for this doctor." });
        }

        res.json({ message: "Grade saved.", submission: result.rows[0] });
    } catch (error) {
        console.error("Grade submission error:", error.message);
        res.status(500).json({ message: "Could not save grade." });
    }
});

// Student: list assignments only for courses they are enrolled in, with submission state.
app.get("/api/student/assignments", authenticateToken, authorizeRoles("student"), async (req, res) => {
    try {
        const { organizationId, userId } = organizationContext(req);
        const result = await pool.query(
            `SELECT a.id, a.course_id, c.name AS course_name, a.title,
                    a.description, a.file_url, a.deadline, a.created_at,
                    s.id AS submission_id, s.file_url AS submission_file_url,
                    s.submitted_at, s.grade, s.feedback
             FROM course_enrollments ce
             JOIN courses c ON c.id = ce.course_id AND c.organization_id = ce.organization_id
             JOIN assignments a ON a.course_id = c.id AND a.organization_id = c.organization_id
             LEFT JOIN submissions s ON s.assignment_id = a.id
                                    AND s.student_user_id = ce.student_user_id
                                    AND s.organization_id = ce.organization_id
             WHERE ce.student_user_id = $1 AND ce.organization_id = $2
             ORDER BY a.deadline ASC, a.id DESC`,
            [userId, organizationId]
        );

        res.json({ assignments: result.rows });
    } catch (error) {
        console.error("Student assignments error:", error.message);
        res.status(500).json({ message: "Could not retrieve assignments." });
    }
});

// Student: submit or replace their submission before the deadline.
app.post("/api/student/assignments/:assignmentId/submissions", authenticateToken, authorizeRoles("student"), async (req, res) => {
    try {
        const { organizationId, userId } = organizationContext(req);
        const assignmentId = Number(req.params.assignmentId);
        const { fileUrl, fileData, fileName } = req.body || {};
        let storedFileUrl = null;

        if (!Number.isInteger(assignmentId) || assignmentId < 1) {
            return res.status(400).json({ message: "A valid assignmentId is required." });
        }
        if (typeof fileData === "string") {
            const match = fileData.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/);
            if (!match) return res.status(400).json({ message: "Please upload a valid PDF file." });
            const buffer = Buffer.from(match[1], "base64");
            if (!buffer.length || buffer.length > 5 * 1024 * 1024 || buffer.subarray(0, 5).toString() !== "%PDF-") {
                return res.status(400).json({ message: "PDF must be valid and no larger than 5 MB." });
            }
            await fs.promises.mkdir(path.join(uploadsDirectory, "submissions"), { recursive: true });
            const safeName = `${crypto.randomUUID()}.pdf`;
            await fs.promises.writeFile(path.join(uploadsDirectory, "submissions", safeName), buffer, { flag: "wx" });
            storedFileUrl = `/uploads/submissions/${safeName}`;
        } else if (isHttpUrl(fileUrl, 2000)) {
            storedFileUrl = fileUrl.trim();
        } else {
            return res.status(400).json({ message: "Upload a PDF solution (max 5 MB) or provide a valid HTTP(S) link." });
        }

        const assignment = await pool.query(
            `SELECT a.id, a.deadline
             FROM assignments a
             JOIN course_enrollments ce ON ce.course_id = a.course_id
                                      AND ce.organization_id = a.organization_id
             WHERE a.id = $1 AND a.organization_id = $2
               AND ce.student_user_id = $3`,
            [assignmentId, organizationId, userId]
        );

        if (!assignment.rowCount) {
            return res.status(404).json({ message: "Assignment not found in your enrolled courses." });
        }

        if (new Date(assignment.rows[0].deadline).getTime() < Date.now()) {
            return res.status(409).json({ message: "The deadline has passed; submission is closed." });
        }

        const result = await pool.query(
            `INSERT INTO submissions (organization_id, assignment_id, student_user_id, file_url)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (assignment_id, student_user_id)
             DO UPDATE SET file_url = EXCLUDED.file_url,
                           submitted_at = NOW(), grade = NULL, feedback = NULL
             RETURNING id AS submission_id, assignment_id, file_url, submitted_at, grade, feedback`,
            [organizationId, assignmentId, userId, storedFileUrl]
        );

        res.status(201).json({ message: "Submission saved.", submission: result.rows[0] });
    } catch (error) {
        console.error("Student submission error:", error.message);
        res.status(500).json({ message: "Could not save submission." });
    }
});

// Organization admin: overview is restricted to their organization.
app.get("/api/admin/overview", authenticateToken, authorizeRoles("admin"), async (req, res) => {
    try {
        const organizationId = req.user.organizationId;
        const result = await pool.query(
            `SELECT
                (SELECT COUNT(*)::int FROM users WHERE organization_id = $1) AS users_count,
                (SELECT COUNT(*)::int FROM users WHERE organization_id = $1 AND role = 'student') AS students_count,
                (SELECT COUNT(*)::int FROM users WHERE organization_id = $1 AND role = 'doctor') AS doctors_count,
                (SELECT COUNT(*)::int FROM courses WHERE organization_id = $1) AS courses_count,
                (SELECT COUNT(*)::int FROM assignments WHERE organization_id = $1) AS assignments_count,
                (SELECT COUNT(*)::int FROM submissions WHERE organization_id = $1) AS submissions_count,
                (SELECT COUNT(*)::int FROM submissions WHERE organization_id = $1 AND grade IS NULL) AS ungraded_count`,
            [organizationId]
        );

        res.json({ overview: result.rows[0] });
    } catch (error) {
        console.error("Admin overview error:", error.message);
        res.status(500).json({ message: "Could not retrieve organization overview." });
    }
});

app.get("/api/admin/courses", authenticateToken, authorizeRoles("admin"), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id, c.name, c.description, c.created_at, u.full_name AS doctor_name,
                    COUNT(DISTINCT ce.student_user_id)::int AS enrolled_students,
                    COUNT(DISTINCT a.id)::int AS assignments_count,
                    COALESCE(json_agg(DISTINCT jsonb_build_object('id', student.id, 'name', student.full_name, 'email', student.email))
                        FILTER (WHERE student.id IS NOT NULL), '[]'::json) AS students
             FROM courses c
             JOIN users u ON u.id = c.doctor_user_id AND u.organization_id = c.organization_id
             LEFT JOIN course_enrollments ce ON ce.course_id = c.id AND ce.organization_id = c.organization_id
             LEFT JOIN users student ON student.id = ce.student_user_id AND student.organization_id = ce.organization_id
             LEFT JOIN assignments a ON a.course_id = c.id AND a.organization_id = c.organization_id
             WHERE c.organization_id = $1
             GROUP BY c.id, u.full_name
             ORDER BY c.name`,
            [req.user.organizationId]
        );

        res.json({ courses: result.rows });
    } catch (error) {
        console.error("Admin courses error:", error.message);
        res.status(500).json({ message: "Could not retrieve courses." });
    }
});

app.get("/api/admin/users", authenticateToken, authorizeRoles("admin"), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, full_name, email, role, created_at
             FROM users WHERE organization_id = $1
             ORDER BY role, full_name`,
            [req.user.organizationId]
        );

        res.json({ users: result.rows });
    } catch (error) {
        console.error("Admin users error:", error.message);
        res.status(500).json({ message: "Could not retrieve users." });
    }
});

// Branding is readable only by signed-in members of their own organization.
app.get("/api/organization/branding", authenticateToken, async (req, res) => {
    if (!req.user.organizationId) {
        return res.status(403).json({ message: "An organization-linked account is required." });
    }

    try {
        const result = await pool.query(
            `SELECT id, name, primary_color, logo_data_url FROM organizations WHERE id = $1`,
            [req.user.organizationId]
        );

        if (!result.rowCount) {
            return res.status(404).json({ message: "Organization not found." });
        }

        return res.json({ branding: result.rows[0] });
    } catch (error) {
        console.error("Organization branding read error:", error.message);
        return res.status(500).json({ message: "Could not retrieve organization branding." });
    }
});

// Organization settings are always scoped to the organization ID in the verified token.
app.get("/api/admin/settings", authenticateToken, authorizeRoles("admin"), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, type, primary_color, logo_data_url
             FROM organizations WHERE id = $1`,
            [req.user.organizationId]
        );

        if (result.rowCount !== 1) {
            return res.status(404).json({ message: "Organization not found." });
        }

        return res.json({ settings: result.rows[0] });
    } catch (error) {
        console.error("Organization settings read error:", error.message);
        return res.status(500).json({ message: "Could not retrieve organization settings." });
    }
});

app.patch("/api/admin/settings", authenticateToken, authorizeRoles("admin"), async (req, res) => {
    try {
        const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
        const primaryColor = typeof req.body?.primary_color === "string" ? req.body.primary_color.trim() : "";
        const logoDataUrl = req.body?.logo_data_url;

        if (!name || name.length > 200) {
            return res.status(400).json({ message: "Organization name must be between 1 and 200 characters." });
        }

        if (!/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
            return res.status(400).json({ message: "Primary color must be a six-digit hex color, such as #1E3ABA." });
        }

        if (logoDataUrl !== undefined && logoDataUrl !== null && logoDataUrl !== "" &&
            (typeof logoDataUrl !== "string" || logoDataUrl.length > 900000 ||
             !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(logoDataUrl))) {
            return res.status(400).json({ message: "Logo must be a PNG, JPG, or WebP image smaller than about 650 KB." });
        }

        const result = await pool.query(
            `UPDATE organizations SET name = $1, primary_color = $2,
             logo_data_url = CASE WHEN $3::boolean THEN NULLIF($4, '') ELSE logo_data_url END
             WHERE id = $5 RETURNING id, name, type, primary_color, logo_data_url`,
            [name, primaryColor.toUpperCase(), logoDataUrl !== undefined, logoDataUrl || null, req.user.organizationId]
        );

        if (result.rowCount !== 1) {
            return res.status(404).json({ message: "Organization not found." });
        }

        return res.json({ message: "Organization settings saved.", settings: result.rows[0] });
    } catch (error) {
        console.error("Organization settings update error:", error.message);
        return res.status(500).json({ message: "Could not save organization settings." });
    }
});

// Consistent API errors for malformed JSON and rejected browser origins.
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
        return res.status(400).json({ message: "Request body contains invalid JSON." });
    }

    if (error.message === "Origin is not allowed by CORS.") {
        return res.status(403).json({ message: "This origin is not allowed to access the API." });
    }

    console.error("Unhandled request error:", error.message);
    return res.status(500).json({ message: "Internal server error." });
});

// ==========================================
// Start Server
// ==========================================

const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`iTask API listening on port ${PORT}`);
});

async function shutdown(signal) {
    console.log(`${signal} received; shutting down iTask API.`);
    server.close(async () => {
        try { await pool.end(); } catch (error) { console.error("PostgreSQL pool shutdown error:", error.message); }
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));