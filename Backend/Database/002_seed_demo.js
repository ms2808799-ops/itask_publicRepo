require("dotenv").config();

const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

const DEMO_PASSWORD = "Demo123!";

async function seedDemoData() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // 1. Hash the demo password
        const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

        // 2. Create the Platform Admin
        await client.query(
            `INSERT INTO platform_admins (full_name, email, password_hash)
             VALUES ($1, $2, $3)
             ON CONFLICT (email) DO NOTHING`,
            [
                "Platform Administrator",
                "platform.admin@example.test",
                passwordHash,
            ]
        );

        // 3. Define demo organizations and their users
        const organizations = [
            {
                name: "Nile Academic Institute",
                type: "academic",
                admin: {
                    name: "Kareem Khaled",
                    email: "kareem.admin@example.test",
                },
                doctor: {
                    name: "Sally Mohamed",
                    email: "sally.doctor@example.test",
                },
                student: {
                    name: "Maya Adel",
                    email: "maya.student@example.test",
                },
                courses: [
                    "Computer Networks",
                    "Database Systems",
                ],
            },
            {
                name: "Horizon Training Center",
                type: "non_academic",
                admin: {
                    name: "Mahmoud Salem",
                    email: "mahmoud.admin@example.test",
                },
                doctor: {
                    name: "Mariam Hassan",
                    email: "mariam.doctor@example.test",
                },
                student: {
                    name: "Adam Mostafa",
                    email: "adam.student@example.test",
                },
                courses: [
                    "Web Development",
                    "Cloud Fundamentals",
                ],
            },
        ];

        for (const orgData of organizations) {
            // Create or find organization
            await client.query(
                `INSERT INTO organizations (name, type)
                 VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [orgData.name, orgData.type]
            );

            const orgResult = await client.query(
                `SELECT id
                 FROM organizations
                 WHERE name = $1 AND type = $2`,
                [orgData.name, orgData.type]
            );
            console.log("DEBUG organization:", orgData.name);
            console.log("DEBUG organization type:", orgData.type);
            console.log("DEBUG rowCount:", orgResult.rowCount);
            console.log("DEBUG rows:", orgResult.rows);

            const dbInfo = await client.query(`
                SELECT current_database() AS database,
                    current_user AS db_user,
                    inet_server_addr() AS server_address,
                    inet_server_port() AS server_port
            `);

            console.log("DEBUG DB connection:", dbInfo.rows[0]);
            if (orgResult.rowCount !== 1) {
                throw new Error(
                    `Could not uniquely identify organization: ${orgData.name}`
                );
            }

            const organizationId = orgResult.rows[0].id;

            // Create or find organization users
            async function getOrCreateUser(userData, role) {
                await client.query(
                    `INSERT INTO users
                        (organization_id, full_name, email, password_hash, role)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (organization_id, email) DO NOTHING`,
                    [
                        organizationId,
                        userData.name,
                        userData.email,
                        passwordHash,
                        role,
                    ]
                );

                const result = await client.query(
                    `SELECT id, role
                     FROM users
                     WHERE organization_id = $1 AND email = $2`,
                    [organizationId, userData.email]
                );

                if (
                    result.rowCount !== 1 ||
                    result.rows[0].role !== role
                ) {
                    throw new Error(
                        `User ${userData.email} is missing or has an unexpected role`
                    );
                }

                return result.rows[0].id;
            }

            const adminId = await getOrCreateUser(
                orgData.admin,
                "admin"
            );

            const doctorId = await getOrCreateUser(
                orgData.doctor,
                "doctor"
            );

            const studentId = await getOrCreateUser(
                orgData.student,
                "student"
            );

            // 4. Create courses and enroll the student
            for (const courseName of orgData.courses) {
                await client.query(
                    `INSERT INTO courses
                        (organization_id, doctor_user_id, name)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (organization_id, name) DO NOTHING`,
                    [organizationId, doctorId, courseName]
                );

                const courseResult = await client.query(
                    `SELECT id, doctor_user_id
                     FROM courses
                     WHERE organization_id = $1 AND name = $2`,
                    [organizationId, courseName]
                );

                if (
                    courseResult.rowCount !== 1 ||
                    String(courseResult.rows[0].doctor_user_id) !==
                        String(doctorId)
                ) {
                    throw new Error(
                        `Course ${courseName} is not assigned to the expected doctor`
                    );
                }

                const courseId = courseResult.rows[0].id;

                await client.query(
                    `INSERT INTO course_enrollments
                        (organization_id, course_id, student_user_id)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (course_id, student_user_id) DO NOTHING`,
                    [organizationId, courseId, studentId]
                );
            }

            console.log(
                `Seeded: ${orgData.name} (admin ID: ${adminId})`
            );
        }

        await client.query("COMMIT");
        console.log("Demo data seeded successfully!");
        console.log("Demo data seeded. Demo credentials are documented in the project setup notes.");
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Seed failed:", error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

seedDemoData();
