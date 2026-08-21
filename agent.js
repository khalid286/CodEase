// ======================================================
// CODEASE
// Multi-Hub AI Content Agent
// ======================================================


// ======================================================
// SECTION 1: IMPORTS
// ======================================================

import "dotenv/config";
import fs from "fs";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { App } from "octokit";
import OpenAI from "openai";


// ======================================================
// SECTION 2: GITHUB + OPENAI
// ======================================================

const privateKey = fs.readFileSync(
  process.env.GITHUB_PRIVATE_KEY_PATH,
  "utf8"
);

const githubApp = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


// ======================================================
// SECTION 3: HUB CONFIGURATION
// ======================================================

const HUBS = {
  lrc: {
    id: "lrc",
    name: "LRC Hub",
    repo:
      process.env.GITHUB_LRC_REPO ||
      process.env.GITHUB_REPO ||
      "LRC-Main-Hub",
  },

  library: {
    id: "library",
    name: "ARC Library Hub",
    repo:
      process.env.GITHUB_LIBRARY_REPO ||
      "ARC-Library-Hub",
  },
};


// ======================================================
// SECTION 4: BASIC HELPERS
// ======================================================

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}


function cleanJson(text) {
  return String(text ?? "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}


function escapeRegex(value) {
  return String(value)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}


function makeBranchName() {
  return `ai/codease-${Date.now()}`;
}


function deriveDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    throw new Error(
      `Invalid URL supplied: ${url}`
    );
  }
}


function verifyUrlFromRequest(
  staffRequest,
  url
) {
  if (
    !staffRequest.includes(url)
  ) {
    throw new Error(
      `URL "${url}" was not found in the staff request.`
    );
  }

  deriveDomain(url);
}


// ======================================================
// SECTION 5: GITHUB READ
// ======================================================

async function readGitHubFile(
  octokit,
  owner,
  repo,
  path,
  branch
) {
  const response =
    await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner,
        repo,
        path,
        ref: branch,
      }
    );

  return Buffer.from(
    response.data.content,
    "base64"
  ).toString("utf8");
}


// ======================================================
// SECTION 6: GITHUB PUBLISH / PR / MERGE
// ======================================================

async function publishFiles({
  octokit,
  owner,
  repo,
  baseBranch,
  files,
  summary,
  staffRequest,
}) {
  if (!files.length) {
    throw new Error(
      "No changed files were supplied."
    );
  }

  console.log(
    "\nCreating CodEase update..."
  );

  const baseRef =
    await octokit.request(
      "GET /repos/{owner}/{repo}/git/ref/heads/{branch}",
      {
        owner,
        repo,
        branch: baseBranch,
      }
    );

  const branchName =
    makeBranchName();

  let branchCreated = false;

  try {

    // ------------------------------
    // Create branch
    // ------------------------------

    await octokit.request(
      "POST /repos/{owner}/{repo}/git/refs",
      {
        owner,
        repo,
        ref:
          `refs/heads/${branchName}`,
        sha:
          baseRef.data.object.sha,
      }
    );

    branchCreated = true;


    // ------------------------------
    // Update each changed file
    // ------------------------------

    for (const file of files) {

      const existing =
        await octokit.request(
          "GET /repos/{owner}/{repo}/contents/{path}",
          {
            owner,
            repo,
            path: file.path,
            ref: branchName,
          }
        );

      await octokit.request(
        "PUT /repos/{owner}/{repo}/contents/{path}",
        {
          owner,
          repo,

          path:
            file.path,

          message:
            `CodEase: ${summary}`,

          content:
            Buffer.from(
              file.content
            ).toString(
              "base64"
            ),

          sha:
            existing.data.sha,

          branch:
            branchName,
        }
      );

      console.log(
        `Updated ${file.path}`
      );
    }


    // ------------------------------
    // Create PR
    // ------------------------------

    const pr =
      await octokit.request(
        "POST /repos/{owner}/{repo}/pulls",
        {
          owner,
          repo,

          head:
            branchName,

          base:
            baseBranch,

          title:
            `CodEase: ${summary}`,

          body: `
Automated CodEase update.

Staff request:
${staffRequest}

Summary:
${summary}

Files changed:
${files
  .map(
    (file) =>
      `- ${file.path}`
  )
  .join("\n")}
          `.trim(),
        }
      );

    console.log(
      `Created PR #${pr.data.number}`
    );


    // ------------------------------
    // Merge
    // ------------------------------

    console.log(
      "Merging update..."
    );

    const merge =
      await octokit.request(
        "PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge",
        {
          owner,
          repo,

          pull_number:
            pr.data.number,

          merge_method:
            "squash",
        }
      );

    if (!merge.data.merged) {
      throw new Error(
        `PR could not be merged: ${merge.data.message}`
      );
    }

    console.log(
      "Update merged successfully."
    );


    // ------------------------------
    // Delete branch
    // ------------------------------

    await octokit.request(
      "DELETE /repos/{owner}/{repo}/git/refs/{ref}",
      {
        owner,
        repo,

        ref:
          `heads/${branchName}`,
      }
    );

    branchCreated = false;

    console.log(
      "Temporary branch deleted."
    );

    return pr.data.number;

  } catch (error) {

    if (branchCreated) {
      try {
        await octokit.request(
          "DELETE /repos/{owner}/{repo}/git/refs/{ref}",
          {
            owner,
            repo,

            ref:
              `heads/${branchName}`,
          }
        );

        console.log(
          "Failed temporary branch cleaned up."
        );

      } catch {
        console.log(
          "Could not clean up temporary branch."
        );
      }
    }

    throw error;
  }
}


// ======================================================
// SECTION 7: FIND ASSIGNED JS ARRAY / OBJECT
// ======================================================

function findAssignedLiteral(
  code,
  variableName,
  openingCharacter
) {
  const variableIndex =
    code.indexOf(variableName);

  if (variableIndex === -1) {
    return null;
  }

  const equalsIndex =
    code.indexOf(
      "=",
      variableIndex
    );

  if (equalsIndex === -1) {
    return null;
  }

  const start =
    code.indexOf(
      openingCharacter,
      equalsIndex
    );

  if (start === -1) {
    return null;
  }

  const closingCharacter =
    openingCharacter === "["
      ? "]"
      : "}";

  let depth = 0;
  let inString = false;
  let quote = null;
  let escaped = false;

  for (
    let i = start;
    i < code.length;
    i++
  ) {
    const char = code[i];

    if (inString) {

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quote) {
        inString = false;
        quote = null;
      }

      continue;
    }

    if (
      char === '"' ||
      char === "'" ||
      char === "`"
    ) {
      inString = true;
      quote = char;
      continue;
    }

    if (
      char === openingCharacter
    ) {
      depth++;
    }

    if (
      char === closingCharacter
    ) {
      depth--;

      if (depth === 0) {
        return {
          start,
          end: i,
          text:
            code.slice(
              start,
              i + 1
            ),
        };
      }
    }
  }

  return null;
}


// ======================================================
// SECTION 8: REPLACE ASSIGNED JS LITERAL
// ======================================================

function replaceAssignedLiteral(
  code,
  variableName,
  openingCharacter,
  newValue
) {
  const info =
    findAssignedLiteral(
      code,
      variableName,
      openingCharacter
    );

  if (!info) {
    throw new Error(
      `Could not find ${variableName}.`
    );
  }

  const formatted =
    JSON.stringify(
      newValue,
      null,
      4
    );

  return (
    code.slice(
      0,
      info.start
    ) +
    formatted +
    code.slice(
      info.end + 1
    )
  );
}


// ======================================================
// SECTION 9: LRC BOOKMARK ARRAY
// ======================================================

function findBookmarksArray(code) {

  const info =
    findAssignedLiteral(
      code,
      "window.BOOKMARKS",
      "["
    );

  if (!info) {
    throw new Error(
      "Could not find window.BOOKMARKS."
    );
  }

  return info;
}


function parseBookmarks(code) {

  const info =
    findBookmarksArray(code);

  try {
    return JSON.parse(
      info.text
    );

  } catch (error) {
    throw new Error(
      `Could not parse bookmarks-data.js: ${error.message}`
    );
  }
}


function writeBookmarks(
  originalCode,
  bookmarks
) {
  const info =
    findBookmarksArray(
      originalCode
    );

  return (
    originalCode.slice(
      0,
      info.start
    ) +
    JSON.stringify(
      bookmarks,
      null,
      2
    ) +
    originalCode.slice(
      info.end + 1
    )
  );
}


// ======================================================
// SECTION 10: LRC CATEGORY DATA
// ======================================================

function readLrcStructure(
  scriptCode
) {
  const orderInfo =
    findAssignedLiteral(
      scriptCode,
      "categoryOrder",
      "["
    );

  const groupsInfo =
    findAssignedLiteral(
      scriptCode,
      "categoryGroups",
      "{"
    );

  if (
    !orderInfo ||
    !groupsInfo
  ) {
    throw new Error(
      "Could not read LRC category structure."
    );
  }

  let categoryOrder;
  let categoryGroups;

  try {

    categoryOrder =
      new Function(
        `return (${orderInfo.text});`
      )();

    categoryGroups =
      new Function(
        `return (${groupsInfo.text});`
      )();

  } catch (error) {

    throw new Error(
      `Could not parse LRC category structure: ${error.message}`
    );
  }

  return {
    categoryOrder,
    categoryGroups,
  };
}


// ======================================================
// SECTION 11: WRITE LRC STRUCTURE
// ======================================================

function writeLrcStructure(
  originalScript,
  categoryOrder,
  categoryGroups
) {
  let updated =
    replaceAssignedLiteral(
      originalScript,
      "categoryOrder",
      "[",
      categoryOrder
    );

  updated =
    replaceAssignedLiteral(
      updated,
      "categoryGroups",
      "{",
      categoryGroups
    );

  return updated;
}


// ======================================================
// SECTION 12: LRC CATEGORY HELPERS
// ======================================================

function findCategoryExact(
  categoryOrder,
  requested
) {
  return categoryOrder.find(
    (category) =>
      normalize(category) ===
      normalize(requested)
  );
}


function getLrcParent(
  category
) {
  if (
    !category.includes(" / ")
  ) {
    return null;
  }

  return category.split(
    " / "
  )[0].trim();
}


function findLrcGroupForCategory(
  categoryGroups,
  category
) {
  for (
    const [categoryName, groupName]
    of Object.entries(
      categoryGroups
    )
  ) {
    if (
      normalize(categoryName) ===
      normalize(category)
    ) {
      return groupName;
    }
  }

  return null;
}

function findLrcGroupExact(
  categoryGroups,
  requested
) {
  return (
    Object.values(
      categoryGroups
    ).find(
      (groupName) =>
        normalize(groupName) ===
        normalize(requested)
    ) || null
  );
}


// ======================================================
// SECTION 13: LRC LINK FINDER
// ======================================================

function findLrcBookmarkIndex(
  bookmarks,
  title,
  category = null
) {
  const matches = [];

  bookmarks.forEach(
    (bookmark, index) => {

      if (
        normalize(
          bookmark.title
        ) !==
        normalize(title)
      ) {
        return;
      }

      if (
        category !== null &&
        normalize(
          bookmark.category
        ) !==
        normalize(category)
      ) {
        return;
      }

      matches.push(index);
    }
  );

  if (!matches.length) {
    throw new Error(
      `Could not find "${title}".`
    );
  }

  if (
    matches.length > 1
  ) {
    throw new Error(
      `"${title}" appears more than once. Please specify its section.`
    );
  }

  return matches[0];
}


// ======================================================
// SECTION 14: GENERIC LRC OPERATION PLANNER
// ======================================================

async function createLrcPlan(
  staffRequest,
  bookmarks,
  categoryOrder,
  categoryGroups
) {
  const resourceList =
    bookmarks.map(
      (item) =>
        `${item.title} | ${item.category} | ${item.url}`
    ).join("\n");

  const response =
    await openai.responses.create({
      model:
        "gpt-5.4-mini",

      input: `
You are CodEase.

You manage the American River College LRC Hub.

Translate the staff request into ONE OR MORE structured operations.

SUPPORTED OPERATION TYPES:

LINKS
- add_link
- update_link
- remove_link
- move_link
- duplicate_link

CONTACTS
- add_contact
- update_contact
- remove_contact

STRUCTURE
- add_section
- rename_section
- remove_section

- add_subsection
- rename_subsection
- remove_subsection

For the LRC Hub:
- A normal top-level category is a section.
- A category like "Beacon / Student Links" is a subsection of "Beacon".
- Staff may casually call a section a tab.
- Treat "tab" and "section" as equivalent here.

CURRENT SECTION ORDER:
${JSON.stringify(categoryOrder, null, 2)}

CURRENT GROUPS:
${JSON.stringify(categoryGroups, null, 2)}

CURRENT RESOURCES:
${resourceList}

STAFF REQUEST:
${staffRequest}

RULES:

- Never invent URLs.
- New URLs must be copied exactly from the staff request.
- Never remove unrelated resources.
- Never rename unrelated categories.
- For add_section, staff may specify where the new section should appear.
- If staff says "after X", set after_section to X exactly as staff referred to it. X may be either an existing section or an existing group heading.
- If staff says "before X", set before_section to X exactly as staff referred to it. X may be either an existing section or an existing group heading.
- Never use a section name as a group name.
- Do not invent internal group names.
- The backend will determine the correct internal group from the neighboring section.
- If no placement can be determined safely, return safe:false.
- For add_subsection, the parent section must already exist.
- A new subsection internal category should be:
  "Parent / Subsection"
- For rename_section, rename all matching bookmark categories and child subsection prefixes too.
- For remove_section, its links and subsections are removed too.
- For remove_subsection, remove only that subsection and its links.
- Do not modify styling.
- Do not modify HTML.
- If ambiguous, return safe:false.
- Staff contact information is plain information, not a website link.
- A phone number or email address must never be placed in the url field.
- Use add_contact when staff asks to add a person or contact entry.
- Use update_contact when staff asks to change an existing person's name, phone number, or email.
- Use remove_contact when staff asks to remove a contact entry.
- Preserve names, phone numbers, and email addresses exactly as supplied by staff.
- Do not invent missing phone numbers, email addresses, or other contact information.
- Only use add_link for an actual URL such as https://...
- update_contact may be used to convert an older contact entry into the structured contact format.
- Older contact entries may have name, phone, and email combined inside the title field using separators like "|".
- When updating an old contact, preserve any existing information unless staff explicitly changes it.
- Never invent a phone number or email address.
- Contact entries must use type:"contact" after an update.


RETURN ONLY JSON:

{
  "safe": true,
  "summary": "Short summary",
  "operations": [],
  "reason": "Short reason"
}

Examples:

ADD LINK:
{
  "type": "add_link",
  "title": "Title",
  "url": "https://...",
  "section": "Existing category"
}

MOVE LINK:
{
  "type": "move_link",
  "title": "Existing title",
  "from_section": "Old category",
  "to_section": "New category"
}

UPDATE LINK:
{
  "type": "update_link",
  "title": "Existing title",
  "section": "Existing category or null",
  "new_title": null,
  "new_url": null
}

REMOVE LINK:
{
  "type": "remove_link",
  "title": "Existing title",
  "section": "Existing category or null"
}

ADD SECTION:
{
  "type": "add_section",
  "name": "New section",
  "after_section": "Existing section or null",
  "before_section": null
}

RENAME SECTION:
{
  "type": "rename_section",
  "old_name": "Old",
  "new_name": "New"
}

REMOVE SECTION:
{
  "type": "remove_section",
  "name": "Section"
}

ADD SUBSECTION:
{
  "type": "add_subsection",
  "parent": "Beacon",
  "name": "Worksheet"
}

RENAME SUBSECTION:
{
  "type": "rename_subsection",
  "parent": "Beacon",
  "old_name": "Old subsection",
  "new_name": "New subsection"
}

REMOVE SUBSECTION:
{
  "type": "remove_subsection",
  "parent": "Beacon",
  "name": "Subsection"
}

ADD CONTACT:
{
  "type": "add_contact",
  "section": "Staff Contact Info",
  "name": "Mohammad Khalid Daneshwar",
  "phone": "916-547-9502",
  "email": "DaneshM@arc.losrios.edu"
}


UPDATE CONTACT:
{
  "type": "update_contact",
  "section": "Staff Contact Info",
  "name": "Mohammad Khalid Daneshwar",
  "new_name": null,
  "new_phone": "916-547-9502",
  "new_email": "DaneshM@arc.losrios.edu"
}

REMOVE CONTACT:
{
  "type": "remove_contact",
  "section": "Staff Contact Info",
  "name": "Mohammad Khalid Daneshwar"
}

`,
    });

  try {
    return JSON.parse(
      cleanJson(
        response.output_text
      )
    );

  } catch {
    throw new Error(
      "CodEase returned an invalid LRC plan."
    );
  }
}


// ======================================================
// SECTION 15: APPLY LRC OPERATIONS
// ======================================================

function applyLrcOperations({
  bookmarks,
  categoryOrder,
  categoryGroups,
  operations,
  staffRequest,
}) {
  const newBookmarks =
    structuredClone(bookmarks);

  const newOrder =
    structuredClone(
      categoryOrder
    );

  const newGroups =
    structuredClone(
      categoryGroups
    );

  const messages = [];

  for (
    const operation
    of operations
  ) {

    // --------------------------------------------------
    // ADD LINK
    // --------------------------------------------------

    if (
      operation.type ===
      "add_link"
    ) {
      verifyUrlFromRequest(
        staffRequest,
        operation.url
      );

      const category =
        findCategoryExact(
          newOrder,
          operation.section
        );

      if (!category) {
        throw new Error(
          `Unknown section "${operation.section}".`
        );
      }

      newBookmarks.push({
        title:
          operation.title,

        url:
          operation.url,

        category,

        domain:
          deriveDomain(
            operation.url
          ),
      });

      messages.push(
        `Added "${operation.title}" to "${category}".`
      );
    }


    // --------------------------------------------------
    // UPDATE LINK
    // --------------------------------------------------

    else if (
      operation.type ===
      "update_link"
    ) {
      const index =
        findLrcBookmarkIndex(
          newBookmarks,
          operation.title,
          operation.section ??
            null
        );

      if (
        operation.new_title
      ) {
        newBookmarks[index].title =
          operation.new_title;
      }

      if (
        operation.new_url
      ) {
        verifyUrlFromRequest(
          staffRequest,
          operation.new_url
        );

        newBookmarks[index].url =
          operation.new_url;

        newBookmarks[index].domain =
          deriveDomain(
            operation.new_url
          );
      }

      messages.push(
        `Updated "${operation.title}".`
      );
    }


    // --------------------------------------------------
    // REMOVE LINK
    // --------------------------------------------------

    else if (
      operation.type ===
      "remove_link"
    ) {
      const index =
        findLrcBookmarkIndex(
          newBookmarks,
          operation.title,
          operation.section ??
            null
        );

      const removed =
        newBookmarks[index];

      newBookmarks.splice(
        index,
        1
      );

      messages.push(
        `Removed "${removed.title}".`
      );
    }


    // --------------------------------------------------
    // MOVE LINK
    // --------------------------------------------------

    else if (
      operation.type ===
      "move_link"
    ) {
      const index =
        findLrcBookmarkIndex(
          newBookmarks,
          operation.title,
          operation.from_section ??
            null
        );

      const target =
        findCategoryExact(
          newOrder,
          operation.to_section
        );

      if (!target) {
        throw new Error(
          `Unknown target section "${operation.to_section}".`
        );
      }

      newBookmarks[index].category =
        target;

      messages.push(
        `Moved "${operation.title}" to "${target}".`
      );
    }


    // --------------------------------------------------
    // DUPLICATE LINK
    // --------------------------------------------------

    else if (
      operation.type ===
      "duplicate_link"
    ) {
      const index =
        findLrcBookmarkIndex(
          newBookmarks,
          operation.title,
          operation.from_section ??
            null
        );

      const target =
        findCategoryExact(
          newOrder,
          operation.to_section
        );

      if (!target) {
        throw new Error(
          `Unknown target section "${operation.to_section}".`
        );
      }

      newBookmarks.push({
        ...newBookmarks[index],
        category:
          target,
      });

      messages.push(
        `Copied "${operation.title}" to "${target}".`
      );
    }


    // --------------------------------------------------
    // ADD CONTACT
    // --------------------------------------------------

    // --------------------------------------------------
    // UPDATE CONTACT
    // --------------------------------------------------

    else if (
      operation.type ===
      "update_contact"
    ) {

      const section =
        findCategoryExact(
          newOrder,
          operation.section
        );

      if (!section) {
        throw new Error(
          `Unknown section "${operation.section}".`
        );
      }


      const requestedName =
        normalize(
          operation.name
        );


      const matches =
        newBookmarks
          .map(
            (item, index) => ({
              item,
              index,
            })
          )
          .filter(
            ({ item }) =>
              normalize(
                item.category
              ) ===
                normalize(section) &&
              (
                normalize(
                  item.title
                ) ===
                  requestedName ||

                normalize(
                  item.title
                ).startsWith(
                  `${requestedName} |`
                )
              )
          );


      if (
        matches.length === 0
      ) {
        throw new Error(
          `Contact "${operation.name}" was not found in "${section}".`
        );
      }


      if (
        matches.length > 1
      ) {
        throw new Error(
          `More than one contact named "${operation.name}" was found.`
        );
      }


      const index =
        matches[0].index;

      const existing =
        newBookmarks[index];


      // --------------------------------------------------
      // Recover older combined-title contacts
      // --------------------------------------------------

      const oldParts =
        String(
          existing.title ?? ""
        )
          .split("|")
          .map(
            (part) =>
              part.trim()
          );


      const oldName =
        oldParts[0] ||
        existing.title ||
        "";

      const oldPhone =
        existing.phone ||
        oldParts[1] ||
        "";

      const oldEmail =
        existing.email ||
        oldParts[2] ||
        "";


      const newName =
        operation.new_name ||
        oldName;

      const newPhone =
        operation.new_phone ||
        oldPhone;

      const newEmail =
        operation.new_email ||
        oldEmail;


      // --------------------------------------------------
      // Validate newly supplied information
      // --------------------------------------------------

      if (
        operation.new_phone &&
        normalize(
          operation.new_phone
        ) !==
          normalize(
            oldPhone
          ) &&
        !staffRequest.includes(
          operation.new_phone
        )
      ) {
        throw new Error(
          `Phone number "${operation.new_phone}" was not found in the staff request.`
        );
      }


      if (
        operation.new_email &&
        normalize(
          operation.new_email
        ) !==
          normalize(
            oldEmail
          ) &&
        !staffRequest.includes(
          operation.new_email
        )
      ) {
        throw new Error(
          `Email "${operation.new_email}" was not found in the staff request.`
        );
      }


      newBookmarks[index] = {
        ...existing,

        title:
          newName,

        phone:
          newPhone,

        email:
          newEmail,

        url:
          "",

        category:
          section,

        domain:
          "",

        type:
          "contact",
      };


      messages.push(
        `Updated contact "${operation.name}" in "${section}".`
      );
    }

    else if (
      operation.type ===
      "add_contact"
    ) {

      const section =
        findCategoryExact(
          newOrder,
          operation.section
        );

      if (!section) {
        throw new Error(
          `Unknown section "${operation.section}".`
        );
      }


      const name =
        String(
          operation.name ?? ""
        ).trim();

      const phone =
        String(
          operation.phone ?? ""
        ).trim();

      const email =
        String(
          operation.email ?? ""
        ).trim();


      if (!name) {
        throw new Error(
          "Contact name is required."
        );
      }


      // Build plain information text.
      // Example:
      // Mohammad Khalid Daneshwar | 916-547-9502 | DaneshM@arc.losrios.edu

      // Make sure the AI did not invent
      // contact information.

      if (
        phone &&
        !staffRequest.includes(
          phone
        )
      ) {
        throw new Error(
          `Phone number "${phone}" was not found in the staff request.`
        );
      }


      if (
        email &&
        !staffRequest.includes(
          email
        )
      ) {
        throw new Error(
          `Email "${email}" was not found in the staff request.`
        );
      }


      newBookmarks.push({
        title:
          name,

        phone:
          phone,

        email:
          email,

        url:
          "",

        category:
          section,

        domain:
          "",

        type:
          "contact",
      });

      messages.push(
        `Added contact "${name}" to "${section}".`
      );
    }

        // --------------------------------------------------
    // REMOVE CONTACT
    // --------------------------------------------------

    else if (
      operation.type ===
      "remove_contact"
    ) {

      const section =
        findCategoryExact(
          newOrder,
          operation.section
        );

      if (!section) {
        throw new Error(
          `Unknown section "${operation.section}".`
        );
      }


      const requestedName =
        normalize(
          operation.name
        );


      const matches =
        newBookmarks
          .map(
            (item, index) => ({
              item,
              index,
            })
          )
          .filter(
            ({ item }) =>
              normalize(
                item.category
              ) ===
                normalize(section) &&
              (
                normalize(
                  item.title
                ) ===
                  requestedName ||

                normalize(
                  item.title
                ).startsWith(
                  `${requestedName} |`
                )
              )
          );


      if (
        matches.length === 0
      ) {
        throw new Error(
          `Contact "${operation.name}" was not found in "${section}".`
        );
      }


      if (
        matches.length > 1
      ) {
        throw new Error(
          `More than one contact named "${operation.name}" was found.`
        );
      }


      newBookmarks.splice(
        matches[0].index,
        1
      );


      messages.push(
        `Removed contact "${operation.name}" from "${section}".`
      );
    }



    // --------------------------------------------------
    // ADD SECTION
    // --------------------------------------------------

    else if (
      operation.type ===
      "add_section"
    ) {

      // Make sure the new section does not already exist.
      if (
        findCategoryExact(
          newOrder,
          operation.name
        )
      ) {
        throw new Error(
          `Section "${operation.name}" already exists.`
        );
      }


      const requestedReference =
        operation.after_section ||
        operation.before_section;

      const insertAfter =
        Boolean(
          operation.after_section
        );


      if (!requestedReference) {
        throw new Error(
          "CodEase could not determine where the new section should be placed."
        );
      }


      // --------------------------------------------------
      // The reference may be:
      //
      // 1. A real section, such as "Rooms"
      // 2. A group heading, such as "Administration"
      // --------------------------------------------------

      const referenceSection =
        findCategoryExact(
          newOrder,
          requestedReference
        );

      const referenceGroup =
        findLrcGroupExact(
          newGroups,
          requestedReference
        );


      // ==================================================
      // CASE 1: REFERENCE IS AN EXISTING SECTION
      // ==================================================

      if (referenceSection) {

        const group =
          findLrcGroupForCategory(
            newGroups,
            referenceSection
          );

        if (!group) {
          throw new Error(
            `Could not determine the group for "${referenceSection}".`
          );
        }


        let insertIndex =
          newOrder.indexOf(
            referenceSection
          );


        if (insertAfter) {

          insertIndex++;


          // Keep subsections attached to their parent.
          while (
            insertIndex <
              newOrder.length &&
            newOrder[
              insertIndex
            ].startsWith(
              `${referenceSection} / `
            )
          ) {
            insertIndex++;
          }

        }


        newOrder.splice(
          insertIndex,
          0,
          operation.name
        );


        // categoryGroups is:
        //
        // "Rooms": "Administration"
        //
        // So assign the new section directly to the
        // same group as the reference section.

        newGroups[
          operation.name
        ] =
          group;


        messages.push(
          `Added section "${operation.name}" ${
            insertAfter
              ? "after"
              : "before"
          } "${referenceSection}".`
        );

        continue;
      }


      // ==================================================
      // CASE 2: REFERENCE IS A GROUP HEADING
      // ==================================================

      if (referenceGroup) {

        const groupCategories =
          newOrder.filter(
            (category) =>
              normalize(
                newGroups[
                  category
                ]
              ) ===
              normalize(
                referenceGroup
              )
          );


        if (
          !groupCategories.length
        ) {
          throw new Error(
            `Group "${referenceGroup}" does not contain any sections.`
          );
        }


        let insertIndex;


        // ----------------------------------------------
        // AFTER group
        // ----------------------------------------------

        if (insertAfter) {

          const lastCategory =
            groupCategories[
              groupCategories.length - 1
            ];

          insertIndex =
            newOrder.indexOf(
              lastCategory
            ) + 1;


          // If the final category has subsections,
          // keep them with their parent.
          while (
            insertIndex <
              newOrder.length &&
            newOrder[
              insertIndex
            ].startsWith(
              `${lastCategory} / `
            )
          ) {
            insertIndex++;
          }

        }


        // ----------------------------------------------
        // BEFORE group
        // ----------------------------------------------

        else {

          const firstCategory =
            groupCategories[0];

          insertIndex =
            newOrder.indexOf(
              firstCategory
            );

        }


        newOrder.splice(
          insertIndex,
          0,
          operation.name
        );


        // The new section belongs to the referenced group.
        newGroups[
          operation.name
        ] =
          referenceGroup;


        messages.push(
          `Added section "${operation.name}" ${
            insertAfter
              ? "after"
              : "before"
          } the "${referenceGroup}" group.`
        );

        continue;
      }


      // ==================================================
      // NOTHING MATCHED
      // ==================================================

      throw new Error(
        `Could not find a section or group named "${requestedReference}".`
      );
    }

    // --------------------------------------------------
    // RENAME SECTION
    // --------------------------------------------------

    else if (
      operation.type ===
      "rename_section"
    ) {
      const oldName =
        findCategoryExact(
          newOrder,
          operation.old_name
        );

      if (!oldName) {
        throw new Error(
          `Section "${operation.old_name}" was not found.`
        );
      }

      for (
        let i = 0;
        i < newOrder.length;
        i++
      ) {
        if (
          normalize(
            newOrder[i]
          ) ===
          normalize(oldName)
        ) {
          newOrder[i] =
            operation.new_name;
        }

        else if (
          newOrder[i].startsWith(
            `${oldName} / `
          )
        ) {
          newOrder[i] =
            `${operation.new_name}${newOrder[i].slice(oldName.length)}`;
        }
      }

      for (
        const categories
        of Object.values(
          newGroups
        )
      ) {
        for (
          let i = 0;
          i < categories.length;
          i++
        ) {
          if (
            normalize(
              categories[i]
            ) ===
            normalize(oldName)
          ) {
            categories[i] =
              operation.new_name;
          }

          else if (
            categories[i].startsWith(
              `${oldName} / `
            )
          ) {
            categories[i] =
              `${operation.new_name}${categories[i].slice(oldName.length)}`;
          }
        }
      }

      for (
        const bookmark
        of newBookmarks
      ) {
        if (
          normalize(
            bookmark.category
          ) ===
          normalize(oldName)
        ) {
          bookmark.category =
            operation.new_name;
        }

        else if (
          bookmark.category.startsWith(
            `${oldName} / `
          )
        ) {
          bookmark.category =
            `${operation.new_name}${bookmark.category.slice(oldName.length)}`;
        }
      }

      messages.push(
        `Renamed section "${oldName}" to "${operation.new_name}".`
      );
    }


    // --------------------------------------------------
    // REMOVE SECTION
    // --------------------------------------------------

    else if (
      operation.type ===
      "remove_section"
    ) {
      const section =
        findCategoryExact(
          newOrder,
          operation.name
        );

      if (!section) {
        throw new Error(
          `Section "${operation.name}" was not found.`
        );
      }

      for (
        let i =
          newOrder.length - 1;
        i >= 0;
        i--
      ) {
        if (
          normalize(
            newOrder[i]
          ) ===
            normalize(section) ||
          newOrder[i].startsWith(
            `${section} / `
          )
        ) {
          newOrder.splice(
            i,
            1
          );
        }
      }

      for (
        const categories
        of Object.values(
          newGroups
        )
      ) {
        for (
          let i =
            categories.length - 1;
          i >= 0;
          i--
        ) {
          if (
            normalize(
              categories[i]
            ) ===
              normalize(section) ||
            categories[i].startsWith(
              `${section} / `
            )
          ) {
            categories.splice(
              i,
              1
            );
          }
        }
      }

      for (
        let i =
          newBookmarks.length - 1;
        i >= 0;
        i--
      ) {
        if (
          normalize(
            newBookmarks[i].category
          ) ===
            normalize(section) ||
          newBookmarks[i].category.startsWith(
            `${section} / `
          )
        ) {
          newBookmarks.splice(
            i,
            1
          );
        }
      }

      messages.push(
        `Removed section "${section}" and its contents.`
      );
    }


    // --------------------------------------------------
    // ADD SUBSECTION
    // --------------------------------------------------

    else if (
      operation.type ===
      "add_subsection"
    ) {
      const parent =
        findCategoryExact(
          newOrder,
          operation.parent
        );

      if (!parent) {
        throw new Error(
          `Parent section "${operation.parent}" was not found.`
        );
      }

      const newCategory =
        `${parent} / ${operation.name}`;

      if (
        findCategoryExact(
          newOrder,
          newCategory
        )
      ) {
        throw new Error(
          `Subsection "${newCategory}" already exists.`
        );
      }

      let insertionIndex =
        newOrder.indexOf(
          parent
        ) + 1;

      while (
        insertionIndex <
          newOrder.length &&
        newOrder[
          insertionIndex
        ].startsWith(
          `${parent} / `
        )
      ) {
        insertionIndex++;
      }

      newOrder.splice(
        insertionIndex,
        0,
        newCategory
      );

      const group =
        findLrcGroupForCategory(
          newGroups,
          parent
        );

      if (group) {
        const groupList =
          newGroups[group];

        let groupIndex =
          groupList.indexOf(
            parent
          ) + 1;

        while (
          groupIndex <
            groupList.length &&
          groupList[
            groupIndex
          ].startsWith(
            `${parent} / `
          )
        ) {
          groupIndex++;
        }

        groupList.splice(
          groupIndex,
          0,
          newCategory
        );
      }

      messages.push(
        `Added subsection "${operation.name}" under "${parent}".`
      );
    }


    // --------------------------------------------------
    // RENAME SUBSECTION
    // --------------------------------------------------

    else if (
      operation.type ===
      "rename_subsection"
    ) {
      const parent =
        findCategoryExact(
          newOrder,
          operation.parent
        );

      if (!parent) {
        throw new Error(
          `Parent "${operation.parent}" was not found.`
        );
      }

      const oldCategory =
        findCategoryExact(
          newOrder,
          `${parent} / ${operation.old_name}`
        );

      if (!oldCategory) {
        throw new Error(
          `Subsection "${operation.old_name}" was not found under "${parent}".`
        );
      }

      const newCategory =
        `${parent} / ${operation.new_name}`;

      const orderIndex =
        newOrder.indexOf(
          oldCategory
        );

      newOrder[
        orderIndex
      ] =
        newCategory;

      for (
        const categories
        of Object.values(
          newGroups
        )
      ) {
        const index =
          categories.indexOf(
            oldCategory
          );

        if (index !== -1) {
          categories[index] =
            newCategory;
        }
      }

      for (
        const bookmark
        of newBookmarks
      ) {
        if (
          normalize(
            bookmark.category
          ) ===
          normalize(oldCategory)
        ) {
          bookmark.category =
            newCategory;
        }
      }

      messages.push(
        `Renamed subsection "${operation.old_name}" to "${operation.new_name}".`
      );
    }


    // --------------------------------------------------
    // REMOVE SUBSECTION
    // --------------------------------------------------

    else if (
      operation.type ===
      "remove_subsection"
    ) {
      const parent =
        findCategoryExact(
          newOrder,
          operation.parent
        );

      if (!parent) {
        throw new Error(
          `Parent "${operation.parent}" was not found.`
        );
      }

      const category =
        findCategoryExact(
          newOrder,
          `${parent} / ${operation.name}`
        );

      if (!category) {
        throw new Error(
          `Subsection "${operation.name}" was not found.`
        );
      }

      const orderIndex =
        newOrder.indexOf(
          category
        );

      newOrder.splice(
        orderIndex,
        1
      );

      for (
        const categories
        of Object.values(
          newGroups
        )
      ) {
        const index =
          categories.indexOf(
            category
          );

        if (index !== -1) {
          categories.splice(
            index,
            1
          );
        }
      }

      for (
        let i =
          newBookmarks.length - 1;
        i >= 0;
        i--
      ) {
        if (
          normalize(
            newBookmarks[i].category
          ) ===
          normalize(category)
        ) {
          newBookmarks.splice(
            i,
            1
          );
        }
      }

      messages.push(
        `Removed subsection "${operation.name}".`
      );
    }


    else {
      throw new Error(
        `Unsupported LRC operation "${operation.type}".`
      );
    }
  }

  return {
    bookmarks:
      newBookmarks,

    categoryOrder:
      newOrder,

    categoryGroups:
      newGroups,

    messages,
  };
}


// ======================================================
// SECTION 16: RUN LRC WORKFLOW
// ======================================================

async function handleLrcHub({
  octokit,
  owner,
  repo,
  baseBranch,
  staffRequest,
  rl,
}) {
  const bookmarkCode =
    await readGitHubFile(
      octokit,
      owner,
      repo,
      "bookmarks-data.js",
      baseBranch
    );

  const scriptCode =
    await readGitHubFile(
      octokit,
      owner,
      repo,
      "script.js",
      baseBranch
    );

  const bookmarks =
    parseBookmarks(
      bookmarkCode
    );

  const {
    categoryOrder,
    categoryGroups,
  } =
    readLrcStructure(
      scriptCode
    );

  console.log(
    `Loaded ${bookmarks.length} LRC resources.`
  );

  const plan =
    await createLrcPlan(
      staffRequest,
      bookmarks,
      categoryOrder,
      categoryGroups
    );

  console.log(
    "\nCHANGE PLAN"
  );

  console.log(
    "===========\n"
  );

  console.log(
    plan.summary
  );

  console.log(
    `\nReason:\n${plan.reason}`
  );

  if (!plan.safe) {
    console.log(
      "\nNo changes were made."
    );

    return;
  }

  if (
    !Array.isArray(
      plan.operations
    ) ||
    !plan.operations.length
  ) {
    throw new Error(
      "No valid operations were generated."
    );
  }

  const result =
    applyLrcOperations({
      bookmarks,
      categoryOrder,
      categoryGroups,
      operations:
        plan.operations,
      staffRequest,
    });

  const newBookmarksCode =
    writeBookmarks(
      bookmarkCode,
      result.bookmarks
    );

  const newScriptCode =
    writeLrcStructure(
      scriptCode,
      result.categoryOrder,
      result.categoryGroups
    );

  const changedFiles = [];

  if (
    newBookmarksCode !==
    bookmarkCode
  ) {
    changedFiles.push({
      path:
        "bookmarks-data.js",
      content:
        newBookmarksCode,
    });
  }

  if (
    newScriptCode !==
    scriptCode
  ) {
    changedFiles.push({
      path:
        "script.js",
      content:
        newScriptCode,
    });
  }

  if (!changedFiles.length) {
    throw new Error(
      "No actual changes were produced."
    );
  }

  console.log(
    "\nVALIDATED CHANGES"
  );

  console.log(
    "================="
  );

  result.messages.forEach(
    (message) =>
      console.log(
        `✓ ${message}`
      )
  );

  console.log(
    "\nFiles:"
  );

  changedFiles.forEach(
    (file) =>
      console.log(
        `✓ ${file.path}`
      )
  );

  const approval =
    await rl.question(
      "\nApply this change to the LRC Hub? (yes/no)\n> "
    );

  if (
    normalize(
      approval
    ) !== "yes"
  ) {
    console.log(
      "\nCanceled."
    );

    return;
  }

  const prNumber =
    await publishFiles({
      octokit,
      owner,
      repo,
      baseBranch,

      files:
        changedFiles,

      summary:
        plan.summary,

      staffRequest,
    });

  console.log(
    "\nSUCCESS"
  );

  console.log(
    "======="
  );

  console.log(
    "\nLRC Hub updated successfully."
  );

  console.log(
    `Merged PR #${prNumber}`
  );
}


// ======================================================
// SECTION 17: LIBRARY TAB EXTRACTOR
// ======================================================

function extractLibraryTabs(
  html
) {
  const tabs = [];

  const regex =
    /<button[^>]*class=["'][^"']*tab-button[^"']*["'][^>]*data-tab=["']([^"']+)["'][^>]*>([\s\S]*?)<\/button>/gi;

  let match;

  while (
    (
      match =
        regex.exec(html)
    )
  ) {
    tabs.push({
      id:
        match[1].trim(),

      title:
        match[2]
          .replace(
            /<[^>]+>/g,
            ""
          )
          .trim(),
    });
  }

  return tabs;
}


// ======================================================
// SECTION 18: LIBRARY TAB SECTION FINDER
// ======================================================

function findLibraryTabSection(
  html,
  tabId
) {
  const pattern =
    new RegExp(
      `<section\\b[^>]*class=["'][^"']*tab-content[^"']*["'][^>]*id=["']${escapeRegex(
        tabId
      )}["'][^>]*>[\\s\\S]*?<\\/section>`,
      "i"
    );

  const match =
    pattern.exec(html);

  if (!match) {
    throw new Error(
      `Could not find tab "${tabId}".`
    );
  }

  return {
    text:
      match[0],

    start:
      match.index,

    end:
      match.index +
      match[0].length,
  };
}


// ======================================================
// SECTION 19: LIBRARY LINKS / HEADINGS / ITEMS
// ======================================================

function extractLibraryStructure(
  html
) {
  const tabs =
    extractLibraryTabs(
      html
    );

  const links = [];
  const sections = [];
  const subsections = [];
  const items = [];

  for (
    const tab of tabs
  ) {
    let info;

    try {
      info =
        findLibraryTabSection(
          html,
          tab.id
        );

    } catch {
      continue;
    }

    const content =
      info.text;


    // ------------------------------
    // Links
    // ------------------------------

    const linkRegex =
      /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let linkMatch;

    while (
      (
        linkMatch =
          linkRegex.exec(
            content
          )
      )
    ) {
      links.push({
        tab_id:
          tab.id,

        title:
          linkMatch[2]
            .replace(
              /<[^>]+>/g,
              ""
            )
            .trim(),

        url:
          linkMatch[1],
      });
    }


    // ------------------------------
    // H2 = sections
    // H3 = subsections
    // LI without <a> = plain content item
    // ------------------------------

    const structureRegex =
      /<(h2|h3|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;

    let structureMatch;

    let currentSection =
      null;

    let currentSubsection =
      null;

    while (
      (
        structureMatch =
          structureRegex.exec(
            content
          )
      )
    ) {
      const tag =
        structureMatch[1]
          .toLowerCase();

      const rawContent =
        structureMatch[2];

      const text =
        rawContent
          .replace(
            /<[^>]+>/g,
            ""
          )
          .replace(
            /\s+/g,
            " "
          )
          .trim();


      // ------------------------------
      // H2
      // ------------------------------

      if (
        tag === "h2"
      ) {
        currentSection =
          text;

        currentSubsection =
          null;

        sections.push({
          tab_id:
            tab.id,

          name:
            text,
        });

        continue;
      }


      // ------------------------------
      // H3
      // ------------------------------

      if (
        tag === "h3"
      ) {
        currentSubsection =
          text;

        subsections.push({
          tab_id:
            tab.id,

          section:
            currentSection,

          name:
            text,
        });

        continue;
      }


      // ------------------------------
      // Plain LI item
      //
      // If it contains an <a>, it is already handled
      // by the link system and is NOT a plain item.
      // ------------------------------

      if (
        tag === "li"
      ) {
        const containsLink =
          /<a\b/i.test(
            rawContent
          );

        if (
          !containsLink &&
          text
        ) {
          items.push({
            tab_id:
              tab.id,

            section:
              currentSection,

            subsection:
              currentSubsection,

            text,
          });
        }
      }
    }
  }

  return {
    tabs,
    links,
    sections,
    subsections,
    items,
  };
}

// ======================================================
// SECTION 20: LIBRARY OPERATION PLANNER
// ======================================================

async function createLibraryPlan(
  staffRequest,
  structure
) {
  const response =
    await openai.responses.create({
      model:
        "gpt-5.4-mini",

      input: `
You are CodEase.

You manage the ARC Library Hub.

The Library Hub stores tabs, sections, subsections,
links, and plain content items directly in Index.html.


SUPPORTED OPERATIONS:

LINKS
- add_link
- update_link
- remove_link
- move_link

PLAIN CONTENT ITEMS
- add_item
- update_item
- remove_item

TABS
- add_tab
- rename_tab
- remove_tab

SECTIONS
- add_section
- rename_section
- remove_section

SUBSECTIONS
- add_subsection
- rename_subsection
- remove_subsection


IMPORTANT CONTENT RULES:

A plain content item is text stored inside an HTML <li>
without an <a> link.

Examples include:

- employee names
- email addresses shown as text
- phone numbers
- contact information
- instructions
- informational list entries

DO NOT convert an email address into mailto:.

An email address written by staff is plain text unless
the staff explicitly asks for it to be clickable,
asks for an email link, or literally supplies a
mailto: URL.

Example request:

"Under ARC Library Temporary Classified add
Mohammad Khalid Daneshwar | DaneshM@arc.losrios.edu"

This MUST use:

{
  "type": "add_item",
  "tab_id": "contacts",
  "section": null,
  "subsection": "ARC Library Temporary Classified",
  "text": "Mohammad Khalid Daneshwar | DaneshM@arc.losrios.edu"
}

It MUST NOT use add_link.
It MUST NOT create mailto:.


HTML MODEL:

- A tab button uses .tab-button and data-tab.
- A matching tab content area uses .tab-content with the same id.
- H2 headings are sections inside tabs.
- H3 headings are subsections inside tabs.
- Plain text list entries use <li>.
- Hyperlinks use <a>.
- Do not change CSS.
- Do not change JavaScript.
- Do not invent URLs.
- Do not invent mailto: URLs.
- Do not change unrelated content.
- If the request is ambiguous, return safe:false.


CURRENT TABS:
${JSON.stringify(
  structure.tabs,
  null,
  2
)}

CURRENT SECTIONS:
${JSON.stringify(
  structure.sections,
  null,
  2
)}

CURRENT SUBSECTIONS:
${JSON.stringify(
  structure.subsections,
  null,
  2
)}

CURRENT LINKS:
${JSON.stringify(
  structure.links,
  null,
  2
)}

CURRENT PLAIN CONTENT ITEMS:
${JSON.stringify(
  structure.items,
  null,
  2
)}

STAFF REQUEST:
${staffRequest}


RETURN ONLY JSON:

{
  "safe": true,
  "summary": "Short summary",
  "operations": [],
  "reason": "Short reason"
}


ADD LINK:

{
  "type": "add_link",
  "tab_id": "existing-tab",
  "section": null,
  "subsection": null,
  "title": "Link title",
  "url": "https://..."
}


UPDATE LINK:

{
  "type": "update_link",
  "tab_id": "existing-tab",
  "title": "Existing link",
  "new_title": null,
  "new_url": null
}


REMOVE LINK:

{
  "type": "remove_link",
  "tab_id": "existing-tab",
  "title": "Existing link"
}


MOVE LINK:

{
  "type": "move_link",
  "title": "Existing link",
  "from_tab_id": "source",
  "to_tab_id": "target",
  "to_section": null,
  "to_subsection": null
}


ADD ITEM:

{
  "type": "add_item",
  "tab_id": "existing-tab",
  "section": null,
  "subsection": "Existing subsection",
  "text": "Exact requested text"
}


UPDATE ITEM:

{
  "type": "update_item",
  "tab_id": "existing-tab",
  "section": null,
  "subsection": "Existing subsection",
  "old_text": "Existing exact item",
  "new_text": "Requested replacement text"
}


REMOVE ITEM:

{
  "type": "remove_item",
  "tab_id": "existing-tab",
  "section": null,
  "subsection": "Existing subsection",
  "text": "Existing exact item"
}


ADD TAB:

{
  "type": "add_tab",
  "title": "New Tab"
}


RENAME TAB:

{
  "type": "rename_tab",
  "tab_id": "existing-id",
  "new_title": "New title"
}


REMOVE TAB:

{
  "type": "remove_tab",
  "tab_id": "existing-id"
}


ADD SECTION:

{
  "type": "add_section",
  "tab_id": "existing-tab",
  "name": "New section"
}


RENAME SECTION:

{
  "type": "rename_section",
  "tab_id": "existing-tab",
  "old_name": "Old section",
  "new_name": "New section"
}


REMOVE SECTION:

{
  "type": "remove_section",
  "tab_id": "existing-tab",
  "name": "Section"
}


ADD SUBSECTION:

{
  "type": "add_subsection",
  "tab_id": "existing-tab",
  "name": "New subsection"
}


RENAME SUBSECTION:

{
  "type": "rename_subsection",
  "tab_id": "existing-tab",
  "old_name": "Old subsection",
  "new_name": "New subsection"
}


REMOVE SUBSECTION:

{
  "type": "remove_subsection",
  "tab_id": "existing-tab",
  "name": "Subsection"
}
`,
    });

  try {
    return JSON.parse(
      cleanJson(
        response.output_text
      )
    );

  } catch {
    throw new Error(
      "CodEase returned an invalid Library Hub plan."
    );
  }
}

// ======================================================
// SECTION 21: LIBRARY TAB ID CREATOR
// ======================================================

function createTabId(
  title
) {
  return normalize(title)
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );
}


// ======================================================
// SECTION 22: REPLACE LIBRARY TAB SECTION
// ======================================================

function replaceLibraryTabSection(
  html,
  tabId,
  newSection
) {
  const info =
    findLibraryTabSection(
      html,
      tabId
    );

  return (
    html.slice(
      0,
      info.start
    ) +
    newSection +
    html.slice(
      info.end
    )
  );
}


// ======================================================
// SECTION 23: LIBRARY ADD LINK
// ======================================================

function libraryAddLink(
  html,
  operation,
  staffRequest
) {
  verifyUrlFromRequest(
    staffRequest,
    operation.url
  );

  const info =
    findLibraryTabSection(
      html,
      operation.tab_id
    );

  let section =
    info.text;

  const linkHtml =
    `<li><a href="${escapeHtml(
      operation.url
    )}" target="_blank">${escapeHtml(
      operation.title
    )}</a></li>`;


  // --------------------------------------------------
  // Target subsection H3 + UL
  // --------------------------------------------------

  if (
    operation.subsection
  ) {
    const pattern =
      new RegExp(
        `(<h3\\b[^>]*>\\s*${escapeRegex(
          operation.subsection
        )}\\s*<\\/h3>\\s*<ul\\b[^>]*>)([\\s\\S]*?)(<\\/ul>)`,
        "i"
      );

    if (
      !pattern.test(
        section
      )
    ) {
      throw new Error(
        `Could not find subsection "${operation.subsection}".`
      );
    }

    section =
      section.replace(
        pattern,
        `$1$2\n                    ${linkHtml}\n                $3`
      );
  }


  // --------------------------------------------------
  // Otherwise append link to tab content
  // --------------------------------------------------

  else {
    const closing =
      section.lastIndexOf(
        "</div>"
      );

    if (
      closing === -1
    ) {
      throw new Error(
        "Could not find Library Hub insertion point."
      );
    }

    section =
      section.slice(
        0,
        closing
      ) +
      `\n                <a href="${escapeHtml(
        operation.url
      )}" target="_blank" class="link-button">${escapeHtml(
        operation.title
      )}</a>\n            ` +
      section.slice(
        closing
      );
  }

  return replaceLibraryTabSection(
    html,
    operation.tab_id,
    section
  );
}


// ======================================================
// SECTION 24: LIBRARY UPDATE LINK
// ======================================================

function libraryUpdateLink(
  html,
  operation,
  staffRequest
) {
  const info =
    findLibraryTabSection(
      html,
      operation.tab_id
    );

  const titlePattern =
    escapeRegex(
      operation.title
    );

  const linkRegex =
    new RegExp(
      `<a\\b([^>]*)href=["']([^"']*)["']([^>]*)>\\s*${titlePattern}\\s*<\\/a>`,
      "i"
    );

  const match =
    linkRegex.exec(
      info.text
    );

  if (!match) {
    throw new Error(
      `Could not find link "${operation.title}".`
    );
  }

  let newTitle =
    operation.title;

  let newUrl =
    match[2];

  if (
    operation.new_title
  ) {
    newTitle =
      operation.new_title;
  }

  if (
    operation.new_url
  ) {
    verifyUrlFromRequest(
      staffRequest,
      operation.new_url
    );

    newUrl =
      operation.new_url;
  }

  const replacement =
    `<a${match[1]}href="${escapeHtml(
      newUrl
    )}"${match[3]}>${escapeHtml(
      newTitle
    )}</a>`;

  const newSection =
    info.text.replace(
      linkRegex,
      replacement
    );

  return replaceLibraryTabSection(
    html,
    operation.tab_id,
    newSection
  );
}


// ======================================================
// SECTION 25: LIBRARY REMOVE LINK
// ======================================================

function libraryRemoveLink(
  html,
  operation
) {
  const info =
    findLibraryTabSection(
      html,
      operation.tab_id
    );

  const title =
    escapeRegex(
      operation.title
    );

  const liPattern =
    new RegExp(
      `\\s*<li>\\s*<a\\b[^>]*>\\s*${title}\\s*<\\/a>\\s*<\\/li>`,
      "i"
    );

  const anchorPattern =
    new RegExp(
      `\\s*<a\\b[^>]*>\\s*${title}\\s*<\\/a>`,
      "i"
    );

  let newSection =
    info.text;

  if (
    liPattern.test(
      newSection
    )
  ) {
    newSection =
      newSection.replace(
        liPattern,
        ""
      );
  }

  else if (
    anchorPattern.test(
      newSection
    )
  ) {
    newSection =
      newSection.replace(
        anchorPattern,
        ""
      );
  }

  else {
    throw new Error(
      `Could not find link "${operation.title}".`
    );
  }

  return replaceLibraryTabSection(
    html,
    operation.tab_id,
    newSection
  );
}


// ======================================================
// SECTION 26: LIBRARY ADD TAB
// ======================================================

function libraryAddTab(
  html,
  operation
) {
  const id =
    createTabId(
      operation.title
    );

  if (!id) {
    throw new Error(
      "Could not create tab ID."
    );
  }

  if (
    new RegExp(
      `data-tab=["']${escapeRegex(
        id
      )}["']`,
      "i"
    ).test(html)
  ) {
    throw new Error(
      `Tab "${operation.title}" already appears to exist.`
    );
  }

  const navEnd =
    html.indexOf(
      "</nav>"
    );

  if (
    navEnd === -1
  ) {
    throw new Error(
      "Could not find Library Hub navigation."
    );
  }

  const button =
    `            <button class="tab-button" data-tab="${id}">${escapeHtml(
      operation.title
    )}</button>\n`;

  html =
    html.slice(
      0,
      navEnd
    ) +
    button +
    html.slice(
      navEnd
    );

  const mainEnd =
    html.lastIndexOf(
      "</main>"
    );

  if (
    mainEnd === -1
  ) {
    throw new Error(
      "Could not find Library Hub main section."
    );
  }

  const section =
`
        <section class="tab-content" id="${id}">
            <div class="content-card">
                <h2>${escapeHtml(operation.title)}</h2>
            </div>
        </section>

`;

  return (
    html.slice(
      0,
      mainEnd
    ) +
    section +
    html.slice(
      mainEnd
    )
  );
}


// ======================================================
// SECTION 27: LIBRARY RENAME TAB
// ======================================================

function libraryRenameTab(
  html,
  operation
) {
  const buttonPattern =
    new RegExp(
      `(<button\\b[^>]*data-tab=["']${escapeRegex(
        operation.tab_id
      )}["'][^>]*>)[\\s\\S]*?(<\\/button>)`,
      "i"
    );

  if (
    !buttonPattern.test(
      html
    )
  ) {
    throw new Error(
      `Tab "${operation.tab_id}" was not found.`
    );
  }

  return html.replace(
    buttonPattern,
    `$1${escapeHtml(
      operation.new_title
    )}$2`
  );
}


// ======================================================
// SECTION 28: LIBRARY REMOVE TAB
// ======================================================

function libraryRemoveTab(
  html,
  operation
) {
  const buttonPattern =
    new RegExp(
      `\\s*<button\\b[^>]*data-tab=["']${escapeRegex(
        operation.tab_id
      )}["'][^>]*>[\\s\\S]*?<\\/button>`,
      "i"
    );

  if (
    !buttonPattern.test(
      html
    )
  ) {
    throw new Error(
      `Tab "${operation.tab_id}" was not found.`
    );
  }

  html =
    html.replace(
      buttonPattern,
      ""
    );

  const info =
    findLibraryTabSection(
      html,
      operation.tab_id
    );

  return (
    html.slice(
      0,
      info.start
    ) +
    html.slice(
      info.end
    )
  );
}


// ======================================================
// SECTION 29: LIBRARY ADD SECTION
// ======================================================

function libraryAddSection(
  html,
  operation
) {
  const info =
    findLibraryTabSection(
      html,
      operation.tab_id
    );

  const closing =
    info.text.lastIndexOf(
      "</div>"
    );

  if (
    closing === -1
  ) {
    throw new Error(
      "Could not find section insertion point."
    );
  }

  const newSection =
    info.text.slice(
      0,
      closing
    ) +
    `\n                <h2>${escapeHtml(
      operation.name
    )}</h2>\n` +
    info.text.slice(
      closing
    );

  return replaceLibraryTabSection(
    html,
    operation.tab_id,
    newSection
  );
}


// ======================================================
// SECTION 30: LIBRARY RENAME HEADING
// ======================================================

function renameLibraryHeading(
  html,
  tabId,
  headingTag,
  oldName,
  newName
) {
  const info =
    findLibraryTabSection(
      html,
      tabId
    );

  const pattern =
    new RegExp(
      `(<${headingTag}\\b[^>]*>)\\s*${escapeRegex(
        oldName
      )}\\s*(<\\/${headingTag}>)`,
      "i"
    );

  if (
    !pattern.test(
      info.text
    )
  ) {
    throw new Error(
      `"${oldName}" was not found.`
    );
  }

  const section =
    info.text.replace(
      pattern,
      `$1${escapeHtml(
        newName
      )}$2`
    );

  return replaceLibraryTabSection(
    html,
    tabId,
    section
  );
}


// ======================================================
// SECTION 31: LIBRARY REMOVE HEADING BLOCK
// ======================================================

function removeLibraryHeadingBlock(
  html,
  tabId,
  headingTag,
  name
) {
  const info =
    findLibraryTabSection(
      html,
      tabId
    );

  const nextHeading =
    headingTag === "h2"
      ? "(?=<h2\\b|<\\/div>)"
      : "(?=<h3\\b|<h2\\b|<\\/div>)";

  const pattern =
    new RegExp(
      `<${headingTag}\\b[^>]*>\\s*${escapeRegex(
        name
      )}\\s*<\\/${headingTag}>[\\s\\S]*?${nextHeading}`,
      "i"
    );

  if (
    !pattern.test(
      info.text
    )
  ) {
    throw new Error(
      `"${name}" was not found.`
    );
  }

  const section =
    info.text.replace(
      pattern,
      ""
    );

  return replaceLibraryTabSection(
    html,
    tabId,
    section
  );
}


// ======================================================
// SECTION 32: LIBRARY ADD SUBSECTION
// ======================================================

function libraryAddSubsection(
  html,
  operation
) {
  const info =
    findLibraryTabSection(
      html,
      operation.tab_id
    );

  const closing =
    info.text.lastIndexOf(
      "</div>"
    );

  if (
    closing === -1
  ) {
    throw new Error(
      "Could not find subsection insertion point."
    );
  }

  const content =
`
                <h3>${escapeHtml(operation.name)}</h3>
                <ul>
                </ul>
`;

  const section =
    info.text.slice(
      0,
      closing
    ) +
    content +
    info.text.slice(
      closing
    );

  return replaceLibraryTabSection(
    html,
    operation.tab_id,
    section
  );
}


// ======================================================
// SECTION 32B: LIBRARY PLAIN CONTENT ITEMS
// ======================================================

function verifyItemTextFromRequest(
  staffRequest,
  text
) {
  if (
    !staffRequest.includes(
      text
    )
  ) {
    throw new Error(
      `The text "${text}" was not found exactly in the staff request.`
    );
  }
}


function findLibraryItemList({
  html,
  tabId,
  section,
  subsection,
}) {
  const tabInfo =
    findLibraryTabSection(
      html,
      tabId
    );

  let headingTag;
  let headingName;

  if (
    subsection
  ) {
    headingTag =
      "h3";

    headingName =
      subsection;
  }

  else if (
    section
  ) {
    headingTag =
      "h2";

    headingName =
      section;
  }

  else {
    throw new Error(
      "A section or subsection is required for a plain content item."
    );
  }

  const pattern =
    new RegExp(
      `(<${headingTag}\\b[^>]*>\\s*${escapeRegex(
        headingName
      )}\\s*<\\/${headingTag}>\\s*<ul\\b[^>]*>)([\\s\\S]*?)(<\\/ul>)`,
      "i"
    );

  const match =
    pattern.exec(
      tabInfo.text
    );

  if (!match) {
    throw new Error(
      `Could not find a list directly under "${headingName}".`
    );
  }

  return {
    tabInfo,
    headingName,
    pattern,
    match,
  };
}


function extractPlainItemsFromList(
  listBody
) {
  const items = [];

  const regex =
    /<li\b[^>]*>([\s\S]*?)<\/li>/gi;

  let match;

  while (
    (
      match =
        regex.exec(
          listBody
        )
    )
  ) {
    const raw =
      match[1];

    if (
      /<a\b/i.test(
        raw
      )
    ) {
      continue;
    }

    const text =
      raw
        .replace(
          /<[^>]+>/g,
          ""
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    items.push({
      text,
      fullHtml:
        match[0],
      start:
        match.index,
      end:
        match.index +
        match[0].length,
    });
  }

  return items;
}


// ------------------------------------------------------
// ADD PLAIN ITEM
// ------------------------------------------------------

function libraryAddItem(
  html,
  operation,
  staffRequest
) {
  verifyItemTextFromRequest(
    staffRequest,
    operation.text
  );

  const target =
    findLibraryItemList({
      html,
      tabId:
        operation.tab_id,
      section:
        operation.section,
      subsection:
        operation.subsection,
    });

  const existingItems =
    extractPlainItemsFromList(
      target.match[2]
    );

  const duplicate =
    existingItems.some(
      (item) =>
        normalize(
          item.text
        ) ===
        normalize(
          operation.text
        )
    );

  if (duplicate) {
    throw new Error(
      `"${operation.text}" already exists under "${target.headingName}".`
    );
  }

  const escapedText =
    escapeHtml(
      operation.text
    );

  const updatedTab =
    target.tabInfo.text.replace(
      target.pattern,
      (
        _whole,
        opening,
        body,
        closing
      ) => {
        return (
          opening +
          body +
          `\n                    <li>${escapedText}</li>` +
          "\n                " +
          closing
        );
      }
    );

  return replaceLibraryTabSection(
    html,
    operation.tab_id,
    updatedTab
  );
}


// ======================================================
// SMART VALIDATION FOR UPDATED PLAIN ITEMS
// ======================================================

function verifyUpdatedItemFromRequest(
  staffRequest,
  oldText,
  newText
) {
  const normalizeForValidation =
    (value) =>
      String(value ?? "")
        .toLowerCase()

        // Treat formatting separators as spaces.
        .replace(/[|,:;()[\]{}]/g, " ")

        // Collapse whitespace.
        .replace(/\s+/g, " ")

        .trim();


  const normalizedRequest =
    normalizeForValidation(
      staffRequest
    );

  const normalizedOld =
    normalizeForValidation(
      oldText
    );

  const normalizedNew =
    normalizeForValidation(
      newText
    );


  // --------------------------------------------------
  // Staff supplied the complete final value
  // --------------------------------------------------

  if (
    normalizedRequest.includes(
      normalizedNew
    )
  ) {
    return true;
  }


  // --------------------------------------------------
  // Common case:
  //
  // Existing:
  // Mohammad | email
  //
  // Proposed:
  // Mohammad | email | phone
  //
  // Validate only what was appended.
  // --------------------------------------------------

  if (
    normalizedNew.startsWith(
      normalizedOld
    )
  ) {
    const addedText =
      normalizedNew
        .slice(
          normalizedOld.length
        )
        .trim();

    if (!addedText) {
      return true;
    }

    if (
      normalizedRequest.includes(
        addedText
      )
    ) {
      return true;
    }

    throw new Error(
      `CodEase tried to add information that was not found in the staff request: "${addedText}"`
    );
  }


  // --------------------------------------------------
  // General replacement case
  //
  // Find words/values that are NEW compared with
  // the existing repo item.
  // --------------------------------------------------

  const oldParts =
    new Set(
      normalizedOld
        .split(" ")
        .filter(Boolean)
    );

  const newParts =
    normalizedNew
      .split(" ")
      .filter(Boolean);

  const introducedParts =
    newParts.filter(
      (part) =>
        !oldParts.has(part)
    );


  // If nothing new is introduced, this may simply
  // be deletion/reformatting.
  if (
    introducedParts.length === 0
  ) {
    return true;
  }


  // Every genuinely new piece of information must
  // have come from the staff request.
  for (
    const part of
    introducedParts
  ) {
    if (
      !normalizedRequest.includes(
        part
      )
    ) {
      throw new Error(
        `CodEase tried to introduce information that was not found in the staff request: "${part}"`
      );
    }
  }

  return true;
}

// ------------------------------------------------------
// UPDATE PLAIN ITEM
// ------------------------------------------------------

function libraryUpdateItem(
  html,
  operation,
  staffRequest
) {
  const target =
    findLibraryItemList({
      html,
      tabId:
        operation.tab_id,
      section:
        operation.section,
      subsection:
        operation.subsection,
    });

  const existingItems =
    extractPlainItemsFromList(
      target.match[2]
    );

  const matches =
    existingItems.filter(
      (item) =>
        normalize(
          item.text
        ) ===
        normalize(
          operation.old_text
        )
    );

  if (
    matches.length === 0
  ) {
    throw new Error(
      `Could not find item "${operation.old_text}" under "${target.headingName}".`
    );
  }

  if (
    matches.length > 1
  ) {
    throw new Error(
      `Item "${operation.old_text}" appears more than once under "${target.headingName}".`
    );
  }

  // Validate only the NEW information introduced
  // by the update. Existing repo content does not
  // have to be repeated word-for-word by staff.
  verifyUpdatedItemFromRequest(
    staffRequest,
    operation.old_text,
    operation.new_text
  );

  const escapedNewText =
    escapeHtml(
      operation.new_text
    );

  const oldItem =
    matches[0];

  const newBody =
    target.match[2].slice(
      0,
      oldItem.start
    ) +
    `<li>${escapedNewText}</li>` +
    target.match[2].slice(
      oldItem.end
    );

  const updatedTab =
    target.tabInfo.text.replace(
      target.pattern,
      (
        _whole,
        opening,
        _body,
        closing
      ) =>
        opening +
        newBody +
        closing
    );

  return replaceLibraryTabSection(
    html,
    operation.tab_id,
    updatedTab
  );
}

// ------------------------------------------------------
// REMOVE PLAIN ITEM
// ------------------------------------------------------

function libraryRemoveItem(
  html,
  operation
) {
  const target =
    findLibraryItemList({
      html,
      tabId:
        operation.tab_id,
      section:
        operation.section,
      subsection:
        operation.subsection,
    });

  const existingItems =
    extractPlainItemsFromList(
      target.match[2]
    );

  const matches =
    existingItems.filter(
      (item) =>
        normalize(
          item.text
        ) ===
        normalize(
          operation.text
        )
    );

  if (
    matches.length === 0
  ) {
    throw new Error(
      `Could not find item "${operation.text}" under "${target.headingName}".`
    );
  }

  if (
    matches.length > 1
  ) {
    throw new Error(
      `Item "${operation.text}" appears more than once under "${target.headingName}".`
    );
  }

  const item =
    matches[0];

  const newBody =
    target.match[2].slice(
      0,
      item.start
    ) +
    target.match[2].slice(
      item.end
    );

  const updatedTab =
    target.tabInfo.text.replace(
      target.pattern,
      (
        _whole,
        opening,
        _body,
        closing
      ) =>
        opening +
        newBody +
        closing
    );

  return replaceLibraryTabSection(
    html,
    operation.tab_id,
    updatedTab
  );
}

// ======================================================
// SECTION 33: APPLY LIBRARY OPERATIONS
// ======================================================

function applyLibraryOperations(
  html,
  operations,
  staffRequest
) {
  let updated =
    html;

  const messages = [];

  for (
    const operation
    of operations
  ) {

    if (
      operation.type ===
      "add_link"
    ) {
      updated =
        libraryAddLink(
          updated,
          operation,
          staffRequest
        );

      messages.push(
        `Added link "${operation.title}".`
      );
    }


    else if (
      operation.type ===
      "update_link"
    ) {
      updated =
        libraryUpdateLink(
          updated,
          operation,
          staffRequest
        );

      messages.push(
        `Updated link "${operation.title}".`
      );
    }


    else if (
      operation.type ===
      "remove_link"
    ) {
      updated =
        libraryRemoveLink(
          updated,
          operation
        );

      messages.push(
        `Removed link "${operation.title}".`
      );
    }


    else if (
      operation.type ===
      "move_link"
    ) {
      const structure =
        extractLibraryStructure(
          updated
        );

      const source =
        structure.links.find(
          (link) =>
            normalize(
              link.title
            ) ===
              normalize(
                operation.title
              ) &&
            normalize(
              link.tab_id
            ) ===
              normalize(
                operation.from_tab_id
              )
        );

      if (!source) {
        throw new Error(
          `Could not find "${operation.title}".`
        );
      }

      updated =
        libraryRemoveLink(
          updated,
          {
            tab_id:
              operation.from_tab_id,

            title:
              operation.title,
          }
        );

      updated =
        libraryAddLink(
          updated,
          {
            tab_id:
              operation.to_tab_id,

            section:
              operation.to_section,

            subsection:
              operation.to_subsection,

            title:
              source.title,

            url:
              source.url,
          },
          source.url
        );

      messages.push(
        `Moved link "${operation.title}".`
      );
    }

    // --------------------------------------------------
    // ADD PLAIN CONTENT ITEM
    // --------------------------------------------------

    else if (
      operation.type ===
      "add_item"
    ) {
      updated =
        libraryAddItem(
          updated,
          operation,
          staffRequest
        );

      messages.push(
        `Added item "${operation.text}" under "${operation.subsection || operation.section}".`
      );
    }


    // --------------------------------------------------
    // UPDATE PLAIN CONTENT ITEM
    // --------------------------------------------------

    else if (
      operation.type ===
      "update_item"
    ) {
      updated =
        libraryUpdateItem(
          updated,
          operation,
          staffRequest
        );

      messages.push(
        `Updated item "${operation.old_text}".`
      );
    }


    // --------------------------------------------------
    // REMOVE PLAIN CONTENT ITEM
    // --------------------------------------------------

    else if (
      operation.type ===
      "remove_item"
    ) {
      updated =
        libraryRemoveItem(
          updated,
          operation
        );

      messages.push(
        `Removed item "${operation.text}".`
      );
    }

    else if (
      operation.type ===
      "add_tab"
    ) {
      updated =
        libraryAddTab(
          updated,
          operation
        );

      messages.push(
        `Added tab "${operation.title}".`
      );
    }


    else if (
      operation.type ===
      "rename_tab"
    ) {
      updated =
        libraryRenameTab(
          updated,
          operation
        );

      messages.push(
        `Renamed tab "${operation.tab_id}" to "${operation.new_title}".`
      );
    }


    else if (
      operation.type ===
      "remove_tab"
    ) {
      updated =
        libraryRemoveTab(
          updated,
          operation
        );

      messages.push(
        `Removed tab "${operation.tab_id}".`
      );
    }


    else if (
      operation.type ===
      "add_section"
    ) {
      updated =
        libraryAddSection(
          updated,
          operation
        );

      messages.push(
        `Added section "${operation.name}".`
      );
    }


    else if (
      operation.type ===
      "rename_section"
    ) {
      updated =
        renameLibraryHeading(
          updated,
          operation.tab_id,
          "h2",
          operation.old_name,
          operation.new_name
        );

      messages.push(
        `Renamed section "${operation.old_name}" to "${operation.new_name}".`
      );
    }


    else if (
      operation.type ===
      "remove_section"
    ) {
      updated =
        removeLibraryHeadingBlock(
          updated,
          operation.tab_id,
          "h2",
          operation.name
        );

      messages.push(
        `Removed section "${operation.name}".`
      );
    }


    else if (
      operation.type ===
      "add_subsection"
    ) {
      updated =
        libraryAddSubsection(
          updated,
          operation
        );

      messages.push(
        `Added subsection "${operation.name}".`
      );
    }


    else if (
      operation.type ===
      "rename_subsection"
    ) {
      updated =
        renameLibraryHeading(
          updated,
          operation.tab_id,
          "h3",
          operation.old_name,
          operation.new_name
        );

      messages.push(
        `Renamed subsection "${operation.old_name}" to "${operation.new_name}".`
      );
    }


    else if (
      operation.type ===
      "remove_subsection"
    ) {
      updated =
        removeLibraryHeadingBlock(
          updated,
          operation.tab_id,
          "h3",
          operation.name
        );

      messages.push(
        `Removed subsection "${operation.name}".`
      );
    }


    else {
      throw new Error(
        `Unsupported Library operation "${operation.type}".`
      );
    }
  }

  return {
    html:
      updated,

    messages,
  };
}


// ======================================================
// SECTION 34: RUN LIBRARY WORKFLOW
// ======================================================

async function handleLibraryHub({
  octokit,
  owner,
  repo,
  baseBranch,
  staffRequest,
  rl,
}) {
  const originalHtml =
    await readGitHubFile(
      octokit,
      owner,
      repo,
      "Index.html",
      baseBranch
    );

  const structure =
    extractLibraryStructure(
      originalHtml
    );

  console.log(
    `Loaded ${structure.tabs.length} Library Hub tabs.`
  );

  console.log(
    `Loaded ${structure.links.length} Library Hub links.`
  );

  console.log(
    `Loaded ${structure.sections.length} sections.`
  );

  console.log(
    `Loaded ${structure.subsections.length} subsections.`
  );

  const plan =
    await createLibraryPlan(
      staffRequest,
      structure
    );

  console.log(
    "\nCHANGE PLAN"
  );

  console.log(
    "===========\n"
  );

  console.log(
    plan.summary
  );

  console.log(
    `\nReason:\n${plan.reason}`
  );

  if (!plan.safe) {
    console.log(
      "\nNo changes were made."
    );

    return;
  }

  if (
    !Array.isArray(
      plan.operations
    ) ||
    !plan.operations.length
  ) {
    throw new Error(
      "No valid operations were generated."
    );
  }

  console.log(
    "\nOPERATIONS"
  );

  console.log(
    "=========="
  );

  plan.operations.forEach(
    (operation, index) => {
      console.log(
        `\n${index + 1}. ${operation.type}`
      );

      console.log(
        JSON.stringify(
          operation,
          null,
          2
        )
      );
    }
  );

  const result =
    applyLibraryOperations(
      originalHtml,
      plan.operations,
      staffRequest
    );

  if (
    result.html ===
    originalHtml
  ) {
    throw new Error(
      "No actual Library Hub change was produced."
    );
  }

  console.log(
    "\nVALIDATED CHANGES"
  );

  console.log(
    "================="
  );

  result.messages.forEach(
    (message) =>
      console.log(
        `✓ ${message}`
      )
  );

  const approval =
    await rl.question(
      "\nApply this change to the ARC Library Hub? (yes/no)\n> "
    );

  if (
    normalize(
      approval
    ) !==
    "yes"
  ) {
    console.log(
      "\nCanceled."
    );

    return;
  }

  const prNumber =
    await publishFiles({
      octokit,
      owner,
      repo,
      baseBranch,

      files: [
        {
          path:
            "Index.html",

          content:
            result.html,
        },
      ],

      summary:
        plan.summary,

      staffRequest,
    });

  console.log(
    "\nSUCCESS"
  );

  console.log(
    "======="
  );

  console.log(
    "\nARC Library Hub updated successfully."
  );

  console.log(
    `Merged PR #${prNumber}`
  );
}


// ======================================================
// SECTION 35: MAIN CODEASE PROGRAM
// ======================================================

async function main() {
  const rl =
    readline.createInterface({
      input,
      output,
    });

  try {

    console.log(
      "\nCODEASE"
    );

    console.log(
      "=======\n"
    );

    console.log(
      "Which Hub would you like to update?\n"
    );

    console.log(
      "1. LRC Hub"
    );

    console.log(
      "2. ARC Library Hub"
    );

    const choice =
      await rl.question(
        "\nChoose 1 or 2:\n> "
      );

    let hub;

    if (
      choice.trim() ===
      "1"
    ) {
      hub =
        HUBS.lrc;
    }

    else if (
      choice.trim() ===
      "2"
    ) {
      hub =
        HUBS.library;
    }

    else {
      console.log(
        "\nInvalid Hub selection."
      );

      return;
    }

    console.log(
      `\nSelected: ${hub.name}`
    );

    const staffRequest =
      await rl.question(
        "\nWhat would you like to change?\n> "
      );

    if (
      !staffRequest.trim()
    ) {
      console.log(
        "\nNo request entered."
      );

      return;
    }

    const octokit =
      await githubApp.getInstallationOctokit(
        Number(
          process.env
            .GITHUB_INSTALLATION_ID
        )
      );

    const owner =
      process.env
        .GITHUB_OWNER;

    const repo =
      hub.repo;

    console.log(
      `\nRepository: ${owner}/${repo}`
    );

    const repoInfo =
      await octokit.request(
        "GET /repos/{owner}/{repo}",
        {
          owner,
          repo,
        }
      );

    const baseBranch =
      repoInfo.data
        .default_branch;


    // --------------------------------------------------
    // LRC
    // --------------------------------------------------

    if (
      hub.id ===
      "lrc"
    ) {
      await handleLrcHub({
        octokit,
        owner,
        repo,
        baseBranch,
        staffRequest,
        rl,
      });
    }


    // --------------------------------------------------
    // LIBRARY
    // --------------------------------------------------

    else {
      await handleLibraryHub({
        octokit,
        owner,
        repo,
        baseBranch,
        staffRequest,
        rl,
      });
    }

  } catch (error) {

    console.error(
      "\nCodEase failed."
    );

    console.error(
      error.message
    );

  } finally {

    rl.close();
  }
}

// ======================================================
// SECTION 35B: BUILD PLAN FOR WEB API
// ======================================================

async function buildPlanForHub({
  hubId,
  staffRequest,
}) {
  const octokit =
    await githubApp.getInstallationOctokit(
      Number(
        process.env.GITHUB_INSTALLATION_ID
      )
    );

  const owner =
    process.env.GITHUB_OWNER;

  let selectedHub;

  if (hubId === "lrc") {
    selectedHub = HUBS.lrc;
  }

  else if (hubId === "library") {
    selectedHub = HUBS.library;
  }

  else {
    throw new Error(
      "Invalid Hub selection."
    );
  }

  const repo =
    selectedHub.repo;

  const repoInfo =
    await octokit.request(
      "GET /repos/{owner}/{repo}",
      {
        owner,
        repo,
      }
    );

  const baseBranch =
    repoInfo.data.default_branch;


  // --------------------------------------------------
  // LRC HUB
  // --------------------------------------------------

  if (
    hubId === "lrc"
  ) {
    const bookmarkCode =
      await readGitHubFile(
        octokit,
        owner,
        repo,
        "bookmarks-data.js",
        baseBranch
      );

    const scriptCode =
      await readGitHubFile(
        octokit,
        owner,
        repo,
        "script.js",
        baseBranch
      );

    const bookmarks =
      parseBookmarks(
        bookmarkCode
      );

    const {
      categoryOrder,
      categoryGroups,
    } =
      readLrcStructure(
        scriptCode
      );

    const plan =
      await createLrcPlan(
        staffRequest,
        bookmarks,
        categoryOrder,
        categoryGroups
      );

    return {
      hub:
        selectedHub.name,

      repo,

      baseBranch,

      plan,
    };
  }


  // --------------------------------------------------
  // ARC LIBRARY HUB
  // --------------------------------------------------

  const html =
    await readGitHubFile(
      octokit,
      owner,
      repo,
      "Index.html",
      baseBranch
    );

  const structure =
    extractLibraryStructure(
      html
    );

  const plan =
    await createLibraryPlan(
      staffRequest,
      structure
    );

  return {
    hub:
      selectedHub.name,

    repo,

    baseBranch,

    plan,
  };
}

// ======================================================
// SECTION 35C: APPLY APPROVED PLAN FOR WEB API
// ======================================================

async function applyPlanForHub({
  hubId,
  staffRequest,
  plan,
}) {
  if (
    !plan ||
    !plan.safe ||
    !Array.isArray(plan.operations) ||
    !plan.operations.length
  ) {
    throw new Error(
      "A valid approved plan is required."
    );
  }

  const octokit =
    await githubApp.getInstallationOctokit(
      Number(
        process.env.GITHUB_INSTALLATION_ID
      )
    );

  const owner =
    process.env.GITHUB_OWNER;

  let selectedHub;

  if (hubId === "lrc") {
    selectedHub = HUBS.lrc;
  }

  else if (hubId === "library") {
    selectedHub = HUBS.library;
  }

  else {
    throw new Error(
      "Invalid Hub selection."
    );
  }

  const repo =
    selectedHub.repo;

  const repoInfo =
    await octokit.request(
      "GET /repos/{owner}/{repo}",
      {
        owner,
        repo,
      }
    );

  const baseBranch =
    repoInfo.data.default_branch;


  // --------------------------------------------------
  // LRC HUB
  // --------------------------------------------------

  if (
    hubId === "lrc"
  ) {
    const bookmarkCode =
      await readGitHubFile(
        octokit,
        owner,
        repo,
        "bookmarks-data.js",
        baseBranch
      );

    const scriptCode =
      await readGitHubFile(
        octokit,
        owner,
        repo,
        "script.js",
        baseBranch
      );

    const bookmarks =
      parseBookmarks(
        bookmarkCode
      );

    const {
      categoryOrder,
      categoryGroups,
    } =
      readLrcStructure(
        scriptCode
      );

    const result =
      applyLrcOperations({
        bookmarks,
        categoryOrder,
        categoryGroups,
        operations:
          plan.operations,
        staffRequest,
      });

    const newBookmarksCode =
      writeBookmarks(
        bookmarkCode,
        result.bookmarks
      );

    const newScriptCode =
      writeLrcStructure(
        scriptCode,
        result.categoryOrder,
        result.categoryGroups
      );

    const changedFiles = [];

    if (
      newBookmarksCode !==
      bookmarkCode
    ) {
      changedFiles.push({
        path:
          "bookmarks-data.js",
        content:
          newBookmarksCode,
      });
    }

    if (
      newScriptCode !==
      scriptCode
    ) {
      changedFiles.push({
        path:
          "script.js",
        content:
          newScriptCode,
      });
    }

    if (!changedFiles.length) {
      throw new Error(
        "No actual LRC changes were produced."
      );
    }

    const prNumber =
      await publishFiles({
        octokit,
        owner,
        repo,
        baseBranch,
        files:
          changedFiles,
        summary:
          plan.summary,
        staffRequest,
      });

    return {
      success: true,
      hub:
        selectedHub.name,
      repo,
      prNumber,
      messages:
        result.messages,
    };
  }


  // --------------------------------------------------
  // ARC LIBRARY HUB
  // --------------------------------------------------

  const originalHtml =
    await readGitHubFile(
      octokit,
      owner,
      repo,
      "Index.html",
      baseBranch
    );

  const result =
    applyLibraryOperations(
      originalHtml,
      plan.operations,
      staffRequest
    );

  if (
    result.html ===
    originalHtml
  ) {
    throw new Error(
      "No actual Library Hub change was produced."
    );
  }

  const prNumber =
    await publishFiles({
      octokit,
      owner,
      repo,
      baseBranch,

      files: [
        {
          path:
            "Index.html",
          content:
            result.html,
        },
      ],

      summary:
        plan.summary,

      staffRequest,
    });

  return {
    success: true,
    hub:
      selectedHub.name,
    repo,
    prNumber,
    messages:
      result.messages,
  };
}

// ======================================================
// SECTION 36: START
// ======================================================



export {
  HUBS,
  createLrcPlan,
  createLibraryPlan,
  buildPlanForHub,
  applyPlanForHub,
};