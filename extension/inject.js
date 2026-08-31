console.log("[BOOKSY] inject.js started");

// ============================================================
// PREVENT DUPLICATE INJECTION
// ============================================================

if (window.__BOOKSY_INJECT_LOADED__) {
    console.log("[BOOKSY] inject.js already loaded");
} else {
    window.__BOOKSY_INJECT_LOADED__ = true;

    // ============================================================
    // CONFIG
    // ============================================================

    const CALENDAR_URL_PART = "/core/v2/business_api/me/businesses/";
    const CALENDAR_PATH = "/calendar";
    const SYNC_INTERVAL = 15000;

    // ============================================================
    // STATE
    // ============================================================

    let lastCalendarUrl = null;
    let lastCalendarSignature = null;
    let syncTimer = null;

    // ============================================================
    // BOOKSY AUTH / CONTEXT
    // ============================================================

    let booksyAuthHeaders = {};
    let booksyApiOrigin = null;
    let booksyBusinessId = null;

    function captureBooksyHeaders(headers) {
        if (!headers) {
            return;
        }

        try {
            const normalized = new Headers(headers);

            normalized.forEach(function (value, key) {
                const name = key.toLowerCase();

                if (
                    name === "x-access-token" ||
                    name === "x-api-key" ||
                    name === "x-analytics-tokens" ||
                    name === "authorization" ||
                    name === "api-key"
                ) {
                    booksyAuthHeaders[name] = value;

                    console.log(
                        "[BOOKSY AUTH] Captured header:",
                        name,
                        "length:",
                        String(value || "").length
                    );
                }
            });

            console.log(
                "[BOOKSY AUTH] Current captured headers:",
                Object.keys(booksyAuthHeaders)
            );

        } catch (error) {
            console.warn(
                "[BOOKSY AUTH] Cannot capture headers:",
                error
            );
        }
    }

    // ============================================================
    // BOOKSY XHR AUTH HEADER CAPTURE
    // ============================================================

    (function installBooksyXHRHeaderCapture() {
        if (XMLHttpRequest.prototype.__booksyAuthCaptureInstalled) {
            console.log(
                "[BOOKSY AUTH] XHR header capture already installed."
            );
            return;
        }

        XMLHttpRequest.prototype.__booksyAuthCaptureInstalled = true;

        const originalSetRequestHeader =
            XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
            try {
                const headerName = String(name || "").toLowerCase();

                if (
                    headerName === "x-access-token" ||
                    headerName === "x-api-key" ||
                    headerName === "x-analytics-tokens" ||
                    headerName === "authorization" ||
                    headerName === "api-key"
                ) {
                    booksyAuthHeaders[headerName] = String(value);

                    console.log(
                        "[BOOKSY AUTH] XHR captured header:",
                        headerName,
                        "length:",
                        String(value || "").length
                    );

                    console.log(
                        "[BOOKSY AUTH] Captured keys:",
                        Object.keys(booksyAuthHeaders)
                    );
                }

            } catch (error) {
                console.warn(
                    "[BOOKSY AUTH] XHR header capture error:",
                    error
                );
            }

            return originalSetRequestHeader.apply(this, arguments);
        };

        console.log(
            "[BOOKSY AUTH] XHR header capture installed."
        );
    })();

    function captureBooksyUrl(url) {
        if (!url) {
            return;
        }

        try {
            const parsed = new URL(url, window.location.href);

            const match = parsed.pathname.match(
                /\/core\/v2\/business_api\/me\/businesses\/(\d+)/
            );

            if (match) {
                booksyBusinessId = match[1];
                booksyApiOrigin = parsed.origin;

                console.log(
                    "[BOOKSY AUTH] Business:",
                    booksyBusinessId
                );

                console.log(
                    "[BOOKSY AUTH] API origin:",
                    booksyApiOrigin
                );
            }
        } catch (error) {
            // ignore
        }
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isCalendarUrl(url) {
        if (!url) {
            return false;
        }

        return (
            url.includes(CALENDAR_URL_PART) &&
            url.includes(CALENDAR_PATH) &&
            !url.includes("/calendar/")
        );
    }

    function getDateFromUrl(url) {
        try {
            const parsed = new URL(url);

            return (
                parsed.searchParams.get("st_nd_date") ||
                parsed.searchParams.get("start_date") ||
                null
            );
        } catch (error) {
            return null;
        }
    }

    function createSignature(data, url) {
        try {
            return (
                getDateFromUrl(url) +
                "|" +
                JSON.stringify(data)
            );
        } catch (error) {
            return (
                getDateFromUrl(url) +
                "|" +
                String(Date.now())
            );
        }
    }

    // ============================================================
    // SEND CALENDAR
    // ============================================================

    function sendCalendar(data, url) {
        if (!data) {
            return;
        }

        const date = getDateFromUrl(url);
        const signature = createSignature(data, url);

        console.log("[BOOKSY] Calendar received from Booksy");
        console.log("[BOOKSY] URL:", url);
        console.log("[BOOKSY] Date:", date);

        if (signature === lastCalendarSignature) {
            console.log("[BOOKSY] Calendar unchanged");
            return;
        }

        lastCalendarSignature = signature;

        window.postMessage(
            {
                source: "BOOKSY_EXTENSION",
                type: "BOOKSY_CALENDAR",
                calendar: data,
                url: url,
                date: date
            },
            "*"
        );
    }

    // ============================================================
    // XHR INTERCEPT
    // ============================================================

    (function interceptXHR() {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url, ...args) {
            this.__booksy_url = url;
            this.__booksy_method = method;

            captureBooksyUrl(url);

            if (isCalendarUrl(url)) {
                console.log(
                    "[BOOKSY] Calendar XHR detected:",
                    url
                );

                lastCalendarUrl = url;
            }

            return originalOpen.call(this, method, url, ...args);
        };

        XMLHttpRequest.prototype.send = function (body) {
            if (this.__booksy_url && isCalendarUrl(this.__booksy_url)) {
                this.addEventListener("load", function () {
                    console.log(
                        "[BOOKSY] Calendar XHR response:",
                        this.status
                    );

                    if (this.status < 200 || this.status >= 300) {
                        console.warn(
                            "[BOOKSY] Calendar XHR failed:",
                            this.status
                        );
                        return;
                    }

                    let data = null;

                    try {
                        if (
                            typeof this.response === "object" &&
                            this.response !== null
                        ) {
                            data = this.response;
                        } else {
                            data = JSON.parse(this.responseText);
                        }
                    } catch (error) {
                        console.error(
                            "[BOOKSY] Calendar XHR parse error:",
                            error
                        );
                        return;
                    }

                    sendCalendar(data, this.__booksy_url);
                });
            }

            return originalSend.call(this, body);
        };
    })();

    // ============================================================
    // FETCH INTERCEPT
    // ============================================================

    (function interceptFetch() {
        const originalFetch = window.fetch;

        if (!originalFetch) {
            return;
        }

        window.fetch = async function (...args) {
            const request = args[0];
            let url = "";
            let requestHeaders = null;

            try {
                if (typeof request === "string") {
                    url = request;
                } else if (request && typeof request.url === "string") {
                    url = request.url;
                    requestHeaders = request.headers;
                }

                if (args[1] && args[1].headers) {
                    requestHeaders = args[1].headers;
                }

                captureBooksyUrl(url);
                captureBooksyHeaders(requestHeaders);
            } catch (error) {
                // ignore
            }

            const response = await originalFetch.apply(this, args);

            if (isCalendarUrl(url)) {
                console.log(
                    "[BOOKSY] Calendar FETCH detected:",
                    url
                );

                lastCalendarUrl = url;

                if (response.ok) {
                    try {
                        const clone = response.clone();
                        const data = await clone.json();

                        sendCalendar(data, url);
                    } catch (error) {
                        console.error(
                            "[BOOKSY] Calendar FETCH parse error:",
                            error
                        );
                    }
                }
            }

            return response;
        };
    })();

    // ============================================================
    // FIND BOOKSY DATE ELEMENT
    // ============================================================

    function findBooksyDateElement(date) {
        if (!date) {
            return null;
        }

        const parts = date.split("-");
        if (parts.length !== 3) {
            return null;
        }

        const day = Number(parts[2]);

        const all = document.querySelectorAll(
            "[data-date], [aria-label], [title]"
        );

        for (const element of all) {
            const values = [
                element.getAttribute("data-date"),
                element.getAttribute("aria-label"),
                element.getAttribute("title")
            ].filter(Boolean);

            for (const value of values) {
                if (value.includes(date)) {
                    return element;
                }
            }
        }

        const testElements = document.querySelectorAll(
            '[data-testid*="date-picker-day"]'
        );

        for (const element of testElements) {
            const text = (element.innerText || "").trim();

            if (text === String(day)) {
                return element;
            }
        }

        return null;
    }

    // ============================================================
    // CLICK BOOKSY DATE
    // ============================================================

    function clickBooksyDate(date) {
        console.log(
            "[BOOKSY] Request to switch Booksy date:",
            date
        );

        const currentUrlDate = getDateFromUrl(lastCalendarUrl);

        if (currentUrlDate === date) {
            console.log(
                "[BOOKSY] Date already active:",
                date
            );
            return;
        }

        const element = findBooksyDateElement(date);

        if (element) {
            console.log(
                "[BOOKSY] Clicking Booksy date element:",
                element
            );

            element.click();
            return;
        }

        console.warn(
            "[BOOKSY] Date element not found in current Booksy calendar:",
            date
        );
    }

    // ============================================================
    // REFRESH
    // ============================================================

    function refreshCalendar() {
        console.log(
            "[BOOKSY SYNC] Waiting for Booksy calendar request"
        );
    }

    // ============================================================
    // BOOKSY API BASE
    // ============================================================

    function getBooksyApiBase() {
        const candidates = [];

        if (lastCalendarUrl) {
            candidates.push(String(lastCalendarUrl));
        }

        candidates.push(String(window.location.href));

        for (const rawUrl of candidates) {
            try {
                if (!rawUrl) {
                    continue;
                }

                const parsed = new URL(rawUrl, window.location.href);

                const match = parsed.pathname.match(
                    /\/core\/v2\/business_api\/me\/businesses\/(\d+)/
                );

                if (match) {
                    const businessId = match[1];
                    const base = `${parsed.origin}/core/v2/business_api/me/businesses/${businessId}`;

                    console.log(
                        "[BOOKSY CREATE] API base detected:",
                        base
                    );

                    return base;
                }
            } catch (error) {
                console.warn(
                    "[BOOKSY CREATE] Failed to parse candidate URL:",
                    rawUrl,
                    error
                );
            }
        }

        const fallback =
            "https://pl.booksy.com/core/v2/business_api/me/businesses/356672";

        console.warn(
            "[BOOKSY CREATE] API base was not detected automatically."
        );

        console.warn(
            "[BOOKSY CREATE] Using fallback:",
            fallback
        );

        return fallback;
    }

    // ============================================================
    // BOOKSY API PROXY (MESSAGE ROUTER)
    // ============================================================

    const booksyApiProxyPending = new Map();
    let booksyApiProxyCounter = 0;

    // ============================================================
    // RECEIVE PROXY RESPONSE FROM content.js
    // ============================================================

    window.addEventListener(
        "message",
        function (event) {
            if (
                event.source !== window ||
                !event.data ||
                event.data.source !== "BOOKSY_EXTENSION" ||
                event.data.type !== "BOOKSY_API_RESPONSE"
            ) {
                return;
            }

            const id = event.data.uid || event.data.id;

            console.log(
                "[BOOKSY API] PROXY RESPONSE RECEIVED:",
                id
            );

            console.log(
                "[BOOKSY API] PROXY RESPONSE DATA:",
                event.data
            );

            if (!id) {
                console.error(
                    "[BOOKSY API] Response has no uid/id:",
                    event.data
                );
                return;
            }

            const pending = booksyApiProxyPending.get(id);

            if (!pending) {
                console.warn(
                    "[BOOKSY API] No pending request:",
                    id
                );

                console.warn(
                    "[BOOKSY API] Pending request IDs:",
                    Array.from(booksyApiProxyPending.keys())
                );
                return;
            }

            booksyApiProxyPending.delete(id);

            if (event.data.ok === false) {
                const error = new Error(
                    event.data.error ||
                    `Booksy API proxy failed (${event.data.status || "unknown"})`
                );

                error.status = event.data.status;
                error.response = event.data.data;

                console.error(
                    "[BOOKSY API] PROXY REQUEST FAILED:",
                    error
                );

                pending.reject(error);
                return;
            }

            const status = Number(event.data.status || 200);

            console.log(
                "[BOOKSY API] PROXY REQUEST SUCCESS:",
                status
            );

            pending.resolve({
                ok: status >= 200 && status < 300,
                status: status,
                data: event.data.data,
                json: async function () {
                    return event.data.data;
                },
                text: async function () {
                    return event.data.text || "";
                }
            });
        }
    );

    // ============================================================
    // SEND BOOKSY API REQUEST THROUGH EXTENSION
    // ============================================================

    function requestBooksyApiThroughExtension(url, options = {}) {
        return new Promise(function (resolve, reject) {
            const id = `${Date.now()}_${++booksyApiProxyCounter}`;

            console.log(
                "[BOOKSY API] Creating proxy request:",
                id
            );

            const timeout = setTimeout(function () {
                booksyApiProxyPending.delete(id);

                console.error(
                    "[BOOKSY API] PROXY TIMEOUT:",
                    id,
                    url
                );

                reject(
                    new Error("Booksy API proxy timeout.")
                );
            }, 30000);

            booksyApiProxyPending.set(id, {
                resolve: function (value) {
                    clearTimeout(timeout);
                    resolve(value);
                },
                reject: function (error) {
                    clearTimeout(timeout);
                    reject(error);
                }
            });

            const proxyHeaders = {
                ...(typeof booksyAuthHeaders === "object" ? booksyAuthHeaders : {}),
                ...(options.headers || {})
            };

            if (!proxyHeaders.accept) {
                proxyHeaders.accept = "application/json, text/plain, */*";
            }

            if (
                options.body !== undefined &&
                options.body !== null &&
                !proxyHeaders["content-type"]
            ) {
                proxyHeaders["content-type"] = "application/json";
            }

            console.log(
                "[BOOKSY API] PROXY REQUEST:",
                options.method || "GET",
                url
            );

            console.log(
                "[BOOKSY API] PROXY REQUEST ID:",
                id
            );

            console.log(
                "[BOOKSY API] PROXY AUTH HEADERS:",
                Object.keys(proxyHeaders)
            );

            const message = {
                source: "BOOKSY_EXTENSION",
                type: "BOOKSY_API_REQUEST",
                uid: id,
                id: id,
                url: url,
                method: options.method || "GET",
                headers: proxyHeaders,
                body: options.body !== undefined ? options.body : null
            };

            console.log(
                "[BOOKSY API] PROXY POST MESSAGE:",
                message
            );

            window.postMessage(message, "*");

            console.log(
                "[BOOKSY API] PROXY REQUEST SENT:",
                id
            );
        });
    }

    // ============================================================
    // BOOKSY REQUEST
    // ============================================================

    async function booksyRequest(url, options = {}) {
        console.log(
            "[BOOKSY API] REQUEST:",
            options.method || "GET",
            url
        );

        const headers = new Headers({
            ...booksyAuthHeaders,
            ...(options.headers || {})
        });

        console.log(
            "[BOOKSY API] AUTH HEADERS USED:",
            Array.from(headers.keys())
        );

        try {
            const result = await requestBooksyApiThroughExtension(url, {
                ...options,
                headers: Object.fromEntries(headers.entries())
            });

            console.log(
                "[BOOKSY API] STATUS:",
                result.status
            );

            console.log(
                "[BOOKSY API] RESPONSE:",
                result.data
            );

            if (!result.ok) {
                throw new Error(
                    `Booksy HTTP ${result.status}: ${JSON.stringify(result.data)}`
                );
            }

            return result.data;
        } catch (error) {
            console.error(
                "[BOOKSY API] PROXY FAILED:",
                error
            );
            throw error;
        }
    }

    // ============================================================
    // LOAD CATALOG
    // ============================================================

    async function getBooksyCatalogForCreate() {
        const base = getBooksyApiBase();

        console.log("[BOOKSY CREATE] Loading services...");

        const serviceResponse = await booksyRequest(
            `${base}/service_categories?with_combos=true`
        );

        console.log("[BOOKSY CREATE] Loading staffers...");

        const stafferResponse = await booksyRequest(
            `${base}/resources`
        );

        const staffers = (
            stafferResponse.resources ||
            stafferResponse.data ||
            []
        ).map(resource => ({
            id: resource.id,
            name: resource.name || "Працівник"
        }));

        const services = [];
        const categories =
            serviceResponse.service_categories ||
            serviceResponse.categories ||
            [];

        for (const category of categories) {
            for (const service of category.services || []) {
                for (const variant of service.variants || []) {
                    services.push({
                        id: service.id,
                        name: service.name || "Без назви",
                        variant_id: variant.id,
                        duration: variant.duration || 30,
                        price: variant.price,
                        service_price:
                            variant.service_price ||
                            service.service_price,
                        staffer_ids:
                            variant.staffers ||
                            service.resources ||
                            [],
                        service: service,
                        variant: variant
                    });
                }
            }
        }

        return {
            services: services,
            staffers: staffers
        };
    }

    // ============================================================
    // FIND SERVICE / STAFFER
    // ============================================================

    function findCreateService(catalog, variantId) {
        return catalog.services.find(
            item => String(item.variant_id) === String(variantId)
        );
    }

    function findCreateStaffer(catalog, stafferId) {
        return catalog.staffers.find(
            item => String(item.id) === String(stafferId)
        );
    }

    // ============================================================
    // CREATE APPOINTMENT
    // ============================================================

    async function createBooksyAppointment(request) {
        console.log("[BOOKSY CREATE] Request:", request);

        try {
            if (!request) {
                throw new Error("Порожній create appointment request.");
            }

            const {
                date,
                start,
                end,
                staffer_id,
                variant_id,
                business_secret_note
            } = request;

            if (
                !date ||
                !start ||
                !end ||
                !staffer_id ||
                !variant_id
            ) {
                throw new Error(
                    "Не вистачає date/start/end/staffer_id/variant_id."
                );
            }

            const base = getBooksyApiBase();

            console.log("[BOOKSY CREATE] API base:", base);

            // --------------------------------------------------------
            // LOAD CATALOG
            // --------------------------------------------------------

            const catalog = await getBooksyCatalogForCreate();

            console.log("[BOOKSY CREATE] Catalog:", catalog);

            const serviceItem = findCreateService(catalog, variant_id);

            if (!serviceItem) {
                throw new Error(
                    `Не знайдено variant_id=${variant_id} у Booksy services.`
                );
            }

            const stafferItem = findCreateStaffer(catalog, staffer_id);

            if (!stafferItem) {
                throw new Error(
                    `Не знайдено staffer_id=${staffer_id} у Booksy resources.`
                );
            }

            // --------------------------------------------------------
            // BUILD PAYLOAD
            // --------------------------------------------------------

            const service = serviceItem.service;
            const variant = serviceItem.variant;

            const bookedFrom = `${date}T${start}`;
            const bookedTill = `${date}T${end}`;

            const servicePayload = {
                partner_app_data: service.partner_app_data || {},
                id: service.id,
                name: service.name,
                variant: {
                    id: variant.id,
                    type: variant.type || "X",
                    label: variant.label || "",
                    price: Number(variant.price || 0),
                    duration: variant.duration || 30,
                    active: true
                },
                combo_type: service.combo_type,
                category_name: service.category_name,
                service_category_id: service.service_category_id,
                color: service.color,
                active: true,
                note_to_customer: service.note_to_customer || "",
                treatment_internal_name: service.treatment_internal_name,
                staffer_ids: service.resources || [],
                appliance_ids: service.appliance_ids || [],
                is_traveling_service: service.is_traveling_service || false
            };

            const stafferPayload = {
                partner_app_data: {},
                id: stafferItem.id,
                type: "S",
                name: stafferItem.name,
                active: true,
                visible: true,
                description: null,
                position: "",
                staff_user_exists: true,
                is_invited: false,
                invited: null
            };

            const appointment = {
                is_deposit_available: false,
                partner_app_data: {},
                traveling: null,
                consent_forms: [],
                appointment_uid: null,
                _version: null,
                customer: {
                    mode: "walk-in"
                },
                business_note: "",
                business_secret_note: business_secret_note || "",
                subbookings: [
                    {
                        partner_app_data: {},
                        booked_from: bookedFrom,
                        booked_till: bookedTill,
                        staffer_id: stafferItem.id,
                        autoassigned_staffer_id: null,
                        appliance_id: null,
                        service_variant: {
                            id: variant.id,
                            version: Number(
                                variant.version ||
                                serviceItem.variant?.version ||
                                1
                            ),
                            mode: "variant"
                        },
                        addons: [],
                        combo_children: [],
                        is_staffer_requested_by_client: false,
                        id: null,
                        service: servicePayload,
                        service_price:
                            serviceItem.service_price ||
                            String(variant.price || 0),
                        staffer: stafferPayload,
                        appliance: null,
                        autoassign: false,
                        gap_hole_start: null,
                        gap_hole_end: null,
                        wait_time: {},
                        is_highlighted: false,
                        service_promotion: null,
                        surcharge: null,
                        editable: true
                    }
                ],
                appointment_id: null,
                appointment_type: "single",
                booked_from: bookedFrom,
                booked_till: bookedTill,
                status: "A",
                type: "B",
                customer_note: null,
                repeating: null,
                repeating_series: null,
                overbooking: false,
                _notification_enabled: true,
                _notify_about_reschedule: false,
                _preserve_order: false
            };

            console.log(
                "[BOOKSY CREATE] Final appointment payload:",
                appointment
            );

            // --------------------------------------------------------
            // DRY RUN
            // --------------------------------------------------------

            console.log("[BOOKSY CREATE] Starting dry-run...");

            const dryRun = await booksyRequest(
                `${base}/appointments/dry_run/`,
                {
                    method: "POST",
                    body: JSON.stringify(appointment)
                }
            );

            console.log(
                "[BOOKSY CREATE] Dry-run successful:",
                dryRun
            );

            if (
                dryRun &&
                Array.isArray(dryRun.errors) &&
                dryRun.errors.length
            ) {
                throw new Error(
                    `Booksy dry-run errors: ${JSON.stringify(dryRun.errors)}`
                );
            }

            // --------------------------------------------------------
            // REAL CREATE
            // --------------------------------------------------------

            console.log("[BOOKSY CREATE] Creating appointment...");

            const created = await booksyRequest(
                `${base}/appointments/`,
                {
                    method: "POST",
                    body: JSON.stringify(appointment)
                }
            );

            console.log(
                "[BOOKSY CREATE] APPOINTMENT CREATED:",
                created
            );

            // --------------------------------------------------------
            // REPORT RESULT TO BACKEND
            // --------------------------------------------------------

            const backendResponse = await fetch(
                "http://127.0.0.1:3000/api/booksy/create-appointment/result",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        ok: true,
                        request_id: request.id,
                        date: request.date,
                        result: created
                    })
                }
            );

            console.log(
                "[BOOKSY CREATE] Backend result:",
                backendResponse.status
            );

            if (!backendResponse.ok) {
                console.warn(
                    "[BOOKSY CREATE] Appointment was created, but backend result notification failed."
                );
            }

            // --------------------------------------------------------
            // REFRESH
            // --------------------------------------------------------

            setTimeout(function () {
                console.log(
                    "[BOOKSY CREATE] Refreshing Booksy calendar..."
                );
                refreshCalendar();
            }, 1000);

        } catch (error) {
            console.error(
                "[BOOKSY CREATE] FAILED:",
                error
            );

            try {
                await fetch(
                    "http://127.0.0.1:3000/api/booksy/create-appointment/result",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            ok: false,
                            request_id: request?.id,
                            date: request?.date,
                            error: error?.message || String(error)
                        })
                    }
                );
            } catch (backendError) {
                console.error(
                    "[BOOKSY CREATE] Failed to report error to backend:",
                    backendError
                );
            }
        }
    }

    // ============================================================
    // RECEIVE CREATE COMMAND
    // ============================================================

    window.addEventListener("message", function (event) {
        if (
            event.source !== window ||
            !event.data ||
            event.data.source !== "BOOKSY_EXTENSION_CONTENT" ||
            event.data.type !== "BOOKSY_CREATE_APPOINTMENT"
        ) {
            return;
        }

        console.log(
            "[BOOKSY CREATE] Command received by inject.js"
        );

        createBooksyAppointment(event.data.request);
    });

    // ============================================================
    // RECEIVE NORMAL COMMANDS
    // ============================================================

    window.addEventListener("message", function (event) {
        if (
            event.source !== window ||
            !event.data ||
            event.data.source !== "BOOKSY_EXTENSION_CONTENT"
        ) {
            return;
        }

        if (event.data.type === "BOOKSY_REFRESH_CALENDAR") {
            refreshCalendar();
            return;
        }

        if (event.data.type === "BOOKSY_FETCH_DATE") {
            clickBooksyDate(event.data.date);
        }
    });

    // ============================================================
    // AUTOMATIC SYNC
    // ============================================================

    function startSync() {
        if (syncTimer) {
            return;
        }

        console.log(
            "[BOOKSY SYNC] Automatic sync started:",
            SYNC_INTERVAL / 1000,
            "seconds"
        );

        syncTimer = setInterval(
            refreshCalendar,
            SYNC_INTERVAL
        );
    }

    startSync();

    console.log(
        "[BOOKSY] Calendar interception active"
    );

    // ============================================================
    // TEST CREATE FUNCTION
    // ============================================================

    window.testBooksyAppointmentCreate = async function () {
        const request = {
            date: "2026-08-26",
            start: "14:00",
            end: "14:30",
            staffer_id: "859195",
            variant_id: "22865720",
            business_secret_note: ""
        };

        console.log(
            "[TEST CREATE] Starting create test:",
            request
        );

        try {
            const base = getBooksyApiBase();
            const catalog = await getBooksyCatalogForCreate();

            console.log(
                "[TEST CREATE] Catalog loaded:",
                catalog
            );

            const serviceItem = findCreateService(
                catalog,
                request.variant_id
            );

            if (!serviceItem) {
                throw new Error(
                    "Service variant not found: " + request.variant_id
                );
            }

            const stafferItem = findCreateStaffer(
                catalog,
                request.staffer_id
            );

            if (!stafferItem) {
                throw new Error(
                    "Staffer not found: " + request.staffer_id
                );
            }

            console.log("[TEST CREATE] Service:", serviceItem);
            console.log("[TEST CREATE] Staffer:", stafferItem);

            const service = serviceItem.service;
            const variant = serviceItem.variant;

            const bookedFrom = `${request.date}T${request.start}`;
            const bookedTill = `${request.date}T${request.end}`;

            const servicePayload = {
                partner_app_data: service.partner_app_data || {},
                id: service.id,
                name: service.name,
                variant: {
                    id: variant.id,
                    type: variant.type || "X",
                    label: variant.label || "",
                    price: Number(variant.price || 0),
                    duration: variant.duration || 30,
                    active: true
                },
                combo_type: service.combo_type,
                category_name: service.category_name,
                service_category_id: service.service_category_id,
                color: service.color,
                active: true,
                note_to_customer: service.note_to_customer || "",
                treatment_internal_name: service.treatment_internal_name,
                staffer_ids: service.resources || [],
                appliance_ids: service.appliance_ids || [],
                is_traveling_service: service.is_traveling_service || false
            };

            const stafferPayload = {
                partner_app_data: {},
                id: stafferItem.id,
                type: "S",
                name: stafferItem.name,
                active: true,
                visible: true,
                description: null,
                position: "",
                staff_user_exists: true,
                is_invited: false,
                invited: null
            };

            const appointment = {
                is_deposit_available: false,
                partner_app_data: {},
                traveling: null,
                consent_forms: [],
                appointment_uid: null,
                _version: null,
                customer: {
                    mode: "walk-in"
                },
                business_note: "",
                business_secret_note: request.business_secret_note || "",
                subbookings: [
                    {
                        partner_app_data: {},
                        booked_from: bookedFrom,
                        booked_till: bookedTill,
                        staffer_id: stafferItem.id,
                        autoassigned_staffer_id: null,
                        appliance_id: null,
                        service_variant: {
                            id: variant.id,
                            version: Number(variant.version || 1),
                            mode: "variant"
                        },
                        addons: [],
                        combo_children: [],
                        is_staffer_requested_by_client: false,
                        id: null,
                        service: servicePayload,
                        service_price: String(variant.price || 0),
                        staffer: stafferPayload,
                        appliance: null,
                        autoassign: false,
                        gap_hole_start: null,
                        gap_hole_end: null,
                        wait_time: {},
                        is_highlighted: false,
                        service_promotion: null,
                        surcharge: null,
                        editable: true
                    }
                ],
                appointment_id: null,
                appointment_type: "single",
                booked_from: bookedFrom,
                booked_till: bookedTill,
                status: "A",
                type: "B",
                customer_note: null,
                repeating: null,
                repeating_series: null,
                overbooking: false,
                _notification_enabled: true,
                _notify_about_reschedule: false,
                _preserve_order: false
            };

            console.log(
                "[TEST CREATE] CREATE PAYLOAD:",
                appointment
            );

            console.log(
                "[TEST CREATE] Sending create..."
            );

            const result = await booksyRequest(
                `${base}/appointments/`,
                {
                    method: "POST",
                    body: JSON.stringify(appointment)
                }
            );

            console.log(
                "[TEST CREATE] CREATE RESULT:",
                result
            );

            return result;

        } catch (error) {
            console.error(
                "[TEST CREATE] CREATE FAILED:",
                error
            );

            console.error(
                "[TEST CREATE] STATUS:",
                error.status
            );

            console.error(
                "[TEST CREATE] RESPONSE:",
                error.response
            );

            throw error;
        }
    };
}