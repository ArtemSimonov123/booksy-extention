console.log("[BOOKSY] Background started");

// ============================================================
// CONFIG
// ============================================================

const BACKEND_URL = "http://127.0.0.1:3000";
const BACKEND_POLL_ALARM = "booksy-backend-poll";
// Chrome's minimum repeating alarm interval is 30 seconds. Unlike setInterval,
// an alarm wakes a Manifest V3 service worker after Chrome suspends it.
const BACKEND_POLL_MINUTES = 0.5;

let lastCreateAppointmentRequestId = null;
let lastRefreshRequestId = null;
let lastCalendarTabId = null;

async function rememberCalendarTab(tabId) {
    if (!tabId) {
        return;
    }

    lastCalendarTabId = tabId;
    await chrome.storage.session.set({ booksyCalendarTabId: tabId });
    console.log("[BOOKSY] Calendar source tab remembered:", tabId);
}

async function getRememberedCalendarTabId() {
    if (lastCalendarTabId) {
        return lastCalendarTabId;
    }

    const stored = await chrome.storage.session.get("booksyCalendarTabId");
    lastCalendarTabId = stored.booksyCalendarTabId || null;
    return lastCalendarTabId;
}

function isBooksyTab(tab) {
    return Boolean(tab?.id && tab.url && /^https:\/\/(?:[^/]+\.)?booksy\.com\//.test(tab.url));
}

async function reportRefreshLog(requestId, stage, message) {
    try {
        await fetch(BACKEND_URL + "/api/booksy/refresh/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request_id: requestId, stage, message })
        });
    } catch (error) {
        console.warn("[BOOKSY] Cannot send refresh log:", error);
    }
}

async function reportCreateLog(requestId, stage, message) {
    try {
        await fetch(BACKEND_URL + "/api/booksy/create-appointment/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request_id: requestId, stage, message })
        });
    } catch (error) {
        console.warn("[BOOKSY] Cannot send create log:", error);
    }
}

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

        // The event originates only from the tab that actually loaded the
        // business calendar. Save it before any later client-side activity.
        rememberCalendarTab(sender.tab?.id).catch(function (error) {
            console.warn("[BOOKSY] Cannot remember calendar tab:", error);
        });

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
                date: message.date || null,
                start_date: message.start_date || message.date || null,
                end_date: message.end_date || message.start_date || message.date || null
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
// ADMIN -> BOOKSY PAGE RELOAD
// ============================================================

async function checkRefreshCalendarRequest() {
    try {
        const response = await fetch(BACKEND_URL + "/api/booksy/refresh", {
            method: "GET",
            cache: "no-store"
        });
        const data = await response.json();
        const request = data?.request;

        if (!data?.requested || !request?.id || lastRefreshRequestId === request.id) {
            return;
        }

        await reportRefreshLog(request.id, "extension_received", "Розширення отримало команду оновлення.");

        let tab = null;
        const rememberedTabId = await getRememberedCalendarTabId();

        if (rememberedTabId) {
            try {
                const rememberedTab = await chrome.tabs.get(rememberedTabId);
                if (isBooksyTab(rememberedTab)) {
                    tab = rememberedTab;
                    await reportRefreshLog(request.id, "calendar_tab_found", `Знайдено вкладку календаря (tab ${tab.id}).`);
                }
            } catch (error) {
                // The calendar tab was closed; clear the stale reference.
                lastCalendarTabId = null;
                await chrome.storage.session.remove("booksyCalendarTabId");
                await reportRefreshLog(request.id, "calendar_tab_closed", "Збережену вкладку календаря закрито або вона недоступна.");
            }
        }

        // This fallback only applies before the extension has observed the
        // first calendar response. Afterwards we never choose a client tab.
        if (!tab) {
            const tabs = await chrome.tabs.query({
                url: ["https://booksy.com/*", "https://*.booksy.com/*"]
            });
            tab = tabs.find(item => item.active) || tabs[0] || null;
            if (tab?.id) {
                await reportRefreshLog(request.id, "fallback_tab", `Календарну вкладку ще не визначено; використано вкладку Booksy (tab ${tab.id}).`);
            }
        }

        if (!tab?.id) {
            console.warn("[BOOKSY] No Booksy tab available for refresh.");
            await reportRefreshLog(request.id, "no_tab", "Не знайдено відкриту вкладку Booksy для перезавантаження.");
            return;
        }

        // Reloading through Chrome, instead of a page-level postMessage,
        // survives Booksy overlays and SPA state changes caused by a new
        // customer booking.
        await chrome.tabs.reload(tab.id);
        console.log("[BOOKSY] Reloaded calendar source tab:", tab.id);
        await reportRefreshLog(request.id, "chrome_reload", `Chrome почав перезавантаження вкладки (tab ${tab.id}).`);

        lastRefreshRequestId = request.id;
        await fetch(BACKEND_URL + "/api/booksy/refresh/ack", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request_id: request.id })
        });
    } catch (error) {
        console.error("[BOOKSY] Refresh polling error:", error);
        await reportRefreshLog(null, "extension_error", `Помилка оновлення: ${error.message || String(error)}`);
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

        await reportCreateLog(request.id, "extension_received", "Розширення отримало команду створення запису.");

        console.log("[BOOKSY] Create appointment request:", request);

        let tab = null;
        const rememberedTabId = await getRememberedCalendarTabId();
        if (rememberedTabId) {
            try {
                const rememberedTab = await chrome.tabs.get(rememberedTabId);
                if (isBooksyTab(rememberedTab)) tab = rememberedTab;
            } catch (error) {
                lastCalendarTabId = null;
                await chrome.storage.session.remove("booksyCalendarTabId");
            }
        }

        if (!tab) {
            const tabs = await chrome.tabs.query({
                url: ["https://booksy.com/*", "https://*.booksy.com/*"]
            });
            tab = tabs.find(item => item.active) || tabs[0] || null;
        }

        let sent = false;
        if (tab?.id) {
            await reportCreateLog(request.id, "calendar_tab_found", `Вибрано вкладку Booksy (tab ${tab.id}) для створення запису.`);
            sent = await sendMessageToBooksyTab(tab.id, {
                type: "BOOKSY_CREATE_APPOINTMENT",
                request: request
            });
        } else {
            await reportCreateLog(request.id, "no_tab", "Не знайдено відкриту вкладку Booksy для створення запису.");
        }

        if (sent) {
            lastCreateAppointmentRequestId = request.id;
            await fetch(BACKEND_URL + "/api/booksy/create-appointment/ack", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ request_id: request.id })
            });
            await reportCreateLog(request.id, "command_sent", "Команду передано в inject.js; Booksy виконує створення.");
        } else {
            console.warn("[BOOKSY] No Booksy tab accepted create command.");
            await reportCreateLog(request.id, "delivery_failed", "Не вдалося передати команду у вкладку Booksy.");
        }
    } catch (error) {
        console.error("[BOOKSY] Create appointment polling error:", error);
        await reportCreateLog(null, "extension_error", `Помилка створення: ${error.message || String(error)}`);
    }
}

// ============================================================
// MANIFEST V3 BACKGROUND WAKE-UP
// ============================================================

async function processBackendCommands() {
    await checkRefreshCalendarRequest();
    await checkCreateAppointmentRequest();
}

function scheduleBackendPolling() {
    chrome.alarms.create(BACKEND_POLL_ALARM, {
        periodInMinutes: BACKEND_POLL_MINUTES
    });
}

chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === BACKEND_POLL_ALARM) {
        processBackendCommands();
    }
});

chrome.runtime.onInstalled.addListener(scheduleBackendPolling);
chrome.runtime.onStartup.addListener(scheduleBackendPolling);

scheduleBackendPolling();
processBackendCommands();
