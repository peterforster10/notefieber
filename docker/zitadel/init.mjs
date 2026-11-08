// Einrichtung von Zitadel für die lokale Entwicklung (Dienst zitadel-init in compose.yaml),
// siehe docs/LOCAL_SETUP.md, Abschnitt 6. Läuft bei jedem Start des Dienstes; jeder Schritt
// prüft, ob er schon erledigt ist, ein zweiter Lauf ändert also nichts. Danach bleibt der
// Container wartend stehen und meldet „healthy“ (wie garage-init).
//
//   1. Projekt „NoteFieber“ in der Organisation NoteFieber (Betreiber)
//   2. OIDC-Client „notefieber-login“ (die API meldet damit Personen an: Code-Flow mit
//      Geheimnis und PKCE, Rücksprung über das Frontend auf /api/v1/auth/callback) und
//      API-Client „notefieber-api“ (Token-Introspection, derzeit ungenutzt)
//   3. Organisationen Alpenwerk und Nordlicht mit festen IDs (= tenants.idp_org_id in seed.sql),
//      jede bekommt das Projekt freigegeben
//   4. die Testpersonen mit festen IDs (= users.idp_subject in seed.sql), bestätigter E-Mail
//      und Testpasswort
//   5. Werte für die Apps nach /out/zitadel.env (auf dem Rechner .local/zitadel.env)
//
// Gruppen stehen nicht in Zitadel: Sie gehören dem Wiki (Tabelle groups, Quelle local) und
// kommen aus seed.sql. Zitadel liefert nur Person und Mandant (siehe LOCAL_SETUP.md).
//
// Die Testdaten hier und in database/scripts/seed/seed.sql gehören zusammen: IDs und
// E-Mails bei Änderungen in beiden Dateien nachziehen. Ausnahme: Nina Neu gibt es nur hier,
// damit sich die erste Anmeldung über eine Einladung ausprobieren lässt.
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
const ORGS = [
  { id: "org-alpenwerk", name: "Alpenwerk GmbH" },
  { id: "org-nordlicht", name: "Nordlicht GmbH" },
];
const USERS = [
  { id: "user-peter-forster", org: "org-alpenwerk", email: "peter.forster@alpenwerk.example", given: "Peter", family: "Forster" },
  { id: "user-lukas-gruber", org: "org-alpenwerk", email: "lukas.gruber@alpenwerk.example", given: "Lukas", family: "Gruber" },
  { id: "user-sophie-bauer", org: "org-alpenwerk", email: "sophie.bauer@alpenwerk.example", given: "Sophie", family: "Bauer" },
  { id: "user-markus-wagner", org: "org-alpenwerk", email: "markus.wagner@alpenwerk.example", given: "Markus", family: "Wagner" },
  { id: "user-max-mustermann", org: "org-alpenwerk", email: "max.mustermann@alpenwerk.example", given: "Max", family: "Mustermann" },
  { id: "user-elena-novak", org: "org-alpenwerk", email: "elena.novak@agentur-nord.example", given: "Elena", family: "Novak" },
  { id: "user-eva-fischer", org: "org-nordlicht", email: "eva.fischer@nordlicht.example", given: "Eva", family: "Fischer" },
  // Nur in Zitadel, bewusst nicht in seed.sql: zum Ausprobieren von Einladungen (die erste
  // Anmeldung braucht eine Einladung, docs/LOCAL_SETUP.md, Abschnitt 7)
  { id: "user-nina-neu", org: "org-alpenwerk", email: "nina.neu@alpenwerk.example", given: "Nina", family: "Neu" },
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

// --- 1. Projekt ---------------------------------------------------------------------------
if (await exists("zitadel.project.v2.ProjectService/GetProject", { projectId: PROJECT_ID })) {
  log(`Projekt ${PROJECT_ID} schon vorhanden`);
} else {
  await must("zitadel.project.v2.ProjectService/CreateProject", {
    organizationId: OPERATOR_ORG,
    projectId: PROJECT_ID,
    name: "NoteFieber",
    projectRoleAssertion: true,    // Projektrollen (derzeit keine) immer ins Token, ohne eigenen Scope
    authorizationRequired: false,  // anmelden ohne Rolle im Projekt
    projectAccessRequired: true,   // aber nur aus Organisationen, denen das Projekt freigegeben ist
  });
  log(`Projekt ${PROJECT_ID} angelegt`);
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

// Login über die API (docs/CONCEPTS.md, Abschnitt 5): Die Tokens bleiben auf dem Server,
// der Browser bekommt nur ein Sitzungs-Cookie. Frontend und API liegen unter derselben
// Adresse (/ und /api), deshalb führt der Rücksprung über WEB_URL. Früher gab es hier
// den öffentlichen Client „notefieber-web“ (PKCE im Browser); er wird nicht mehr angelegt.
const LOGIN_REDIRECT = `${WEB_URL}/api/v1/auth/callback`;
const login = await app("notefieber-login", "NoteFieber Login (API)", {
  oidcConfiguration: {
    applicationType: "OIDC_APP_TYPE_WEB",
    authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC", // vertraulich: Geheimnis, dazu PKCE
    responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
    grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"], // eigene Sitzungen, keine Refresh-Tokens
    redirectUris: [LOGIN_REDIRECT],
    postLogoutRedirectUris: [`${WEB_URL}/`],
    developmentMode: true,          // erlaubt http://localhost
    idTokenUserinfoAssertion: true, // Name und E-Mail direkt im ID-Token
  },
});
let loginSecret = login.clientSecret ?? prev("OIDC_CLIENT_SECRET");
if (!loginSecret) {
  // Das Geheimnis gibt Zitadel nur beim Anlegen heraus. Fehlt die Datei, ein neues erzeugen.
  const r = await must("zitadel.application.v2.ApplicationService/GenerateClientSecret", {
    projectId: PROJECT_ID, applicationId: "notefieber-login",
  });
  loginSecret = r.clientSecret;
  log("Client notefieber-login: neues Geheimnis erzeugt");
}

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
    projectId: PROJECT_ID, grantedOrganizationId: org.id, roleKeys: [],
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
}

// --- 5. Werte für die Apps ---------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(
  OUT_FILE,
  [
    "# Von zitadel-init erzeugt (docker/zitadel/init.mjs), siehe docs/LOCAL_SETUP.md.",
    "# Nur für die lokale Entwicklung. Wird bei jedem Start neu geschrieben.",
    "# Login der API (apps/api liest diese Datei beim Start, siehe .env.example)",
    `OIDC_ISSUER=${ISSUER}`,
    `OIDC_CLIENT_ID=${login.clientId}`,
    `OIDC_CLIENT_SECRET=${loginSecret}`,
    `OIDC_REDIRECT_URI=${LOGIN_REDIRECT}`,
    "# Weitere Werte",
    `ZITADEL_PROJECT_ID=${PROJECT_ID}`,
    `ZITADEL_API_CLIENT_ID=${api.clientId}`,
    `ZITADEL_API_CLIENT_SECRET=${apiSecret}`,
    "",
  ].join("\n"),
);
fs.writeFileSync(`${OUT_DIR}/zitadel-admin.pat`, token + "\n");
log(`bereit: ${ISSUER}, Client notefieber-login ${login.clientId}, Werte in .local/zitadel.env`);

// Für den Healthcheck markieren und warten, bis Compose den Container stoppt
fs.writeFileSync("/tmp/zitadel-ready", "");
setInterval(() => {}, 1 << 30);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));
