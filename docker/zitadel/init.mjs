// Einrichtung von Zitadel für die lokale Entwicklung (Dienst zitadel-init in compose.yaml),
// siehe docs/LOCAL_SETUP.md, Abschnitt 6. Läuft bei jedem Start des Dienstes; jeder Schritt
// prüft, ob er schon erledigt ist, ein zweiter Lauf ändert also nichts. Danach bleibt der
// Container wartend stehen und meldet „healthy“ (wie garage-init).
//
//   1. Projekt „NoteFieber“ in der Organisation NoteFieber (Betreiber), mit den Gruppen der
//      Testdaten als Projektrollen
//   2. OIDC-Client „web“ (Frontend, PKCE ohne Geheimnis) und API-Client „api“ (prüft Tokens)
//   3. Organisationen Alpenwerk und Nordlicht mit festen IDs (= tenants.idp_org_id in seed.sql),
//      jede bekommt das Projekt freigegeben
//   4. die Testpersonen mit festen IDs (= users.idp_subject in seed.sql), bestätigter E-Mail,
//      Testpasswort und ihren Gruppen (Projektrollen)
//   5. Werte für die Apps nach /out/zitadel.env (auf dem Rechner .local/zitadel.env)
//
// Gruppen: Zitadel v4 hat (noch) keine Gruppen. Die Gruppen sind deshalb Rollen im Projekt
// NoteFieber; der Rollenschlüssel ist groups.idp_group_id. Im Token stehen sie unter
// "urn:zitadel:iam:org:project:roles" (siehe LOCAL_SETUP.md).
//
// Die Testdaten hier und in database/scripts/seed/seed.sql gehören zusammen: IDs, E-Mails
// und Gruppen bei Änderungen in beiden Dateien nachziehen.
//
// Spricht die Connect-Schnittstelle (v2) von Zitadel mit dem Token des Dienstkontos nf-setup,
// das Zitadel beim ersten Start ins Volume schreibt. Nur Node.js, keine Pakete.
import http from "node:http";
import fs from "node:fs";

const API = new URL(process.env.ZITADEL_API_URL ?? "http://zitadel:8080");
const HOST = process.env.ZITADEL_EXTERNAL_HOST ?? "localhost:8080"; // Zitadel erkennt die Instanz am Host
const ISSUER = `http://${HOST}`;
const PAT_FILE = "/zitadel/bootstrap/admin.pat";
const OUT_DIR = "/out";
const PASSWORD = process.env.NF_TEST_PASSWORD ?? "NoteFieber-lokal-1";
const WEB_URL = process.env.NF_WEB_URL ?? "http://localhost:3000";

const PROJECT_ID = "notefieber";
const ROLES = [
  { key: "entwicklung", name: "Entwicklung" },
  { key: "vertrieb", name: "Vertrieb" },
  { key: "geschaeftsleitung", name: "Geschäftsleitung" },
];
const ORGS = [
  { id: "org-alpenwerk", name: "Alpenwerk GmbH", roles: ["entwicklung", "vertrieb", "geschaeftsleitung"] },
  { id: "org-nordlicht", name: "Nordlicht GmbH", roles: [] },
];
const USERS = [
  { id: "user-anna-huber", org: "org-alpenwerk", email: "anna.huber@alpenwerk.example", given: "Anna", family: "Huber", roles: ["geschaeftsleitung"] },
  { id: "user-lukas-gruber", org: "org-alpenwerk", email: "lukas.gruber@alpenwerk.example", given: "Lukas", family: "Gruber", roles: ["entwicklung"] },
  { id: "user-sophie-bauer", org: "org-alpenwerk", email: "sophie.bauer@alpenwerk.example", given: "Sophie", family: "Bauer", roles: ["entwicklung"] },
  { id: "user-markus-wagner", org: "org-alpenwerk", email: "markus.wagner@alpenwerk.example", given: "Markus", family: "Wagner", roles: ["entwicklung"] },
  { id: "user-max-mustermann", org: "org-alpenwerk", email: "max.mustermann@alpenwerk.example", given: "Max", family: "Mustermann", roles: ["vertrieb"] },
  { id: "user-elena-novak", org: "org-alpenwerk", email: "elena.novak@agentur-nord.example", given: "Elena", family: "Novak", roles: [] },
  { id: "user-eva-fischer", org: "org-nordlicht", email: "eva.fischer@nordlicht.example", given: "Eva", family: "Fischer", roles: [] },
];

const log = (msg) => console.log(`Zitadel: ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let token = "";

// Ein Aufruf der Connect-Schnittstelle: POST /<Dienst>/<Methode> mit JSON.
// Gibt { status, body } zurück; wirft nur bei Netzwerkfehlern.
function call(method, body = {}) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: API.hostname,
        port: API.port || 80,
        path: `/${method}`,
        method: "POST",
        headers: {
          Host: HOST,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          let json = {};
          try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text }; }
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}

// Aufruf, der gelingen muss
async function must(method, body) {
  const r = await call(method, body);
  if (r.status !== 200) throw new Error(`${method}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// Anlegen, „gibt es schon“ ist in Ordnung (Code already_exists, HTTP 409). Die Meldungen
// selbst sind übersetzt (Instanz auf Deutsch), deshalb nur den Code prüfen.
async function create(method, body) {
  const r = await call(method, body);
  if (r.status === 200) return "angelegt";
  if (r.status === 409 || r.body.code === "already_exists") return "schon vorhanden";
  throw new Error(`${method}: ${r.status} ${JSON.stringify(r.body)}`);
}

// Gibt es das Objekt? (Get… liefert 404 bzw. not_found, wenn nicht)
async function exists(method, body) {
  const r = await call(method, body);
  if (r.status === 200) return r.body;
  if (r.status === 404 || r.body.code === "not_found" || r.body.code === 5) return null;
  throw new Error(`${method}: ${r.status} ${JSON.stringify(r.body)}`);
}

// --- Warten, bis Zitadel bereit ist und das Token des Dienstkontos da ist ------------------
log("warte auf Zitadel");
for (let i = 0; ; i++) {
  try {
    token = fs.readFileSync(PAT_FILE, "utf8").trim();
    const r = await call("zitadel.instance.v2.InstanceService/GetInstance");
    if (r.status === 200) break;
  } catch { /* noch nicht da */ }
  if (i >= 60) throw new Error(`Zitadel antwortet nicht oder ${PAT_FILE} fehlt`);
  await sleep(1000);
}
const instance = await must("zitadel.instance.v2.InstanceService/GetInstance");
const operatorOrg = await must("zitadel.org.v2.OrganizationService/ListOrganizations", {
  queries: [{ nameQuery: { name: "NoteFieber", method: "TEXT_QUERY_METHOD_EQUALS" } }],
});
const OPERATOR_ORG = operatorOrg.result?.[0]?.id;
if (!OPERATOR_ORG) throw new Error("Organisation NoteFieber (erste Instanz) nicht gefunden");
log(`Instanz ${instance.instance?.name ?? "?"}, Betreiber-Organisation ${OPERATOR_ORG}`);

// --- 1. Projekt und Rollen ---------------------------------------------------------------
if (await exists("zitadel.project.v2.ProjectService/GetProject", { projectId: PROJECT_ID })) {
  log(`Projekt ${PROJECT_ID} schon vorhanden`);
} else {
  await must("zitadel.project.v2.ProjectService/CreateProject", {
    organizationId: OPERATOR_ORG,
    projectId: PROJECT_ID,
    name: "NoteFieber",
    projectRoleAssertion: true,    // Rollen (= Gruppen) immer ins Token, ohne eigenen Scope
    authorizationRequired: false,  // auch Personen ohne Gruppe dürfen sich anmelden
    projectAccessRequired: true,   // aber nur aus Organisationen, denen das Projekt freigegeben ist
  });
  log(`Projekt ${PROJECT_ID} angelegt`);
}
for (const role of ROLES) {
  const s = await create("zitadel.project.v2.ProjectService/AddProjectRole", {
    projectId: PROJECT_ID, roleKey: role.key, displayName: role.name, group: "Gruppen",
  });
  log(`Rolle ${role.key}: ${s}`);
}

// --- 2. Clients --------------------------------------------------------------------------
const OUT_FILE = `${OUT_DIR}/zitadel.env`;
const previous = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, "utf8") : "";
const prev = (k) => previous.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "";

async function app(applicationId, name, config) {
  const found = await exists("zitadel.application.v2.ApplicationService/GetApplication", { applicationId });
  if (found) {
    log(`Client ${applicationId} schon vorhanden`);
    const a = found.application;
    return { clientId: a.oidcConfiguration?.clientId ?? a.apiConfiguration?.clientId, clientSecret: null };
  }
  const r = await must("zitadel.application.v2.ApplicationService/CreateApplication", {
    projectId: PROJECT_ID, applicationId, name, ...config,
  });
  log(`Client ${applicationId} angelegt`);
  const c = r.oidcConfiguration ?? r.apiConfiguration;
  return { clientId: c.clientId, clientSecret: c.clientSecret || null };
}

const web = await app("notefieber-web", "NoteFieber Web (Frontend)", {
  oidcConfiguration: {
    applicationType: "OIDC_APP_TYPE_WEB",
    authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE", // öffentlicher Client mit PKCE
    responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
    grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
    redirectUris: [`${WEB_URL}/auth/callback`],
    postLogoutRedirectUris: [`${WEB_URL}/`],
    developmentMode: true,          // erlaubt http://localhost
    accessTokenType: "OIDC_TOKEN_TYPE_JWT", // die API prüft das Token selbst über JWKS
    accessTokenRoleAssertion: true,
    idTokenRoleAssertion: true,
    idTokenUserinfoAssertion: true, // Name und E-Mail direkt im ID-Token
  },
});

const api = await app("notefieber-api", "NoteFieber API", {
  apiConfiguration: { authMethodType: "API_AUTH_METHOD_TYPE_BASIC" }, // für Token-Introspection
});
let apiSecret = api.clientSecret ?? prev("ZITADEL_API_CLIENT_SECRET");
if (!apiSecret) {
  // Das Geheimnis gibt Zitadel nur beim Anlegen heraus. Fehlt die Datei, ein neues erzeugen.
  const r = await must("zitadel.application.v2.ApplicationService/GenerateClientSecret", {
    projectId: PROJECT_ID, applicationId: "notefieber-api",
  });
  apiSecret = r.clientSecret;
  log("Client notefieber-api: neues Geheimnis erzeugt");
}

// --- 3. Organisationen der Testdaten -----------------------------------------------------
for (const org of ORGS) {
  const found = await must("zitadel.org.v2.OrganizationService/ListOrganizations", {
    queries: [{ idQuery: { id: org.id } }],
  });
  if (found.result?.length) {
    log(`Organisation ${org.name} (${org.id}) schon vorhanden`);
  } else {
    await must("zitadel.org.v2.OrganizationService/AddOrganization", { name: org.name, orgId: org.id });
    log(`Organisation ${org.name} (${org.id}) angelegt`);
  }
  const s = await create("zitadel.project.v2.ProjectService/CreateProjectGrant", {
    projectId: PROJECT_ID, grantedOrganizationId: org.id, roleKeys: org.roles,
  });
  log(`Projekt für ${org.name} freigegeben: ${s}`);
}

// --- 4. Testpersonen ---------------------------------------------------------------------
for (const u of USERS) {
  if (await exists("zitadel.user.v2.UserService/GetUserByID", { userId: u.id })) {
    log(`Person ${u.email} schon vorhanden`);
  } else {
    await must("zitadel.user.v2.UserService/AddHumanUser", {
      userId: u.id,
      organization: { orgId: u.org },
      username: u.email, // Anmeldename = E-Mail
      profile: { givenName: u.given, familyName: u.family, preferredLanguage: "de" },
      email: { email: u.email, isVerified: true }, // keine Bestätigungsmail
      password: { password: PASSWORD, changeRequired: false },
    });
    log(`Person ${u.email} angelegt`);
  }
  if (u.roles.length) {
    const s = await create("zitadel.authorization.v2.AuthorizationService/CreateAuthorization", {
      userId: u.id, projectId: PROJECT_ID, organizationId: u.org, roleKeys: u.roles,
    });
    log(`  Gruppen ${u.roles.join(", ")}: ${s}`);
  }
}

// --- 5. Werte für die Apps ---------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(
  OUT_FILE,
  [
    "# Von zitadel-init erzeugt (docker/zitadel/init.mjs), siehe docs/LOCAL_SETUP.md.",
    "# Nur für die lokale Entwicklung. Wird bei jedem Start neu geschrieben.",
    `ZITADEL_ISSUER=${ISSUER}`,
    `ZITADEL_PROJECT_ID=${PROJECT_ID}`,
    `ZITADEL_WEB_CLIENT_ID=${web.clientId}`,
    `ZITADEL_WEB_REDIRECT_URI=${WEB_URL}/auth/callback`,
    `ZITADEL_API_CLIENT_ID=${api.clientId}`,
    `ZITADEL_API_CLIENT_SECRET=${apiSecret}`,
    "",
  ].join("\n"),
);
fs.writeFileSync(`${OUT_DIR}/zitadel-admin.pat`, token + "\n");
log(`bereit: ${ISSUER}, Client web ${web.clientId}, Werte in .local/zitadel.env`);

// Für den Healthcheck markieren und warten, bis Compose den Container stoppt
fs.writeFileSync("/tmp/zitadel-ready", "");
setInterval(() => {}, 1 << 30);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));
