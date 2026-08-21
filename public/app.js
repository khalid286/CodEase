// ======================================================
// CODEASE FRONTEND
// ======================================================


// ======================================================
// SECTION 1: ELEMENTS
// ======================================================

const loginScreen =
  document.getElementById(
    "loginScreen"
  );

const appShell =
  document.getElementById(
    "appShell"
  );

const loginForm =
  document.getElementById(
    "loginForm"
  );

const usernameInput =
  document.getElementById(
    "username"
  );

const passwordInput =
  document.getElementById(
    "password"
  );

const loginButton =
  document.getElementById(
    "loginButton"
  );

const loginStatus =
  document.getElementById(
    "loginStatus"
  );

const logoutButton =
  document.getElementById(
    "logoutButton"
  );


const hubCards =
  document.querySelectorAll(
    ".hub-card"
  );

const requestInput =
  document.getElementById(
    "request"
  );

const previewButton =
  document.getElementById(
    "previewButton"
  );

const applyButton =
  document.getElementById(
    "applyButton"
  );

const cancelButton =
  document.getElementById(
    "cancelButton"
  );

const statusBox =
  document.getElementById(
    "status"
  );

const previewSection =
  document.getElementById(
    "preview"
  );

const planSummary =
  document.getElementById(
    "planSummary"
  );

const planReason =
  document.getElementById(
    "planReason"
  );

const planOperations =
  document.getElementById(
    "planOperations"
  );

const friendlyOperations =
  document.getElementById(
    "friendlyOperations"
  );

const successPanel =
  document.getElementById(
    "successPanel"
  );

const successMessage =
  document.getElementById(
    "successMessage"
  );


// ======================================================
// SECTION 2: CURRENT STATE
// ======================================================

let currentHub =
  "lrc";

let currentRequest =
  null;

let currentPlan =
  null;


// ======================================================
// SECTION 3: SHOW LOGIN
// ======================================================

function showLogin() {

  loginScreen.hidden =
    false;

  appShell.hidden =
    true;

  passwordInput.value =
    "";

  loginStatus.textContent =
    "";

  setTimeout(
    () => {
      usernameInput.focus();
    },
    50
  );
}


// ======================================================
// SECTION 4: SHOW APPLICATION
// ======================================================

function showApplication() {

  loginScreen.hidden =
    true;

  appShell.hidden =
    false;

  loginStatus.textContent =
    "";
}


// ======================================================
// SECTION 5: CHECK LOGIN STATUS
// ======================================================

async function checkLoginStatus() {

  try {

    const response =
      await fetch(
        "/api/auth/status",
        {
          credentials:
            "same-origin",
        }
      );

    const data =
      await response.json();


    if (
      response.ok &&
      data.authenticated
    ) {
      showApplication();
    }

    else {
      showLogin();
    }

  } catch {

    showLogin();

    loginStatus.textContent =
      "Could not connect to CodEase.";
  }
}


// ======================================================
// SECTION 6: LOGIN
// ======================================================

loginForm.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();


    const username =
      usernameInput.value.trim();

    const password =
      passwordInput.value;


    if (
      !username ||
      !password
    ) {
      loginStatus.textContent =
        "Please enter your username and password.";

      return;
    }


    loginButton.disabled =
      true;

    loginStatus.textContent =
      "Signing in...";


    try {

      const response =
        await fetch(
          "/api/login",
          {
            method:
              "POST",

            credentials:
              "same-origin",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                username,
                password,
              }),
          }
        );


      const data =
        await response.json();


      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
          "Login failed."
        );
      }


      passwordInput.value =
        "";

      showApplication();


    } catch (error) {

      loginStatus.textContent =
        error.message;

    } finally {

      loginButton.disabled =
        false;
    }
  }
);


// ======================================================
// SECTION 7: LOGOUT
// ======================================================

logoutButton.addEventListener(
  "click",
  async () => {

    logoutButton.disabled =
      true;


    try {

      await fetch(
        "/api/logout",
        {
          method:
            "POST",

          credentials:
            "same-origin",
        }
      );

    } finally {

      logoutButton.disabled =
        false;

      clearPlan();

      requestInput.value =
        "";

      showLogin();
    }
  }
);


// ======================================================
// SECTION 8: HANDLE EXPIRED LOGIN
// ======================================================

function handleUnauthorized(
  response
) {

  if (
    response.status === 401
  ) {

    clearPlan();

    showLogin();

    loginStatus.textContent =
      "Your session has expired. Please sign in again.";

    return true;
  }

  return false;
}


// ======================================================
// SECTION 9: HUB SELECTION
// ======================================================

hubCards.forEach(
  (card) => {

    card.addEventListener(
      "click",
      () => {

        hubCards.forEach(
          (item) =>
            item.classList.remove(
              "selected"
            )
        );

        card.classList.add(
          "selected"
        );

        currentHub =
          card.dataset.hub;

        clearPlan();
      }
    );
  }
);


// ======================================================
// SECTION 10: CLEAR EXISTING PLAN
// ======================================================

function clearPlan() {

  currentPlan =
    null;

  currentRequest =
    null;

  previewSection.hidden =
    true;

  successPanel.hidden =
    true;

  applyButton.disabled =
    true;

  statusBox.textContent =
    "";
}


// ======================================================
// SECTION 11: FRIENDLY OPERATION NAMES
// ======================================================

function operationName(
  type
) {

  const names = {

    add_link:
      "Add Link",

    update_link:
      "Update Link",

    remove_link:
      "Remove Link",

    move_link:
      "Move Link",

    duplicate_link:
      "Copy Link",


    add_item:
      "Add Content",

    update_item:
      "Update Content",

    remove_item:
      "Remove Content",


    add_contact:
      "Add Contact",

    update_contact:
      "Update Contact",

    remove_contact:
      "Remove Contact",


    add_tab:
      "Add Tab",

    rename_tab:
      "Rename Tab",

    remove_tab:
      "Remove Tab",


    add_section:
      "Add Section",

    rename_section:
      "Rename Section",

    remove_section:
      "Remove Section",


    add_subsection:
      "Add Subsection",

    rename_subsection:
      "Rename Subsection",

    remove_subsection:
      "Remove Subsection",
  };


  return (
    names[type] ||
    type
  );
}


// ======================================================
// SECTION 12: FRIENDLY OPERATION DESCRIPTION
// ======================================================

function describeOperation(
  operation
) {

  switch (
    operation.type
  ) {

    case "add_link":

      return `Add "${operation.title}" to ${
        operation.subsection ||
        operation.section ||
        operation.tab_id ||
        "the selected section"
      }.`;


    case "update_link":

      return `Update "${operation.title}".`;


    case "remove_link":

      return `Remove "${operation.title}".`;


    case "move_link":

      return `Move "${operation.title}" to ${
        operation.to_subsection ||
        operation.to_section ||
        operation.to_tab_id ||
        "the new location"
      }.`;


    case "duplicate_link":

      return `Copy "${operation.title}" to ${
        operation.to_section ||
        "the target section"
      }.`;


    case "add_item":

      return `Add "${operation.text}" under ${
        operation.subsection ||
        operation.section ||
        "the selected area"
      }.`;


    case "update_item":

      return `Change "${operation.old_text}" to "${operation.new_text}".`;


    case "remove_item":

      return `Remove "${operation.text}" from ${
        operation.subsection ||
        operation.section ||
        "the selected area"
      }.`;


    case "add_contact":

      return `Add ${operation.name} to ${
        operation.section ||
        "Staff Contact Info"
      }.`;


    case "update_contact":

      return `Update the contact information for "${operation.name}".`;


    case "remove_contact":

      return `Remove "${operation.name}" from ${
        operation.section ||
        "Staff Contact Info"
      }.`;


    case "add_tab":

      return `Create a new tab called "${operation.title}".`;


    case "rename_tab":

      return `Rename the tab to "${operation.new_title}".`;


    case "remove_tab":

      return `Remove the "${operation.tab_id}" tab.`;


    case "add_section":

      return `Add a section called "${operation.name}".`;


    case "rename_section":

      return `Rename "${operation.old_name}" to "${operation.new_name}".`;


    case "remove_section":

      return `Remove the "${operation.name}" section.`;


    case "add_subsection":

      return `Add a subsection called "${operation.name}".`;


    case "rename_subsection":

      return `Rename "${operation.old_name}" to "${operation.new_name}".`;


    case "remove_subsection":

      return `Remove the "${operation.name}" subsection.`;


    default:

      return "CodEase prepared this requested change.";
  }
}


// ======================================================
// SECTION 13: RENDER FRIENDLY OPERATIONS
// ======================================================

function renderFriendlyOperations(
  operations
) {

  friendlyOperations.innerHTML =
    "";


  operations.forEach(
    (operation) => {

      const card =
        document.createElement(
          "div"
        );

      card.className =
        "operation-card";


      const title =
        document.createElement(
          "strong"
        );

      title.textContent =
        operationName(
          operation.type
        );


      const description =
        document.createElement(
          "p"
        );

      description.textContent =
        describeOperation(
          operation
        );


      card.appendChild(
        title
      );

      card.appendChild(
        description
      );

      friendlyOperations.appendChild(
        card
      );
    }
  );
}


// ======================================================
// SECTION 14: PREVIEW CHANGE
// ======================================================

previewButton.addEventListener(
  "click",
  async () => {

    const request =
      requestInput.value.trim();


    if (!request) {

      statusBox.textContent =
        "Please enter a change request.";

      return;
    }


    previewButton.disabled =
      true;

    applyButton.disabled =
      true;

    previewSection.hidden =
      true;

    successPanel.hidden =
      true;

    statusBox.textContent =
      "✦ CodEase is analyzing your request...";


    try {

      const response =
        await fetch(
          "/api/plan",
          {
            method:
              "POST",

            credentials:
              "same-origin",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                hub:
                  currentHub,

                request,
              }),
          }
        );


      if (
        handleUnauthorized(
          response
        )
      ) {
        return;
      }


      const data =
        await response.json();


      if (
        !response.ok ||
        !data.success
      ) {

        throw new Error(
          data.error ||
          "Could not create a plan."
        );
      }


      const plan =
        data.plan;


      if (!plan) {

        throw new Error(
          "CodEase did not return a plan."
        );
      }


      // --------------------------------------------------
      // UNSAFE / UNCLEAR PLAN
      // --------------------------------------------------

      if (
        !plan.safe
      ) {

        currentPlan =
          null;

        currentRequest =
          null;

        planSummary.textContent =
          plan.summary ||
          "CodEase needs more information.";

        planReason.textContent =
          plan.reason ||
          "The request could not be planned safely.";

        planOperations.textContent =
          "No operations will be applied.";

        friendlyOperations.innerHTML =
          "";

        previewSection.hidden =
          false;

        applyButton.disabled =
          true;

        statusBox.textContent =
          "CodEase needs a clearer request.";

        return;
      }


      // --------------------------------------------------
      // VALID PLAN
      // --------------------------------------------------

      currentPlan =
        plan;

      currentRequest =
        request;


      planSummary.textContent =
        plan.summary ||
        "Proposed update";


      planReason.textContent =
        plan.reason ||
        "CodEase understood the requested change.";


      planOperations.textContent =
        JSON.stringify(
          plan.operations,
          null,
          2
        );


      renderFriendlyOperations(
        plan.operations
      );


      previewSection.hidden =
        false;

      applyButton.disabled =
        false;


      statusBox.textContent =
        "✓ Plan ready. Review the proposed change before applying it.";


      previewSection.scrollIntoView({
        behavior:
          "smooth",

        block:
          "start",
      });


    } catch (
      error
    ) {

      currentPlan =
        null;

      currentRequest =
        null;

      previewSection.hidden =
        true;

      statusBox.textContent =
        `Error: ${error.message}`;

    } finally {

      previewButton.disabled =
        false;
    }
  }
);


// ======================================================
// SECTION 15: APPLY CHANGE
// ======================================================

applyButton.addEventListener(
  "click",
  async () => {

    if (
      !currentPlan ||
      !currentRequest
    ) {

      statusBox.textContent =
        "There is no approved plan to apply.";

      return;
    }


    applyButton.disabled =
      true;

    previewButton.disabled =
      true;

    cancelButton.disabled =
      true;


    statusBox.textContent =
      "CodEase is applying the change...";


    try {

      const response =
        await fetch(
          "/api/apply",
          {
            method:
              "POST",

            credentials:
              "same-origin",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                hub:
                  currentHub,

                request:
                  currentRequest,

                plan:
                  currentPlan,
              }),
          }
        );


      if (
        handleUnauthorized(
          response
        )
      ) {
        return;
      }


      const data =
        await response.json();


      if (
        !response.ok ||
        !data.success
      ) {

        throw new Error(
          data.error ||
          "Could not apply the change."
        );
      }


      successMessage.textContent =
        `${data.hub} was updated successfully. PR #${data.prNumber} was merged.`;


      successPanel.hidden =
        false;


      statusBox.textContent =
        "✓ Update completed successfully.";


      currentPlan =
        null;

      currentRequest =
        null;

      applyButton.disabled =
        true;


      successPanel.scrollIntoView({
        behavior:
          "smooth",

        block:
          "center",
      });


    } catch (
      error
    ) {

      statusBox.textContent =
        `Error: ${error.message}`;

      applyButton.disabled =
        false;

    } finally {

      previewButton.disabled =
        false;

      cancelButton.disabled =
        false;
    }
  }
);


// ======================================================
// SECTION 16: CANCEL
// ======================================================

cancelButton.addEventListener(
  "click",
  () => {

    currentPlan =
      null;

    currentRequest =
      null;

    previewSection.hidden =
      true;

    applyButton.disabled =
      true;

    statusBox.textContent =
      "Change canceled.";

    requestInput.focus();
  }
);


// ======================================================
// SECTION 17: REQUEST CHANGED AFTER PREVIEW
// ======================================================

requestInput.addEventListener(
  "input",
  () => {

    if (
      currentPlan
    ) {

      currentPlan =
        null;

      currentRequest =
        null;

      previewSection.hidden =
        true;

      applyButton.disabled =
        true;

      successPanel.hidden =
        true;

      statusBox.textContent =
        "";
    }
  }
);


// ======================================================
// SECTION 18: INITIAL AUTH CHECK
// ======================================================

checkLoginStatus();
