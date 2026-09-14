/*
 * ============================================================
 * BOOKSY CONTENT SCRIPT
 * ============================================================
 *
 * Main responsibilities:
 *
 * 1. Load inject.js into Booksy page.
 * 2. Wait until inject.js is ACTUALLY loaded.
 * 3. Receive commands from background.js.
 * 4. Forward commands to inject.js.
 *
 * IMPORTANT:
 * We MUST NOT send window.postMessage() before inject.js
 * has finished loading.
 *
 * Previously this was a race condition:
 *
 * background.js
 *      ↓
 * content.js
 *      ↓
 * window.postMessage()
 *      ↓
 * inject.js was NOT ready yet
 *
 * The command was lost.
 *
 * This version queues commands until inject.js is ready.
 */

/* ============================================================
 * PREVENT DUPLICATE EXECUTION
 * ============================================================ */

if (!globalThis.__BOOKSY_CONTENT_LOADED__) {
    globalThis.__BOOKSY_CONTENT_LOADED__ = true;

    console.log("[BOOKSY] content.js loaded");

    /* ========================================================
     * STATE
     * ======================================================== */

    let injectReady = false;
    const pendingCommands = [];
    let latestCalendarDate = null;
    let calendarReceiveSequence = 0;

    /* ========================================================
     * SEND COMMAND TO INJECT.JS
     * ======================================================== */

    function sendCommandToInject(message) {
        if (!message) {
            return;
        }

        /*
         * inject.js is ready.
         * Send immediately.
         */
        if (injectReady) {
            console.log(
                "[BOOKSY] Sending command to inject.js:",
                message.type
            );

            window.postMessage(
                {
                    source: "BOOKSY_EXTENSION_CONTENT",
                    type: message.type,
                    date: message.date,
                    request: message.request
                },
                "*"
            );

            console.log(
                "[BOOKSY] Command posted to inject.js:",
                message.type
            );

            return;
        }

        /*
         * inject.js is not ready yet.
         *
         * Store command and send it after
         * script.onload fires.
         */
        console.log(
            "[BOOKSY] inject.js NOT READY — queueing command:",
            message.type
        );

        pendingCommands.push({
            source: "BOOKSY_EXTENSION_CONTENT",
            type: message.type,
            date: message.date,
            request: message.request
        });
    }

    /* ========================================================
     * FLUSH QUEUED COMMANDS
     * ======================================================== */

    function flushPendingCommands() {
        if (!injectReady) {
            return;
        }

        if (pendingCommands.length === 0) {
            console.log("[BOOKSY] No queued commands");
            return;
        }

        console.log(
            "[BOOKSY] inject.js ready — flushing queued commands:",
            pendingCommands.length
        );

        while (pendingCommands.length > 0) {
            const command = pendingCommands.shift();

            console.log(
                "[BOOKSY] Sending queued command:",
                command.type
            );

            window.postMessage(command, "*");

            console.log(
                "[BOOKSY] Queued command posted:",
                command.type
            );
        }
    }

    /* ========================================================
     * RECEIVE DATA FROM INJECT.JS
     *
     * IMPORTANT:
     * Install this listener BEFORE loading inject.js.
     * ======================================================== */

    window.addEventListener("message", function (event) {
        /*
         * Ignore messages from another window.
         */
        if (event.source !== window || !event.data) {
            return;
        }

        // ============================================================
        // BOOKSY API PROXY
        // inject.js -> content.js -> background.js
        // ============================================================
        if (
            event.data.source === "BOOKSY_EXTENSION" &&
            event.data.type === "BOOKSY_API_REQUEST"
        ) {
            const requestId = event.data.id;

            console.log(
                "[BOOKSY PROXY] API request from inject.js:",
                event.data.method || "GET",
                event.data.url,
                "id:",
                requestId
            );

            chrome.runtime.sendMessage(
                {
                    type: "BOOKSY_API_REQUEST",
                    uid: requestId,
                    id: requestId,
                    url: event.data.url,
                    method: event.data.method || "GET",
                    headers: event.data.headers || {},
                    body:
                        event.data.body !== undefined
                            ? event.data.body
                            : null
                },
                function (response) {
                    const runtimeError = chrome.runtime.lastError;

                    if (runtimeError) {
                        console.error(
                            "[BOOKSY PROXY] Runtime error:",
                            runtimeError.message
                        );

                        window.postMessage(
                            {
                                source: "BOOKSY_EXTENSION",
                                type: "BOOKSY_API_RESPONSE",
                                uid: requestId,
                                id: requestId,
                                ok: false,
                                error: runtimeError.message
                            },
                            "*"
                        );

                        return;
                    }

                    console.log(
                        "[BOOKSY PROXY] Response from background:",
                        response
                    );

                    window.postMessage(
                        {
                            source: "BOOKSY_EXTENSION",
                            type: "BOOKSY_API_RESPONSE",
                            uid: requestId,
                            id: requestId,
                            ok:
                                response &&
                                response.ok !== false,
                            status:
                                response &&
                                response.status !== undefined
                                    ? response.status
                                    : 200,
                            data:
                                response
                                    ? response.data
                                    : null,
                            text:
                                response
                                    ? response.text
                                    : null,
                            error:
                                response
                                    ? response.error
                                    : "Empty proxy response"
                        },
                        "*"
                    );
                }
            );

            return;
        }

        /*
         * ------------------------------------------------
         * CALENDAR
         * ------------------------------------------------
         */
        if (
            event.data.source === "BOOKSY_EXTENSION" &&
            event.data.type === "BOOKSY_CALENDAR"
        ) {
            const calendar = event.data.calendar;
            const url = event.data.url || "";
            const date = event.data.date || "";
            const startDate = event.data.start_date || event.data.week_start || date;
            const endDate = event.data.end_date || event.data.week_end || startDate;

            const receiveSequence = ++calendarReceiveSequence;

            console.log("[BOOKSY] Calendar received from page");
            console.log("[BOOKSY] Calendar URL:", url);
            console.log("[BOOKSY] Calendar range:", startDate, "→", endDate);
            console.log(
                "[BOOKSY] Calendar receive sequence:",
                receiveSequence
            );

            if (!startDate || !endDate) {
                console.warn(
                    "[BOOKSY] Calendar response without date — ignoring"
                );
                return;
            }

            /*
             * IMPORTANT:
             * Keep track of the newest calendar date received.
             *
             * This protects background.js from receiving
             * an older calendar response after the user has
             * already switched to another date.
             */
            latestCalendarDate = startDate;

            if (calendar && calendar.bookings) {
                console.log(
                    "[BOOKSY] Bookings:",
                    Object.keys(calendar.bookings).length
                );
            }

            /*
             * Send calendar to background.
             */
            chrome.runtime.sendMessage({
                type: "BOOKSY_CALENDAR",
                calendar: calendar,
                url: url,
                date: startDate,
                start_date: startDate,
                end_date: endDate,
                sequence: receiveSequence
            });

            return;
        }
    });

    /* ========================================================
     * RECEIVE COMMANDS FROM BACKGROUND
     *
     * IMPORTANT:
     * This listener is installed BEFORE inject.js is loaded.
     * ======================================================== */

    chrome.runtime.onMessage.addListener(function (
        message,
        sender,
        sendResponse
    ) {
        if (!message) {
            return;
        }

        /* ------------------------------------------------
         * PING
         * ------------------------------------------------ */
        if (message.type === "BOOKSY_PING") {
            console.log("[BOOKSY] PING received by content.js");
            sendResponse({ ok: true });
            return true;
        }

        /* ------------------------------------------------
         * EXTENSION PING
         * ------------------------------------------------ */
        if (message.type === "BOOKSY_EXTENSION_PING") {
            console.log("[BOOKSY] Ping received");
            sendResponse({ ok: true });
            return true;
        }

        /* ------------------------------------------------
         * NORMAL REFRESH
         * ------------------------------------------------ */
        if (message.type === "BOOKSY_REFRESH_CALENDAR") {
            console.log("[BOOKSY] Refresh command received");

            sendCommandToInject({
                type: "BOOKSY_REFRESH_CALENDAR"
            });

            sendResponse({ ok: true });
            return true;
        }

        /* ------------------------------------------------
         * FETCH SPECIFIC DATE
         * ------------------------------------------------ */
        if (message.type === "BOOKSY_FETCH_DATE") {
            console.log(
                "[BOOKSY] Specific date requested:",
                message.date
            );

            sendCommandToInject({
                type: "BOOKSY_FETCH_DATE",
                date: message.date
            });

            sendResponse({ ok: true });
            return true;
        }

        /* ------------------------------------------------
         * CREATE APPOINTMENT
         * ------------------------------------------------ */
        if (message.type === "BOOKSY_CREATE_APPOINTMENT") {
            console.log(
                "[BOOKSY] CREATE command received by content.js:",
                message
            );

            console.log(
                "[BOOKSY] CREATE request:",
                message.request
            );

            sendCommandToInject({
                type: "BOOKSY_CREATE_APPOINTMENT",
                request: message.request
            });

            sendResponse({ ok: true });
            return true;
        }
    });

    /* ========================================================
     * LOAD INJECT SCRIPT
     *
     * IMPORTANT:
     * This happens AFTER all listeners above are installed.
     * ======================================================== */

    if (!globalThis.__BOOKSY_INJECT_REQUESTED__) {
        globalThis.__BOOKSY_INJECT_REQUESTED__ = true;

        const script = document.createElement("script");
        script.src = chrome.runtime.getURL("inject.js");

        /*
         * This is the critical part.
         *
         * script.onload fires only after inject.js
         * has been downloaded AND executed.
         *
         * Therefore after this callback it is safe
         * to use window.postMessage().
         */
        script.onload = function () {
            console.log("[BOOKSY] inject.js loaded");
            injectReady = true;
            console.log("[BOOKSY] inject.js READY");

            /*
             * Send anything that arrived while
             * inject.js was loading.
             */
            flushPendingCommands();

            this.remove();
        };

        script.onerror = function (error) {
            console.error(
                "[BOOKSY] Failed to load inject.js:",
                error
            );
            injectReady = false;
        };

        (document.head || document.documentElement).appendChild(script);
    } else {
        /*
         * This can happen if content.js somehow
         * survives/reinitializes while the script
         * has already been requested.
         *
         * We do NOT assume inject.js is ready here.
         */
        console.log("[BOOKSY] inject.js already requested");
    }

    /* ========================================================
     * READY
     * ======================================================== */

    console.log("[BOOKSY] content.js ready");

    window.addEventListener("message", function (event) {
        console.log(
            "[BOOKSY TEST] MESSAGE RECEIVED IN content.js:",
            event.data
        );
    });
}
