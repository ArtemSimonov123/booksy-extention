const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

const PORT = 3000;


// =====================================================
// MIDDLEWARE
// =====================================================

app.use(cors());

app.use(
    express.json({
        limit: "10mb"
    })
);


// =====================================================
// ADMIN FRONTEND
// =====================================================

const adminPath = path.join(
    __dirname,
    "..",
    "admin"
);

console.log(
    "[BACKEND] Admin path:",
    adminPath
);


// -----------------------------------------------------
// /admin/...
// -----------------------------------------------------

app.use(
    "/admin",
    express.static(adminPath)
);


// -----------------------------------------------------
// Static files from root too
// -----------------------------------------------------

app.use(
    express.static(adminPath)
);


// =====================================================
// BOOKSY CALENDAR STORAGE
// =====================================================

let latestCalendar = null;
// IDs of subbookings created through this admin. Booksy uses the same type B
// for all business-side bookings, so type alone cannot identify our admin.
const adminCreatedBookingIds = new Set();
// Local cards are shown immediately after an admin submits creation. They are
// replaced by the real Booksy booking as soon as it arrives in calendar sync.
const pendingAdminBookings = new Map();

let pendingBooksyRefresh = null;
let refreshRequestCounter = 0;
const refreshLogs = [];
const appointmentLogs = [];

// =====================================================
// BOOKSY CATALOG STORAGE
// =====================================================
//
// Дані приходять з Booksy через extension.
// Admin читає їх через GET /api/booksy/catalog.
//
let latestBooksyCatalog = {
    staffers: [],
    services: [],
    clients: [],
    received_at: null
};


// =====================================================
// PENDING BOOKSY DATE REQUEST
// =====================================================

let requestedBooksyDate = null;


// =====================================================
// REALTIME CLIENTS
// =====================================================

const realtimeClients = new Set();

function broadcastRefreshLog(entry) {
    const message = JSON.stringify({ type: "REFRESH_LOG", entry });
    for (const client of realtimeClients) {
        try {
            client.write(`data: ${message}\n\n`);
        } catch (error) {
            realtimeClients.delete(client);
        }
    }
}

function addRefreshLog(stage, message, requestId = null) {
    const entry = {
        id: Date.now() + Math.random(),
        at: new Date().toISOString(),
        request_id: requestId,
        stage,
        message
    };

    refreshLogs.unshift(entry);
    refreshLogs.splice(50);
    console.log(`[REFRESH ${stage}] ${message}`);
    broadcastRefreshLog(entry);
    return entry;
}

function broadcastAppointmentLog(entry) {
    const message = JSON.stringify({ type: "APPOINTMENT_LOG", entry });
    for (const client of realtimeClients) {
        try {
            client.write(`data: ${message}\n\n`);
        } catch (error) {
            realtimeClients.delete(client);
        }
    }
}

function addAppointmentLog(stage, message, requestId = null) {
    const entry = {
        id: Date.now() + Math.random(),
        at: new Date().toISOString(),
        request_id: requestId,
        stage,
        message
    };
    appointmentLogs.unshift(entry);
    appointmentLogs.splice(50);
    console.log(`[CREATE ${stage}] ${message}`);
    broadcastAppointmentLog(entry);
    return entry;
}


// =====================================================
// BROADCAST UPDATE
// =====================================================

function broadcastCalendarUpdate(calendarRange) {

    const message = JSON.stringify({
        type: "CALENDAR_UPDATED",

        week_start: calendarRange?.start_date || null,
        week_end: calendarRange?.end_date || null,

        received_at:
            latestCalendar?.received_at ||
            new Date().toISOString()
    });


    for (const client of realtimeClients) {

        try {

            client.write(
                `data: ${message}\n\n`
            );

        } catch (error) {

            realtimeClients.delete(client);

        }

    }

}


// =====================================================
// REQUEST BOOKSY DATE FROM ADMIN
// =====================================================

app.post(
    "/api/booksy/request-date",
    (req, res) => {

        const date =
            req.body?.date;


        console.log(
            "[BACKEND] Booksy date requested:",
            date
        );


        if (
            !date ||
            !/^\d{4}-\d{2}-\d{2}$/.test(date)
        ) {

            return res.status(400).json({

                ok: false,

                error:
                    "Invalid date. Expected YYYY-MM-DD"

            });

        }


        requestedBooksyDate = date;


        res.json({

            ok: true,

            requested: true,

            date: date

        });

    }
);


// =====================================================
// GET PENDING BOOKSY DATE REQUEST
// =====================================================

app.get(
    "/api/booksy/request-date",
    (req, res) => {

        res.set(
            "Cache-Control",
            "no-store"
        );


        if (!requestedBooksyDate) {

            return res.json({

                ok: true,

                requested: false,

                date: null

            });

        }


        res.json({

            ok: true,

            requested: true,

            date: requestedBooksyDate

        });

    }
);


// =====================================================
// GET CALENDAR
// =====================================================

app.get(
    "/api/booksy/calendar",
    (req, res) => {

        const requestedDate =
            req.query?.date || null;


        console.log(
            "[BACKEND] GET /api/booksy/calendar",
            requestedDate
                ? `date=${requestedDate}`
                : ""
        );


        res.set(
            "Cache-Control",
            "no-store"
        );


        if (!latestCalendar) {
            return res.json({
                ok: true,
                calendar: null
            });
        }

        const startDate = latestCalendar.start_date;
        const endDate = latestCalendar.end_date;
        const requestedDateIsInRange = !requestedDate ||
            (startDate && endDate && requestedDate >= startDate && requestedDate <= endDate);

        if (!requestedDateIsInRange) {
            return res.json({
                ok: true,
                calendar: null,
                available_range: { start_date: startDate, end_date: endDate }
            });
        }

        const calendar = latestCalendar.calendar;
        const bookings = calendar.bookings || {};
        const displayedResources = (calendar.resources || []).map(resource => ({
            ...resource,
            bookings: { ...(resource.bookings || {}) }
        }));
        const resourcesById = new Map(
            displayedResources.map(resource => [String(resource.id), resource])
        );
        const displayedBookings = Object.fromEntries(
            Object.entries(bookings).map(([id, booking]) => [
                id,
                {
                    ...booking,
                    _created_in_admin: adminCreatedBookingIds.has(String(id))
                }
            ])
        );

        for (const pending of pendingAdminBookings.values()) {
            const bookingId = pending.id;
            displayedBookings[bookingId] = pending.booking;

            let resource = resourcesById.get(String(pending.staffer_id));
            if (!resource) {
                resource = {
                    id: pending.staffer_id,
                    name: pending.staffer_name,
                    type: "S",
                    visible_on_calendar: true,
                    working_hours: {},
                    bookings: {}
                };
                displayedResources.push(resource);
                resourcesById.set(String(resource.id), resource);
            }

            if (!resource.bookings[pending.date]) {
                resource.bookings[pending.date] = [];
            }
            resource.bookings[pending.date].push(bookingId);
        }

        const markedCalendar = {
            ...calendar,
            resources: displayedResources,
            bookings: displayedBookings
        };

        res.json({

            ok: true,

            calendar:
                markedCalendar,

            start_date: startDate,

            end_date: endDate,

            received_at:
                latestCalendar.received_at

        });

    }
);


// =====================================================
// REQUEST A NATIVE BOOKSY PAGE RELOAD
// =====================================================

app.post("/api/booksy/refresh", (req, res) => {
    const id = ++refreshRequestCounter;
    pendingBooksyRefresh = {
        id,
        requested_at: new Date().toISOString(),
        status: "queued"
    };
    addRefreshLog("queued", "Команду оновлення створено в адмінці.", id);

    setTimeout(() => {
        if (pendingBooksyRefresh?.id === id) {
            addRefreshLog("timeout", "Календар не надійшов протягом 45 секунд після команди.", id);
            pendingBooksyRefresh = null;
        }
    }, 45000);

    res.json({ ok: true, requested: true, request_id: id });
});

app.get("/api/booksy/refresh", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
        ok: true,
        requested: Boolean(pendingBooksyRefresh),
        request: pendingBooksyRefresh
    });
});

app.post("/api/booksy/refresh/ack", (req, res) => {
    if (pendingBooksyRefresh && Number(req.body?.request_id) === pendingBooksyRefresh.id) {
        pendingBooksyRefresh.status = "reload_sent";
        addRefreshLog("reload_sent", "Розширення передало Chrome команду перезавантаження вкладки календаря.", pendingBooksyRefresh.id);
    }
    res.json({ ok: true });
});

app.post("/api/booksy/refresh/log", (req, res) => {
    const { request_id: requestId, stage, message } = req.body || {};
    addRefreshLog(stage || "extension", message || "Подія від розширення.", requestId || null);
    res.json({ ok: true });
});

app.get("/api/booksy/refresh/log", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, pending: pendingBooksyRefresh, entries: refreshLogs });
});

// =====================================================
// SSE REALTIME
// =====================================================

app.get(
    "/api/booksy/events",
    (req, res) => {

        console.log(
            "[BACKEND] SSE client connected"
        );


        res.setHeader(
            "Content-Type",
            "text/event-stream"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache, no-store, must-revalidate"
        );

        res.setHeader(
            "Connection",
            "keep-alive"
        );


        res.flushHeaders();


        realtimeClients.add(res);


        res.write(
            `data: ${JSON.stringify({
                type: "CONNECTED"
            })}\n\n`
        );


        const heartbeat =
            setInterval(
                () => {

                    try {

                        res.write(
                            ": heartbeat\n\n"
                        );

                    } catch (error) {

                        clearInterval(
                            heartbeat
                        );

                    }

                },
                20000
            );


        req.on(
            "close",
            () => {

                console.log(
                    "[BACKEND] SSE client disconnected"
                );


                clearInterval(
                    heartbeat
                );


                realtimeClients.delete(
                    res
                );

            }
        );

    }
);


// =====================================================
// RECEIVE CALENDAR FROM EXTENSION
// =====================================================

app.post(
    "/api/booksy/calendar",
    (req, res) => {

        console.log(
            "[BACKEND] Calendar received"
        );


        if (
            !req.body ||
            !req.body.calendar
        ) {

            console.log(
                "[BACKEND] Calendar data is missing"
            );


            return res.status(400).json({

                ok: false,

                error:
                    "Calendar data is missing"

            });

        }


        const sourceUrl =
            req.body.url || "";


        let startDate =
            req.body.start_date || req.body.date || null;

        let endDate =
            req.body.end_date || startDate;


        // -------------------------------------------------
        // TRY TO GET DATE FROM BOOKSY URL
        // -------------------------------------------------

        if ((!startDate || !endDate) && sourceUrl) {

            try {

                const parsed =
                    new URL(sourceUrl);


                startDate = startDate || parsed.searchParams.get("start_date") || parsed.searchParams.get("st_nd_date") || null;
                endDate = endDate || parsed.searchParams.get("end_date") || startDate;

            } catch (error) {

                console.warn(
                    "[BACKEND] Cannot parse calendar URL:",
                    error
                );

            }

        }


        latestCalendar = {

            received_at:
                req.body.received_at ||
                new Date().toISOString(),

            source:
                req.body.source ||
                "booksy-extension",

            start_date: startDate,

            end_date: endDate,

            url: sourceUrl,

            calendar:
                req.body.calendar

        };


        const bookings =
            req.body.calendar.bookings ||
            {};

        for (const [requestId, pending] of pendingAdminBookings) {
            const createdIds = pending.created_booking_ids || [];
            if (createdIds.some(id => Object.prototype.hasOwnProperty.call(bookings, String(id)))) {
                pendingAdminBookings.delete(requestId);
            }
        }


        const bookingsCount =
            Object.keys(bookings).length;


        console.log(
            "[BACKEND] Calendar range:",
            startDate,
            "→",
            endDate
        );


        console.log(
            "[BACKEND] Bookings:",
            bookingsCount
        );

        if (pendingBooksyRefresh) {
            addRefreshLog(
                "calendar_received",
                "Booksy повторно завантажив календар; нові дані отримано бекендом.",
                pendingBooksyRefresh.id
            );
            pendingBooksyRefresh = null;
        }


        broadcastCalendarUpdate(
            latestCalendar
        );


        res.json({

            ok: true,

            start_date: startDate,

            end_date: endDate,

            bookings_count:
                bookingsCount

        });

    }
);


// =====================================================
// BOOKSY CATALOG
// =====================================================

// -----------------------------------------------------
// GET CATALOG FOR ADMIN
// -----------------------------------------------------

app.get(
    "/api/booksy/catalog",
    (req, res) => {

        res.set(
            "Cache-Control",
            "no-store"
        );

        res.json({
            ok: true,

            staffers:
                latestBooksyCatalog.staffers,

            services:
                latestBooksyCatalog.services,

            clients:
                latestBooksyCatalog.clients,

            received_at:
                latestBooksyCatalog.received_at
        });

    }
);

// -----------------------------------------------------
// RECEIVE CATALOG FROM EXTENSION
// -----------------------------------------------------

app.post(
    "/api/booksy/catalog",
    (req, res) => {

        const body =
            req.body || {};


        const staffers =
            Array.isArray(body.staffers)
                ? body.staffers
                : [];


        const services =
            Array.isArray(body.services)
                ? body.services
                : [];


        const clients =
            Array.isArray(body.clients)
                ? body.clients
                : [];


        latestBooksyCatalog = {

            staffers,

            services,

            clients,

            received_at:
                body.received_at ||
                new Date().toISOString()

        };


        console.log(
            "[BACKEND] Booksy catalog received:",
            {
                staffers:
                    staffers.length,

                services:
                    services.length,

                clients:
                    clients.length
            }
        );


        res.json({

            ok: true,

            staffers:
                staffers.length,

            services:
                services.length,

            clients:
                clients.length

        });

    }
);


// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
    "/api/health",
    (req, res) => {

        res.json({

            ok: true,

            service:
                "booksy-backend"

        });

    }
);


// =====================================================
// ADMIN ROOT
// =====================================================

// Старий маршрут:
// http://localhost:3000/

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                adminPath,
                "index.html"
            )
        );

    }
);


// =====================================================
// ADMIN ROUTE
// =====================================================

// Повертаємо старий маршрут:
// http://localhost:3000/admin

app.get(
    "/admin",
    (req, res) => {

        res.sendFile(
            path.join(
                adminPath,
                "index.html"
            )
        );

    }
);


// =====================================================
// ADMIN ROUTE WITH SLASH
// =====================================================

app.get(
    "/admin/",
    (req, res) => {

        res.sendFile(
            path.join(
                adminPath,
                "index.html"
            )
        );

    }
);

// =====================================================
// CREATE BOOKSY APPOINTMENT
// =====================================================

let pendingAppointmentRequest = null;

let appointmentRequestCounter = 0;


// ADMIN -> EXTENSION

app.post(
    "/api/booksy/create-appointment",
    (req, res) => {

        console.log(
            "[BACKEND] Create appointment requested:",
            req.body
        );


        const {
            date,
            start,
            end,
            staffer_id,
            variant_id,
            client_id,
            business_secret_note,
            staffer_name,
            service_name,
            client_name
        } = req.body || {};


        if (
            !date ||
            !start ||
            !end ||
            !staffer_id ||
            !variant_id
        ) {

            return res.status(400).json({

                ok: false,

                error:
                    "date, start, end, staffer_id and variant_id are required"

            });

        }


        const id =
            ++appointmentRequestCounter;


        pendingAppointmentRequest = {

            id,

            created_at:
                new Date().toISOString(),

            status:
                "pending",

            date,

            start,

            end,

            staffer_id,

            variant_id,

            client_id,

            business_secret_note:
                business_secret_note || null

        };

        const optimisticBookingId = `pending-admin-${id}`;
        pendingAdminBookings.set(String(id), {
            id: optimisticBookingId,
            date,
            staffer_id,
            staffer_name: staffer_name || "Працівник",
            booking: {
                id: optimisticBookingId,
                booked_from: `${date}T${start}`,
                booked_till: `${date}T${end}`,
                customer: {
                    id: client_id || null,
                    name: client_name || "Без імені"
                },
                service: {
                    id: variant_id,
                    name: service_name || "Послуга"
                },
                resources: [{
                    id: staffer_id,
                    name: staffer_name || "Працівник",
                    type: "S"
                }],
                type: "B",
                status: "A",
                _created_in_admin: true,
                _creation_status: "creating"
            }
        });

        addAppointmentLog("queued", "Запит на створення запису створено в адмінці.", id);

        setTimeout(() => {
            if (pendingAppointmentRequest?.id === id) {
                addAppointmentLog("timeout", "Booksy не підтвердив створення запису протягом 60 секунд.", id);
                pendingAppointmentRequest = null;
            }
        }, 60000);


        res.json({

            ok: true,

            request_id: id,

            status:
                "pending"

        });

    }
);

app.post("/api/booksy/create-appointment/ack", (req, res) => {
    if (pendingAppointmentRequest && Number(req.body?.request_id) === pendingAppointmentRequest.id) {
        pendingAppointmentRequest.status = "delivered";
        addAppointmentLog("delivered", "Розширення передало команду у вкладку календаря Booksy.", pendingAppointmentRequest.id);
    }
    res.json({ ok: true });
});

app.post("/api/booksy/create-appointment/log", (req, res) => {
    const { request_id: requestId, stage, message } = req.body || {};
    addAppointmentLog(stage || "extension", message || "Подія від розширення.", requestId || null);
    res.json({ ok: true });
});

app.get("/api/booksy/create-appointment/log", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, pending: pendingAppointmentRequest, entries: appointmentLogs });
});


// EXTENSION -> GET COMMAND

app.get(
    "/api/booksy/create-appointment",
    (req, res) => {

        res.set(
            "Cache-Control",
            "no-store"
        );


        if (
            !pendingAppointmentRequest
        ) {

            return res.json({

                ok: true,

                requested: false

            });

        }


        if (
            pendingAppointmentRequest.status !==
            "pending"
        ) {

            return res.json({

                ok: true,

                requested: false

            });

        }


        res.json({

            ok: true,

            requested: true,

            request:
                pendingAppointmentRequest

        });

    }
);


// EXTENSION -> RESULT

app.post(
    "/api/booksy/create-appointment/result",
    (req, res) => {

        const result =
            req.body || {};


        console.log(
            "[BACKEND] Create appointment result:",
            result
        );


        if (
            pendingAppointmentRequest &&
            result.request_id ===
                pendingAppointmentRequest.id
        ) {

            pendingAppointmentRequest =
                null;

        }


        if (
            result.ok
        ) {

            addAppointmentLog("created", "Booksy успішно створив запис.", result.request_id || null);

            for (const bookingId of result.created_booking_ids || []) {
                adminCreatedBookingIds.add(String(bookingId));
            }

            const pending = pendingAdminBookings.get(String(result.request_id));
            if (pending) {
                pending.created_booking_ids = result.created_booking_ids || [];
                pending.booking._creation_status = "created";
            }

            console.log(
                "[BACKEND] Marked admin-created bookings:",
                result.created_booking_ids || []
            );

            broadcastCalendarUpdate(
                result.date || null
            );

        }
        else {
            pendingAdminBookings.delete(String(result.request_id));
            addAppointmentLog("failed", result.error || "Booksy не створив запис.", result.request_id || null);
        }


        res.json({

            ok: true

        });

    }
);

// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    () => {

        console.log(
            `Booksy backend running on http://localhost:${PORT}`
        );

        console.log(
            `Booksy Admin: http://localhost:${PORT}/admin`
        );

        console.log(
            `Booksy Admin root: http://localhost:${PORT}/`
        );

    }
);
