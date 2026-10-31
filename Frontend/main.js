// ==========================================
// Registration Form
// ==========================================

const registerForm = document.getElementById("registerForm");

if (registerForm) {
    const step1 = document.getElementById("registerStep1");
    const step2 = document.getElementById("registerStep2");
    const continueButton = document.getElementById("continueRegister");
    const backButton = document.getElementById("backRegister");
    const subtitle = document.getElementById("stepSubtitle");
    const title = document.getElementById("stepTitle");
    const description = document.getElementById("stepDescription");
    const dot1 = document.getElementById("stepDot1");
    const dot2 = document.getElementById("stepDot2");

    if (continueButton) {
        continueButton.addEventListener("click", function () {
            if (!step1 || !step2) return;
            step1.hidden = true;
            step2.hidden = false;
            if (subtitle) subtitle.textContent = "STEP 2 OF 2";
            if (title) title.textContent = "Create your workspace";
            if (description) description.textContent =
                "Enter your organization details and create its first admin account.";
            if (dot1) dot1.classList.remove("active");
            if (dot2) dot2.classList.add("active");
        });
    }

    if (backButton) {
        backButton.addEventListener("click", function () {
            if (!step1 || !step2) return;
            step2.hidden = true;
            step1.hidden = false;
            if (subtitle) subtitle.textContent = "STEP 1 OF 2";
            if (title) title.textContent = "Set up your workspace";
            if (description) description.textContent =
                "Choose the type of organization you want to register.";
            if (dot2) dot2.classList.remove("active");
            if (dot1) dot1.classList.add("active");
        });
    }

    registerForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const organizationType = registerForm.elements["organizationType"]?.value;
        const organizationName = document.getElementById("organizationName")?.value.trim() || "";
        const adminName = document.getElementById("adminName")?.value.trim() || "";
        const adminEmail = document.getElementById("adminEmail")?.value.trim() || "";
        const adminPassword = document.getElementById("adminPassword")?.value || "";

        // Registration is not connected to a backend endpoint yet.
        console.log({
            organizationType,
            organizationName,
            adminName,
            adminEmail,
            passwordProvided: adminPassword.length > 0
        });
    });
}

// ==========================================
// Login Form
// ==========================================

const loginForm = document.getElementById("loginForm");

if (loginForm) {
    const accountTypeInput = document.getElementById("accountType");
    const organizationGroup = document.getElementById("organizationGroup");
    const organizationIdInput = document.getElementById("organizationId");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const loginMessage = document.getElementById("loginMessage");
    const loginButton = loginForm.querySelector('button[type="submit"]');

    function showLoginMessage(message, type = "info") {
        if (!loginMessage) return;
        loginMessage.textContent = message;
        loginMessage.dataset.state = type;
        loginMessage.setAttribute("aria-live", "polite");
    }

    // Organization accounts need an organization ID; platform admins do not.
    function updateOrganizationField() {
        if (!accountTypeInput || !organizationGroup || !organizationIdInput) return;
        const isOrganization = accountTypeInput.value === "organization";
        organizationGroup.hidden = !isOrganization;
        organizationIdInput.required = isOrganization;
        organizationIdInput.disabled = !isOrganization;
    }

    if (accountTypeInput) {
        accountTypeInput.addEventListener("change", updateOrganizationField);
        updateOrganizationField();
    }

    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!accountTypeInput || !emailInput || !passwordInput) {
            showLoginMessage("The login form is missing a required field.", "error");
            return;
        }

        const accountType = accountTypeInput.value;
        const payload = {
            email: emailInput.value.trim(),
            password: passwordInput.value,
            accountType
        };

        if (accountType === "organization") {
            if (!organizationIdInput || !organizationIdInput.value) {
                showLoginMessage("Enter your Organization ID.", "error");
                return;
            }
            payload.organizationId = organizationIdInput.value;
        }

        // Clear any previous user's session before attempting a new login.
        localStorage.removeItem("itaskToken");
        localStorage.removeItem("itaskUser");
        showLoginMessage("Logging in...", "info");
        if (loginButton) {
            loginButton.disabled = true;
            loginButton.textContent = "Logging in...";
        }

        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            let data;
            try {
                data = await response.json();
            } catch {
                throw new Error("The backend returned an unreadable response.");
            }

            if (!response.ok) {
                showLoginMessage(data.message || "Login failed. Check your details.", "error");
                return;
            }

            if (!data.token || !data.user) {
                throw new Error("The backend response did not include a token and user.");
            }

            localStorage.setItem("itaskToken", data.token);
            localStorage.setItem("itaskUser", JSON.stringify(data.user));

            const user = data.user;
            const role = String(user.role || "").toLowerCase();
            let destination = null;

            if (user.accountType === "platform_admin" || accountType === "platform_admin") {
                // A dedicated platform-admin dashboard has not been connected yet.
                showLoginMessage(
                    `Login successful! Welcome, ${user.full_name || "Administrator"}. The platform administrator dashboard is not connected yet.`,
                    "success"
                );
                console.log("Logged-in user:", user);
                return;
            }

            switch (role) {
                case "doctor":
                    destination = "Doctor_view/instructor-overview.html";
                    break;
                case "student":
                    destination = "Student_view/student-view.html";
                    break;
                case "admin":
                    destination = "Admin_view/Dashboard.html";
                    break;
                default:
                    showLoginMessage(
                        `Login succeeded for ${user.full_name || "your account"}, but no dashboard is configured for role "${role || "unknown"}".`,
                        "error"
                    );
                    console.warn("No dashboard route configured for user:", user);
                    return;
            }

            showLoginMessage(
                `Login successful! Welcome, ${user.full_name || "User"}. Redirecting...`,
                "success"
            );
            console.log("Logged-in user:", user);
            window.setTimeout(function () {
                window.location.assign(destination);
            }, 500);

        } catch (error) {
            console.error("Login error:", error);
            showLoginMessage(
                error.message === "Failed to fetch"
                    ? "Cannot connect to the backend. Check that the backend server is running."
                    : (error.message || "An unexpected login error occurred."),
                "error"
            );
        } finally {
            if (loginButton) {
                loginButton.disabled = false;
                loginButton.textContent = "Log in";
            }
        }
    });
}