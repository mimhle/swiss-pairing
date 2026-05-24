const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export const DRIVE_BACKUP_FILE_NAME = "swiss-pairing-cloud-backup.json";
export const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email";
export const DRIVE_ACCESS_TOKEN_KEY = "swiss_drive_access_token";
export const DRIVE_ACCESS_TOKEN_EXPIRES_AT_KEY = "swiss_drive_access_token_expires_at";

let scriptLoadPromise = null;
let accessToken = "";
let accessTokenExpiresAt = 0;

export function getGoogleClientId() {
    return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
}

export function hasGoogleClientId() {
    return Boolean(getGoogleClientId());
}

function canUseLocalStorage() {
    return typeof window !== "undefined" && window.localStorage;
}

function saveGoogleDriveToken(token, expiresAt) {
    accessToken = token;
    accessTokenExpiresAt = expiresAt;

    if (!canUseLocalStorage()) return;
    localStorage.setItem(DRIVE_ACCESS_TOKEN_KEY, token);
    localStorage.setItem(DRIVE_ACCESS_TOKEN_EXPIRES_AT_KEY, String(expiresAt));
}

function loadGoogleDriveToken() {
    if (accessToken && accessTokenExpiresAt) return;
    if (!canUseLocalStorage()) return;

    const storedToken = localStorage.getItem(DRIVE_ACCESS_TOKEN_KEY) || "";
    const storedExpiresAt = Number(localStorage.getItem(DRIVE_ACCESS_TOKEN_EXPIRES_AT_KEY) || 0);

    if (storedToken && Number.isFinite(storedExpiresAt)) {
        accessToken = storedToken;
        accessTokenExpiresAt = storedExpiresAt;
    }
}

export function hasValidGoogleAccessToken() {
    loadGoogleDriveToken();
    return Boolean(accessToken && Date.now() < accessTokenExpiresAt - 60000);
}

export function clearGoogleDriveToken() {
    accessToken = "";
    accessTokenExpiresAt = 0;

    if (!canUseLocalStorage()) return;
    localStorage.removeItem(DRIVE_ACCESS_TOKEN_KEY);
    localStorage.removeItem(DRIVE_ACCESS_TOKEN_EXPIRES_AT_KEY);
}

function loadGoogleIdentityScript() {
    if (typeof window === "undefined") {
        return Promise.reject(new Error("Google Drive sync is only available in the browser."));
    }

    if (window.google?.accounts?.oauth2) {
        return Promise.resolve();
    }

    if (scriptLoadPromise) return scriptLoadPromise;

    scriptLoadPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
        if (existingScript) {
            existingScript.addEventListener("load", resolve, { once: true });
            existingScript.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services.")), { once: true });
            return;
        }

        const script = document.createElement("script");
        script.src = GOOGLE_IDENTITY_SCRIPT;
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load Google Identity Services."));
        document.head.appendChild(script);
    });

    return scriptLoadPromise;
}

export async function requestGoogleDriveToken({ prompt = "consent" } = {}) {
    if (hasValidGoogleAccessToken()) return accessToken;

    const clientId = getGoogleClientId();
    if (!clientId) {
        throw new Error("Missing NEXT_PUBLIC_GOOGLE_CLIENT_ID.");
    }

    await loadGoogleIdentityScript();

    return new Promise((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: DRIVE_APPDATA_SCOPE,
            callback: (response) => {
                if (response?.error) {
                    reject(new Error(response.error_description || response.error));
                    return;
                }

                saveGoogleDriveToken(response.access_token, Date.now() + (Number(response.expires_in || 3600) * 1000));
                resolve(accessToken);
            },
            error_callback: (error) => reject(new Error(error?.message || "Google sign-in was cancelled.")),
        });

        tokenClient.requestAccessToken({ prompt });
    });
}

async function driveFetch(url, options = {}) {
    if (!hasValidGoogleAccessToken()) {
        throw new Error("Google Drive token expired. Reconnect Google Drive to continue syncing.");
    }

    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(options.headers || {}),
        },
    });

    if (!response.ok) {
        let detail = "";
        try {
            const errorData = await response.json();
            detail = errorData?.error?.message || "";
        } catch (_) {}

        throw new Error(detail || `Google Drive request failed (${response.status}).`);
    }

    return response;
}

export async function findDriveBackupFile() {
    const params = new URLSearchParams({
        spaces: "appDataFolder",
        q: `name='${DRIVE_BACKUP_FILE_NAME.replaceAll("'", "\\'")}' and trashed=false`,
        fields: "files(id,name,modifiedTime,size)",
        orderBy: "modifiedTime desc",
        pageSize: "1",
    });

    const response = await driveFetch(`${DRIVE_FILES_URL}?${params.toString()}`);
    const data = await response.json();
    return data.files?.[0] || null;
}

export async function downloadDriveBackup(fileId) {
    const response = await driveFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`);
    return response.text();
}

export async function fetchGoogleAccountProfile() {
    const response = await driveFetch(GOOGLE_USERINFO_URL);
    const profile = await response.json();

    return {
        name: profile.name || "",
        email: profile.email || "",
        picture: profile.picture || "",
    };
}

function buildMultipartBody(metadata, jsonData) {
    const boundary = `swiss_pairing_${Date.now()}`;
    const body = [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(jsonData),
        `--${boundary}--`,
        "",
    ].join("\r\n");

    return { boundary, body };
}

export async function uploadDriveBackup(backupData, existingFileId = "") {
    const metadata = {
        name: DRIVE_BACKUP_FILE_NAME,
        mimeType: "application/json",
        ...(existingFileId ? {} : { parents: ["appDataFolder"] }),
    };
    const { boundary, body } = buildMultipartBody(metadata, backupData);
    const url = existingFileId
        ? `${DRIVE_UPLOAD_URL}/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id,name,modifiedTime,size`
        : `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,modifiedTime,size`;

    const response = await driveFetch(url, {
        method: existingFileId ? "PATCH" : "POST",
        headers: {
            "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
    });

    return response.json();
}
