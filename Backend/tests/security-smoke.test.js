require("dotenv").config();

const BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";
const PASSWORD = process.env.DEMO_PASSWORD || "Demo123!";

const accounts = {
  doctor1: {
    email: "sally.doctor@example.test",
    organizationId: "1",
    accountType: "organization",
    password: process.env.ORG1_DOCTOR_PASSWORD || PASSWORD
  },
  student1: {
    email: "maya.student@example.test",
    organizationId: "1",
    accountType: "organization",
    password: process.env.ORG1_STUDENT_PASSWORD || PASSWORD
  },
  doctor2: {
    email: "mariam.doctor@example.test",
    organizationId: "2",
    accountType: "organization",
    password: process.env.ORG2_DOCTOR_PASSWORD || PASSWORD
  },
  student2: {
    email: "adam.student@example.test",
    organizationId: "2",
    accountType: "organization",
    password: process.env.ORG2_STUDENT_PASSWORD || PASSWORD
  }
};

let passed = 0;
let failed = 0;
const tokens = {};

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS: ${name}${detail ? " — " + detail : ""}`);
  } else {
    failed++;
    console.error(`FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

async function request(path, options = {}) {
  const headers = {};

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined
      ? undefined
      : JSON.stringify(options.body)
  });

  let data = null;
  try {
    data = await response.json();
  } catch {}

  return { status: response.status, data };
}

async function login(name, account) {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: {
      email: account.email,
      password: account.password,
      accountType: account.accountType,
      organizationId: account.organizationId
    }
  });

  const success =
    result.status === 200 &&
    typeof result.data?.token === "string";

  check(`Login: ${name}`, success, `HTTP ${result.status}`);

  if (success) {
    tokens[name] = result.data.token;
  }

  return success;
}

async function main() {
  console.log(`Testing API: ${BASE_URL}`);
  console.log("Read-only security tests; no database writes.");

  try {
    const health = await request("/api/healthz");
    check("Liveness endpoint does not depend on database", health.status === 200 && health.data?.status === "alive", `HTTP ${health.status}`);
    const readiness = await request("/api/readyz");
    check("Readiness endpoint confirms database connection", readiness.status === 200 && readiness.data?.status === "ready", `HTTP ${readiness.status}`);

    const loggedIn = {
      doctor1: await login("doctor1", accounts.doctor1),
      student1: await login("student1", accounts.student1),
      doctor2: await login("doctor2", accounts.doctor2),
      student2: await login("student2", accounts.student2)
    };

    const missingToken = await request("/api/doctor/dashboard");
    check(
      "Reject missing token",
      missingToken.status === 401,
      `HTTP ${missingToken.status}`
    );

    const invalidToken = await request("/api/doctor/dashboard", {
      token: "invalid-test-token"
    });
    check(
      "Reject invalid token",
      invalidToken.status === 401,
      `HTTP ${invalidToken.status}`
    );

    async function checkCourses(
      accountKey,
      endpoint,
      expectedNames,
      forbiddenNames,
      testName
    ) {
      if (!loggedIn[accountKey]) {
        check(testName, false, "Login failed; cannot verify isolation");
        return;
      }

      const result = await request(endpoint, {
        token: tokens[accountKey]
      });

      const courses = Array.isArray(result.data?.courses)
        ? result.data.courses
        : [];

      const names = courses.map(course => course.name);

      const hasExpected = expectedNames.every(name =>
        names.includes(name)
      );

      const hasNoForeign = forbiddenNames.every(name =>
        !names.includes(name)
      );

      check(
        testName,
        result.status === 200 && hasExpected && hasNoForeign,
        `HTTP ${result.status}; courses: ${names.join(", ") || "(none)"}`
      );
    }

    await checkCourses(
      "doctor1",
      "/api/doctor/courses",
      ["Computer Networks", "Database Systems"],
      ["Web Development", "Cloud Fundamentals"],
      "Org 1 doctor sees only Org 1 courses"
    );

    await checkCourses(
      "doctor2",
      "/api/doctor/courses",
      ["Web Development", "Cloud Fundamentals"],
      ["Computer Networks", "Database Systems"],
      "Org 2 doctor sees only Org 2 courses"
    );

    await checkCourses(
      "student1",
      "/api/student/courses",
      ["Computer Networks", "Database Systems"],
      ["Web Development", "Cloud Fundamentals"],
      "Org 1 student sees only Org 1 courses"
    );

    await checkCourses(
      "student2",
      "/api/student/courses",
      ["Web Development", "Cloud Fundamentals"],
      ["Computer Networks", "Database Systems"],
      "Org 2 student sees only Org 2 courses"
    );

    if (loggedIn.student1) {
      const studentCourses = await request("/api/student/courses", { token: tokens.student1 });
      const firstCourseId = studentCourses.data?.courses?.[0]?.id;
      if (firstCourseId) {
        const detail = await request(`/api/student/courses/${encodeURIComponent(firstCourseId)}`, { token: tokens.student1 });
        check("Student can open an enrolled course detail", detail.status === 200 && detail.data?.course?.id, `HTTP ${detail.status}`);
      }
    }

    if (loggedIn.doctor1) {
      const doctorCourses = await request("/api/doctor/courses", { token: tokens.doctor1 });
      const firstCourseId = doctorCourses.data?.courses?.[0]?.id;
      if (firstCourseId) {
        const roster = await request(`/api/doctor/courses/${encodeURIComponent(firstCourseId)}/students`, { token: tokens.doctor1 });
        check("Doctor can view enrolled students for an owned course", roster.status === 200 && Array.isArray(roster.data?.students), `HTTP ${roster.status}`);
      }
    }

    if (loggedIn.student1) {
      const result = await request("/api/doctor/dashboard", {
        token: tokens.student1
      });

      check(
        "Student cannot access doctor dashboard",
        result.status === 403,
        `HTTP ${result.status}`
      );
    }

    if (loggedIn.doctor1) {
      const result = await request("/api/student/courses", {
        token: tokens.doctor1
      });

      check(
        "Doctor cannot access student courses endpoint",
        result.status === 403,
        `HTTP ${result.status}`
      );
    }

    // Workflow endpoints: read-only checks for role boundaries and organization scoping.
    if (loggedIn.doctor1 && loggedIn.doctor2) {
      const [a1, a2] = await Promise.all([
        request("/api/doctor/assignments", { token: tokens.doctor1 }),
        request("/api/doctor/assignments", { token: tokens.doctor2 })
      ]);
      const org1Names = (a1.data?.assignments || []).map(x => x.course_name);
      const org2Names = (a2.data?.assignments || []).map(x => x.course_name);
      check("Doctor assignments endpoint returns a list", a1.status === 200 && Array.isArray(a1.data?.assignments), `HTTP ${a1.status}`);
      check("Doctor assignment list is organization-scoped", a2.status === 200 && !org2Names.some(n => ["Computer Networks", "Database Systems"].includes(n)) && !org1Names.some(n => ["Web Development", "Cloud Fundamentals"].includes(n)), `Org 1 rows: ${org1Names.length}; Org 2 rows: ${org2Names.length}`);
      const doctorSubmissions = await request("/api/doctor/submissions", { token: tokens.doctor1 });
      check("Doctor submissions endpoint returns a list", doctorSubmissions.status === 200 && Array.isArray(doctorSubmissions.data?.submissions), `HTTP ${doctorSubmissions.status}`);
    }

    if (loggedIn.student1) {
      const assignments = await request("/api/student/assignments", { token: tokens.student1 });
      check("Student assignments endpoint returns a list", assignments.status === 200 && Array.isArray(assignments.data?.assignments), `HTTP ${assignments.status}`);
      const forbidden = await request("/api/doctor/assignments", { token: tokens.student1 });
      check("Student cannot access doctor assignments", forbidden.status === 403, `HTTP ${forbidden.status}`);
    }

    if (loggedIn.doctor1) {
      const forbidden = await request("/api/student/assignments", { token: tokens.doctor1 });
      check("Doctor cannot access student assignments endpoint", forbidden.status === 403, `HTTP ${forbidden.status}`);
    }

    if (loggedIn.student1) {
      const forbiddenSubmissions = await request("/api/doctor/submissions", { token: tokens.student1 });
      check("Student cannot access doctor submissions", forbiddenSubmissions.status === 403, `HTTP ${forbiddenSubmissions.status}`);
      const invalidUrl = await request("/api/student/assignments/1/submissions", {
        method: "POST", token: tokens.student1, body: { fileUrl: "javascript:alert(1)" }
      });
      check("Reject non-HTTP submission URLs", invalidUrl.status === 400, `HTTP ${invalidUrl.status}`);
    }

    if (loggedIn.doctor1) {
      const forbiddenAdmin = await request("/api/admin/overview", { token: tokens.doctor1 });
      check("Doctor cannot access organization admin overview", forbiddenAdmin.status === 403, `HTTP ${forbiddenAdmin.status}`);
      const invalidGrade = await request("/api/doctor/submissions/1/grade", {
        method: "PATCH", token: tokens.doctor1, body: { grade: 101, feedback: "invalid-grade-test" }
      });
      check("Reject grades outside 0–100", invalidGrade.status === 400, `HTTP ${invalidGrade.status}`);
    }
  } catch (error) {
    failed++;
    console.error("Test execution error:", error.message);
  }

  console.log("\n========== TEST RESULTS ==========");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("==================================");

  process.exitCode = failed === 0 ? 0 : 1;
}

main();
