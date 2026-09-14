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

let pendingBooksyRefresh = null;
let refreshRequestCounter = 0;

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
                ok: true,
                calendar: null
            });
        }

        const startDate = latestCalendar.start_date;
        const endDate = latestCalendar.end_date;
        const requestedDateIsInWeek = !requestedDate ||
            (startDate && endDate && requestedDate >= startDate && requestedDate <= endDate);

        if (!requestedDateIsInWeek) {
            return res.json({
                ok: true,
                calendar: null,
                available_range: { start_date: startDate, end_date: endDate }
            });
        }

        res.json({

            ok: true,

            calendar:
                latestCalendar.calendar,

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
        requested_at: new Date().toISOString()
    };

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
        pendingBooksyRefresh = null;
    }
    res.json({ ok: true });
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
            business_secret_note
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


        res.json({

            ok: true,

            request_id: id,

            status:
                "pending"

        });

    }
);


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

            broadcastCalendarUpdate(
                result.date || null
            );

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
