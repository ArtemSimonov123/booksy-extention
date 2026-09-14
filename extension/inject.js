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
    let syncInProgress = false;

    // ============================================================
    // WEEK CALENDAR STATE
    // ============================================================

    let lastCalendarWeekStart = null;
    let lastCalendarWeekEnd = null;
    let lastCalendarWeekData = null;
    let lastCalendarWeekUrl = null;
    let lastCalendarWeekReceivedAt = null;

    // ============================================================
    // LEGACY DATE STATE
    // ============================================================
    // Поки що залишаємо для сумісності
    // зі старим content/background.
    // На наступному етапі приберемо.
    const calendarCache = new Map();
    let requestedCalendarDate = null;
    let dateSwitchInProgress = false;

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
        if (!url) {
            return null;
        }

        try {
            const parsed = new URL(
                url,
                window.location.href
            );

            const date =
                parsed.searchParams.get("st_nd_date") ||
                parsed.searchParams.get("start_date") ||
                parsed.searchParams.get("date") ||
                null;

            return date;
        } catch (error) {
            console.warn(
                "[BOOKSY DATE] Cannot parse URL:",
                url,
                error
            );

            return null;
        }
    }

    function getCalendarRangeFromUrl(url) {
        if (!url) {
            return null;
        }

        try {
            const parsed = new URL(
                url,
                window.location.href
            );

            const startDate =
                parsed.searchParams.get("start_date") ||
                parsed.searchParams.get("st_nd_date") ||
                parsed.searchParams.get("date") ||
                null;

            const endDate =
                parsed.searchParams.get("end_date") ||
                startDate;

            if (!startDate) {
                return null;
            }

            return {
                startDate,
                endDate
            };

        } catch (error) {

            console.warn(
                "[BOOKSY WEEK] Cannot parse calendar range:",
                error
            );

            return null;
        }
    }

    function createSignature(data, url) {
        try {
            return JSON.stringify(data);
        } catch (error) {
            return String(Date.now());
        }
    }

    // ============================================================
    // SEND CALENDAR & WEEK CACHE
    // ============================================================

    function sendCalendar(data, url) {
        if (!data || !url) {
            return;
        }

        const range =
            getCalendarRangeFromUrl(url);

        if (!range) {
            console.warn(
                "[BOOKSY WEEK] Calendar response without valid range:",
                url
            );

            return;
        }

        const signature =
            createSignature(data, url);

        console.log(
            "[BOOKSY WEEK] Calendar received from Booksy"
        );

        console.log(
            "[BOOKSY WEEK] URL:",
            url
        );

        console.log(
            "[BOOKSY WEEK] Range:",
            range.startDate,
            "→",
            range.endDate
        );

        // --------------------------------------------------------
        // Перевіряємо, чи це той самий тиждень і ті самі дані
        // --------------------------------------------------------

        if (
            lastCalendarWeekStart === range.startDate &&
            lastCalendarWeekEnd === range.endDate &&
            lastCalendarSignature === signature
        ) {
            console.log(
                "[BOOKSY WEEK] Calendar unchanged:",
                range.startDate,
                "→",
                range.endDate
            );

            return;
        }

        // --------------------------------------------------------
        // Зберігаємо весь тиждень
        // --------------------------------------------------------

        lastCalendarWeekStart =
            range.startDate;

        lastCalendarWeekEnd =
            range.endDate;

        lastCalendarWeekData =
            data;

        lastCalendarWeekUrl =
            url;

        lastCalendarWeekReceivedAt =
            Date.now();

        lastCalendarSignature =
            signature;

        lastCalendarUrl =
            url;

        // --------------------------------------------------------
        // Для сумісності залишаємо cache
        // --------------------------------------------------------

        calendarCache.set(
            range.startDate,
            {
                signature,
                data,
                url,
                startDate: range.startDate,
                endDate: range.endDate,
                receivedAt: Date.now()
            }
        );

        // --------------------------------------------------------
        // Передаємо ВЕСЬ ТИЖДЕНЬ у content.js
        // --------------------------------------------------------

        window.postMessage(
            {
                source:
                    "BOOKSY_EXTENSION",

                type:
                    "BOOKSY_CALENDAR",

                calendar:
                    data,

                url:
                    url,

                date:
                    range.startDate,

                start_date:
                    range.startDate,

                end_date:
                    range.endDate,

                week_start:
                    range.startDate,

                week_end:
                    range.endDate,

                cached:
                    false
            },
            "*"
        );

        console.log(
            "[BOOKSY WEEK] Week synchronized:",
            range.startDate,
            "→",
            range.endDate
        );
    }

    function sendCachedCalendar(date) {
        if (!date) {
            return false;
        }

        const cached = calendarCache.get(date);

        if (!cached) {
            console.log(
                "[BOOKSY CACHE] No cached calendar for:",
                date
            );

            return false;
        }

        console.log(
            "[BOOKSY CACHE] Sending cached calendar:",
            date
        );

        window.postMessage(
            {
                source: "BOOKSY_EXTENSION",
                type: "BOOKSY_CALENDAR",
                calendar: cached.data,
                url: cached.url,
                date: date,
                cached: true
            },
            "*"
        );

        return true;
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
                    "[BOOKSY DATE] Calendar XHR detected:",
                    url
                );

                lastCalendarUrl = url;

                console.log(
                    "[BOOKSY DATE] Calendar XHR date:",
                    getDateFromUrl(url)
                );
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
                    "[BOOKSY DATE] Calendar FETCH detected:",
                    url
                );

                lastCalendarUrl = url;

                console.log(
                    "[BOOKSY DATE] Calendar FETCH date:",
                    getDateFromUrl(url)
                );

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
    // MONTH & TARGET HELPERS
    // ============================================================

    function getBooksyMonthYear() {
        const monthEl = document.querySelector('._monthName_1vqly_274');

        if (!monthEl) {
            console.warn('[BOOKSY DATE] Month name element not found');
            return null;
        }

        const text = monthEl.textContent.trim().toLowerCase();

        const months = {
            'січень': 0,
            'лютий': 1,
            'березень': 2,
            'квітень': 3,
            'травень': 4,
            'червень': 5,
            'липень': 6,
            'серпень': 7,
            'вересень': 8,
            'жовтень': 9,
            'листопад': 10,
            'грудень': 11
        };

        const match = text.match(/^([а-яіїєґ]+)\s+(\d{4})$/i);

        if (!match) {
            console.warn('[BOOKSY DATE] Cannot parse month:', text);
            return null;
        }

        const monthName = match[1];
        const year = Number(match[2]);

        if (!(monthName in months)) {
            console.warn('[BOOKSY DATE] Unknown month:', monthName);
            return null;
        }

        return {
            year,
            month: months[monthName],
            text
        };
    }

    function getTargetDateInfo(dateString) {
        const date = new Date(`${dateString}T12:00:00`);

        if (Number.isNaN(date.getTime())) {
            console.error('[BOOKSY DATE] Invalid target date:', dateString);
            return null;
        }

        return {
            year: date.getFullYear(),
            month: date.getMonth(),
            day: date.getDate(),
            dateString
        };
    }

    async function navigateBooksyToMonth(targetYear, targetMonth) {
        const MAX_CLICKS = 24;

        for (let attempt = 0; attempt < MAX_CLICKS; attempt++) {
            const current = getBooksyMonthYear();

            if (!current) {
                console.warn('[BOOKSY DATE] Cannot determine current Booksy month');
                return false;
            }

            console.log(
                '[BOOKSY DATE] Month navigation:',
                `${current.year}-${String(current.month + 1).padStart(2, '0')}`,
                '→',
                `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`
            );

            if (
                current.year === targetYear &&
                current.month === targetMonth
            ) {
                console.log('[BOOKSY DATE] Target month reached');
                return true;
            }

            const currentValue = current.year * 12 + current.month;
            const targetValue = targetYear * 12 + targetMonth;

            const selector =
                targetValue > currentValue
                    ? '[data-testid="b-date-picker-arrow-right"]'
                    : '[data-testid="b-date-picker-arrow-left"]';

            const arrow = document.querySelector(selector);

            if (!arrow) {
                console.error(
                    '[BOOKSY DATE] Navigation arrow not found:',
                    selector
                );
                return false;
            }

            console.log(
                '[BOOKSY DATE] Clicking:',
                selector
            );

            arrow.click();

            await new Promise(resolve => setTimeout(resolve, 300));

            const afterClick = getBooksyMonthYear();

            if (!afterClick) {
                continue;
            }

            if (
                afterClick.year === targetYear &&
                afterClick.month === targetMonth
            ) {
                console.log('[BOOKSY DATE] Month successfully changed');
                return true;
            }
        }

        console.error(
            '[BOOKSY DATE] Failed to navigate to month:',
            targetYear,
            targetMonth + 1
        );

        return false;
    }

    // ============================================================
    // FIND BOOKSY DATE ELEMENT
    // ============================================================

    function findBooksyDateElement(day) {
        const candidates = Array.from(
            document.querySelectorAll('[data-testid^="b-date-picker-day-"]')
        );

        console.log(
            '[BOOKSY DATE] Looking for current-month day:',
            day,
            'candidates:',
            candidates.length
        );

        const matching = candidates.filter(el => {
            const text = (el.textContent || '').trim();

            if (text !== String(day)) {
                return false;
            }

            const className =
                typeof el.className === 'string'
                    ? el.className
                    : '';

            if (className.includes('_dayOther')) {
                return false;
            }

            return true;
        });

        if (matching.length === 0) {
            console.warn(
                '[BOOKSY DATE] Current-month day not found:',
                day
            );
            return null;
        }

        console.log(
            '[BOOKSY DATE] Current-month day found:',
            matching[0]
        );

        return matching[0];
    }

    // ============================================================
    // CLICK BOOKSY DATE
    // ============================================================

    async function clickBooksyDate(dateString) {
        console.log('[BOOKSY DATE] Requested date:', dateString);

        if (!dateString) {
            return false;
        }

        requestedCalendarDate = dateString;

        if (dateSwitchInProgress) {
            console.warn(
                "[BOOKSY DATE] Date switch already in progress:",
                dateString
            );

            return false;
        }

        dateSwitchInProgress = true;

        try {
            const target = getTargetDateInfo(dateString);

            if (!target) {
                return false;
            }

            console.log('[BOOKSY DATE] Target:', target);

            const monthReady = await navigateBooksyToMonth(
                target.year,
                target.month
            );

            if (!monthReady) {
                console.error(
                    '[BOOKSY DATE] Could not navigate to target month:',
                    dateString
                );

                return false;
            }

            const dateElement = findBooksyDateElement(target.day);

            if (!dateElement) {
                console.error(
                    '[BOOKSY DATE] Target day not found:',
                    dateString
                );

                return false;
            }

            console.log(
                '[BOOKSY DATE] Clicking target date:',
                dateString,
                dateElement
            );

            dateElement.click();

            await new Promise(resolve => setTimeout(resolve, 500));

            console.log(
                '[BOOKSY DATE] Date click completed:',
                dateString
            );

            return true;

        } finally {
            dateSwitchInProgress = false;
        }
    }

    // ============================================================
    // REFRESH BOOKSY PAGE
    // ============================================================

    async function refreshCalendar() {
        console.log(
            "[BOOKSY SYNC] Refresh requested."
        );

        console.log(
            "[BOOKSY SYNC] We do NOT make direct calendar GET."
        );

        console.log(
            "[BOOKSY SYNC] Booksy itself must load the Week calendar."
        );

        try {
            window.location.reload();
            return true;
        } catch (error) {
            console.error(
                "[BOOKSY SYNC] Cannot reload Booksy:",
                error
            );
            return false;
        }
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

        const clientsById = new Map();
        const calendarBookings = lastCalendarWeekData?.bookings || {};

        Object.values(calendarBookings).forEach(function (booking) {
            const client = booking?.customer;
            if (client?.id && client?.name) {
                clientsById.set(String(client.id), {
                    id: client.id,
                    name: client.name,
                    phone: client.phone || ""
                });
            }
        });

        return {
            services: services,
            staffers: staffers,
            clients: Array.from(clientsById.values())
        };
    }

    // ============================================================
    // SYNC CATALOG TO ADMIN BACKEND
    // ============================================================

    let catalogSyncInProgress = false;

    async function syncBooksyCatalogToBackend() {
        if (catalogSyncInProgress) {
            console.log(
                "[BOOKSY CATALOG] Sync already in progress"
            );
            return false;
        }

        catalogSyncInProgress = true;

        try {
            console.log(
                "[BOOKSY CATALOG] Loading catalog for Admin..."
            );

            const catalog =
                await getBooksyCatalogForCreate();

            const payload = {
                staffers: catalog.staffers || [],
                services: catalog.services || [],
                clients: catalog.clients || [],
                received_at: new Date().toISOString()
            };

            console.log(
                "[BOOKSY CATALOG] Sending to backend:",
                {
                    staffers: payload.staffers.length,
                    services: payload.services.length,
                    clients: payload.clients.length
                }
            );

            const response = await fetch(
                "http://127.0.0.1:3000/api/booksy/catalog",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(payload)
                }
            );

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result?.error ||
                    `Backend HTTP ${response.status}`
                );
            }

            console.log(
                "[BOOKSY CATALOG] Backend sync successful:",
                result
            );

            return true;

        } catch (error) {

            console.error(
                "[BOOKSY CATALOG] Sync failed:",
                error
            );

            return false;

        } finally {
            catalogSyncInProgress = false;
        }
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
                client_id,
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
                // Booksy uses customer-card for an existing customer.  With no
                // selected client it must stay a walk-in appointment.
                customer: client_id
                    ? {
                        id: client_id,
                        mode: "customer-card"
                    }
                    : {
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
            const date = event.data.date;

            console.log(
                "[BOOKSY DATE] Fetch date command received:",
                date
            );

            if (!date) {
                console.warn(
                    "[BOOKSY DATE] Missing requested date"
                );
                return;
            }

            requestedCalendarDate = date;

            if (sendCachedCalendar(date)) {
                console.log(
                    "[BOOKSY CACHE] Served date from cache:",
                    date
                );
            }

            clickBooksyDate(date)
                .then(function (success) {
                    console.log(
                        "[BOOKSY DATE] Click result:",
                        date,
                        success
                    );
                })
                .catch(function (error) {
                    console.error(
                        "[BOOKSY DATE] Click failed:",
                        date,
                        error
                    );
                });

            return;
        }
    });

    // ============================================================
    // AUTOMATIC SYNC
    // ============================================================

    function startSync() {
        console.log(
            "[BOOKSY SYNC] Week synchronization mode started."
        );

        console.log(
            "[BOOKSY SYNC] Waiting for native Booksy Week calendar request."
        );

        // Каталог завантажуємо окремо після старту Booksy.
        setTimeout(function () {
            syncBooksyCatalogToBackend();
        }, 3000);
    }

    startSync();

    console.log(
        "[BOOKSY] Week calendar interception active"
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
