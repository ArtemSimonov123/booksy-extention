console.log("[BOOKSY] Background started");

// ============================================================
// CONFIG
// ============================================================

const BACKEND_URL = "http://127.0.0.1:3000";
const DATE_REQUEST_INTERVAL = 1500;
const CREATE_REQUEST_INTERVAL = 1500;

let lastSentRequestedDate = null;
let lastSentRequestedAt = 0;
const DATE_REQUEST_DEDUP_MS = 500;

let lastCreateAppointmentRequestId = null;

// ============================================================
// MESSAGE DISPATCHER / LISTENERS
// ============================================================

chrome.runtime.onMessage.addListener(function (
    message,
    sender,
    sendResponse
) {
    if (!message) {
        return;
    }

    // ========================================================
    // BOOKSY API PROXY
    // content.js -> background.js -> Booksy API
    // ========================================================
    if (message.type === "BOOKSY_API_REQUEST") {
        console.log(
            "[BOOKSY PROXY] Request received:",
            message.method || "GET",
            message.url,
            "uid:",
            message.uid
        );

        (async function () {
            try {
                if (!message.uid) {
                    throw new Error("BOOKSY_API_REQUEST: missing uid");
                }

                if (!message.url) {
                    throw new Error("BOOKSY_API_REQUEST: missing url");
                }

                const method = message.method || "GET";
                const headers = {
                    ...(message.headers || {})
                };

                // Browser-controlled headers must not be forwarded.
                delete headers.host;
                delete headers.origin;
                delete headers.referer;
                delete headers["content-length"];

                const fetchOptions = {
                    method: method,
                    headers: headers
                };

                if (
                    message.body !== null &&
                    message.body !== undefined &&
                    method !== "GET" &&
                    method !== "HEAD"
                ) {
                    fetchOptions.body =
                        typeof message.body === "string"
                            ? message.body
                            : JSON.stringify(message.body);
                }

                console.log(
                    "[BOOKSY PROXY] Headers received:",
                    Object.keys(headers || {})
                );

                console.log(
                    "[BOOKSY PROXY] Fetching:",
                    method,
                    message.url
                );

                const response = await fetch(message.url, fetchOptions);
                const responseText = await response.text();

                console.log(
                    "[BOOKSY PROXY] Response body:",
                    responseText
                );

                let data = null;
                try {
                    data = responseText ? JSON.parse(responseText) : null;
                } catch (e) {
                    data = null;
                }

                console.log(
                    "[BOOKSY PROXY] Response:",
                    response.status,
                    message.url
                );

                sendResponse({
                    ok: response.ok,
                    status: response.status,
                    data: data,
                    text: responseText
                });
            } catch (error) {
                console.error("[BOOKSY PROXY] FAILED:", error);

                sendResponse({
                    ok: false,
                    status: 0,
                    data: null,
                    text: "",
                    error:
                        error && error.message
                            ? error.message
                            : String(error)
                });
            }
        })();

        return true;
    }

    // ========================================================
    // SEND CALENDAR TO BACKEND
    // ========================================================
    if (message.type === "BOOKSY_CALENDAR") {
        console.log("[BOOKSY] Sending calendar to backend...");

        fetch(BACKEND_URL + "/api/booksy/calendar", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                source: "booksy-extension",
                received_at: new Date().toISOString(),
                calendar: message.calendar,
                url: message.url || "",
                date: message.date || null
            })
        })
            .then(async function (response) {
                const text = await response.text();
                console.log("[BOOKSY] Backend status:", response.status);
                console.log("[BOOKSY] Backend response:", text);

                if (!response.ok) {
                    throw new Error(`Backend returned ${response.status}`);
                }

                sendResponse({
                    ok: true,
                    response: text
                });
            })
            .catch(function (error) {
                console.error("[BOOKSY] Backend connection error:", error);
                sendResponse({
                    ok: false,
                    error: error.message
                });
            });

        return true;
    }
});

// ============================================================
// ENSURE CONTENT SCRIPT
// ============================================================

async function ensureContentScript(tabId) {
    if (!tabId) {
        throw new Error("Invalid Booksy tab id.");
    }

    try {
        const ping = await chrome.tabs.sendMessage(tabId, {
            type: "BOOKSY_EXTENSION_PING"
        });

        if (ping && ping.ok) {
            console.log("[BOOKSY] content.js already active:", tabId);
            return true;
        }
    } catch (error) {
        console.log("[BOOKSY] content.js not active, injecting:", tabId);
    }

    await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"]
    });

    await new Promise(resolve => setTimeout(resolve, 250));
    return true;
}

// ============================================================
// SEND MESSAGE TO BOOKSY TAB
// ============================================================

async function sendMessageToBooksyTab(tabId, message) {
    try {
        await ensureContentScript(tabId);
    } catch (error) {
        console.error("[BOOKSY] Cannot inject content.js:", tabId, error);
        return false;
    }

    try {
        await chrome.tabs.sendMessage(tabId, message);
        return true;
    } catch (error) {
        console.warn(
            "[BOOKSY] First message delivery failed, retrying:",
            tabId,
            error
        );

        await new Promise(resolve => setTimeout(resolve, 300));

        try {
            await chrome.tabs.sendMessage(tabId, message);
            return true;
        } catch (retryError) {
            console.error(
                "[BOOKSY] Message delivery failed:",
                tabId,
                retryError
            );
            return false;
        }
    }
}

// ============================================================
// ADMIN -> BOOKSY DATE REQUEST
// ============================================================

async function checkRequestedBooksyDate() {
    try {
        const url = BACKEND_URL + "/api/booksy/request-date";
        const response = await fetch(url, {
            method: "GET",
            cache: "no-store"
        });

        if (!response.ok) {
            return;
        }

        const data = await response.json();

        if (!data || !data.requested || !data.date) {
            lastSentRequestedDate = null;
            return;
        }

        const now = Date.now();
        if (
            lastSentRequestedDate === data.date &&
            now - lastSentRequestedAt < DATE_REQUEST_DEDUP_MS
        ) {
            return;
        }

        console.log("[BOOKSY] Date request from Admin:", data.date);

        const tabs = await chrome.tabs.query({
            url: ["https://booksy.com/*", "https://*.booksy.com/*"]
        });

        if (!tabs.length) {
            console.warn("[BOOKSY] No Booksy tabs available for date request.");
            return;
        }

        const sortedTabs = [...tabs].sort((a, b) => {
            if (a.active && !b.active) return -1;
            if (!a.active && b.active) return 1;
            return 0;
        });

        let sent = false;

        for (const tab of sortedTabs) {
            if (!tab.id) continue;

            const delivered = await sendMessageToBooksyTab(tab.id, {
                type: "BOOKSY_FETCH_DATE",
                date: data.date
            });

            if (delivered) {
                console.log("[BOOKSY] Date request sent to tab:", tab.id);
                sent = true;
                break;
            }
        }

        if (sent) {
            lastSentRequestedDate = data.date;
            lastSentRequestedAt = Date.now();
        } else {
            console.error("[BOOKSY] Could not send date request to any Booksy tab.");
        }
    } catch (error) {
        console.error("[BOOKSY] Date polling error:", error);
    }
}

// ============================================================
// ADMIN -> BOOKSY CREATE APPOINTMENT
// ============================================================

async function checkCreateAppointmentRequest() {
    try {
        const response = await fetch(
            BACKEND_URL + "/api/booksy/create-appointment",
            {
                method: "GET",
                cache: "no-store"
            }
        );

        if (!response.ok) {
            return;
        }

        const data = await response.json();

        if (!data || !data.requested || !data.request) {
            lastCreateAppointmentRequestId = null;
            return;
        }

        const request = data.request;

        if (lastCreateAppointmentRequestId === request.id) {
            return;
        }

        console.log("[BOOKSY] Create appointment request:", request);

        const tabs = await chrome.tabs.query({
            url: ["https://booksy.com/*", "https://*.booksy.com/*"]
        });

        if (!tabs.length) {
            console.warn("[BOOKSY] No Booksy tabs available for create.");
            return;
        }

        const sortedTabs = [...tabs].sort((a, b) => {
            if (a.active && !b.active) return -1;
            if (!a.active && b.active) return 1;
            return 0;
        });

        let sent = false;

        for (const tab of sortedTabs) {
            if (!tab.id) continue;

            const delivered = await sendMessageToBooksyTab(tab.id, {
                type: "BOOKSY_CREATE_APPOINTMENT",
                request: request
            });

            if (delivered) {
                console.log(
                    "[BOOKSY] Create appointment command sent:",
                    tab.id
                );
                sent = true;
                break;
            }
        }

        if (sent) {
            lastCreateAppointmentRequestId = request.id;
        } else {
            console.warn("[BOOKSY] No Booksy tab accepted create command.");
        }
    } catch (error) {
        console.error("[BOOKSY] Create appointment polling error:", error);
    }
}

// ============================================================
// POLLING TIMERS & INIT
// ============================================================

setInterval(checkRequestedBooksyDate, DATE_REQUEST_INTERVAL);
setInterval(checkCreateAppointmentRequest, CREATE_REQUEST_INTERVAL);

checkRequestedBooksyDate();
checkCreateAppointmentRequest();