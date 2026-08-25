console.log("[ADMIN] Booksy Admin loaded");

const API_URL = "/api/booksy/calendar";

let selectedDate = new Date();

const currentDateElement =
    document.getElementById("currentDate");

const loadingElement =
    document.getElementById("loading");

const errorElement =
    document.getElementById("error");

const calendarElement =
    document.getElementById("calendar");

const staffHeadersElement =
    document.getElementById("staffHeaders");

const staffColumnsElement =
    document.getElementById("staffColumns");

const timeColumnElement =
    document.getElementById("timeColumn");

const statusDotElement =
    document.getElementById("statusDot");

const statusTextElement =
    document.getElementById("statusText");


// =========================================================
// DATE
// =========================================================

function formatDate(date) {
    return (
        date.getFullYear() +
        "-" +
        String(date.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(date.getDate()).padStart(2, "0")
    );
}


function formatHumanDate(date) {
    return new Intl.DateTimeFormat(
        "uk-UA",
        {
            day: "numeric",
            month: "long",
            year: "numeric"
        }
    ).format(date);
}


// =========================================================
// REQUEST BOOKSY DATE
// =========================================================

async function requestBooksyDate(date) {

    console.log(
        "[ADMIN] Requesting Booksy date:",
        date
    );

    try {

        const response =
            await fetch(
                "/api/booksy/request-date",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        date: date
                    })
                }
            );

        const data =
            await response.json();

        console.log(
            "[ADMIN] Booksy date request response:",
            data
        );

        if (!response.ok) {

            throw new Error(
                data.error ||
                `HTTP ${response.status}`
            );

        }

        return true;

    } catch (error) {

        console.error(
            "[ADMIN] Failed to request Booksy date:",
            error
        );

        return false;
    }
}


// =========================================================
// CHANGE DAY
// =========================================================

async function changeDay(amount) {

    selectedDate.setDate(
        selectedDate.getDate() + amount
    );

    const date =
        formatDate(selectedDate);

    currentDateElement.textContent =
        formatHumanDate(selectedDate);

    await requestBooksyDate(date);

    await loadCalendar();
}


// =========================================================
// TIME
// =========================================================

function timeToMinutes(time) {

    const parts =
        time.split(":");

    return (
        Number(parts[0]) * 60 +
        Number(parts[1])
    );
}


function formatTime(dateTime) {

    if (!dateTime) {
        return "";
    }

    return dateTime
        .split("T")[1]
        .slice(0, 5);
}


// =========================================================
// CREATE UI
// =========================================================

function createAppointmentButton() {

    if (
        document.getElementById(
            "createAppointmentButton"
        )
    ) {
        return;
    }

    const button =
        document.createElement("button");

    button.id =
        "createAppointmentButton";

    button.type =
        "button";

    button.textContent =
        "+ Запис";

    button.style.marginLeft =
        "10px";

    button.style.padding =
        "8px 14px";

    button.style.borderRadius =
        "8px";

    button.style.border =
        "1px solid #ccc";

    button.style.background =
        "#fff";

    button.style.cursor =
        "pointer";

    button.addEventListener(
        "click",
        openCreateAppointmentModal
    );

    const refreshButton =
        document.getElementById(
            "refreshButton"
        );

    if (refreshButton) {

        refreshButton.parentNode.insertBefore(
            button,
            refreshButton
        );

    }
}


// =========================================================
// CREATE MODAL
// =========================================================

function openCreateAppointmentModal() {

    if (
        document.getElementById(
            "createAppointmentModal"
        )
    ) {
        return;
    }

    const overlay =
        document.createElement("div");

    overlay.id =
        "createAppointmentModal";

    overlay.style.position =
        "fixed";

    overlay.style.inset =
        "0";

    overlay.style.background =
        "rgba(0,0,0,0.45)";

    overlay.style.display =
        "flex";

    overlay.style.alignItems =
        "center";

    overlay.style.justifyContent =
        "center";

    overlay.style.zIndex =
        "99999";


    const modal =
        document.createElement("div");

    modal.style.background =
        "#fff";

    modal.style.width =
        "420px";

    modal.style.maxWidth =
        "calc(100vw - 40px)";

    modal.style.borderRadius =
        "14px";

    modal.style.padding =
        "24px";

    modal.style.boxShadow =
        "0 20px 60px rgba(0,0,0,.2)";


    modal.innerHTML = `
        <h2 style="margin:0 0 20px">
            Новий запис
        </h2>

        <label style="display:block;margin-bottom:6px">
            Дата
        </label>

        <input
            id="createDate"
            type="date"
            value="${formatDate(selectedDate)}"
            style="width:100%;box-sizing:border-box;margin-bottom:14px;padding:10px"
        >

        <label style="display:block;margin-bottom:6px">
            Час початку
        </label>

        <input
            id="createStart"
            type="time"
            value="10:00"
            style="width:100%;box-sizing:border-box;margin-bottom:14px;padding:10px"
        >

        <label style="display:block;margin-bottom:6px">
            Час закінчення
        </label>

        <input
            id="createEnd"
            type="time"
            value="10:30"
            style="width:100%;box-sizing:border-box;margin-bottom:14px;padding:10px"
        >

        <label style="display:block;margin-bottom:6px">
            Працівник
        </label>

        <input
            id="createStafferId"
            type="text"
            placeholder="staffer_id"
            style="width:100%;box-sizing:border-box;margin-bottom:14px;padding:10px"
        >

        <label style="display:block;margin-bottom:6px">
            ID послуги
        </label>

        <input
            id="createVariantId"
            type="text"
            placeholder="service variant id"
            style="width:100%;box-sizing:border-box;margin-bottom:14px;padding:10px"
        >

        <label style="display:block;margin-bottom:6px">
            ID клієнта
        </label>

        <input
            id="createClientId"
            type="text"
            placeholder="client id"
            style="width:100%;box-sizing:border-box;margin-bottom:14px;padding:10px"
        >

        <label style="display:block;margin-bottom:6px">
            Примітка
        </label>

        <textarea
            id="createNote"
            placeholder="Примітка"
            style="width:100%;box-sizing:border-box;margin-bottom:18px;padding:10px;min-height:70px"
        ></textarea>

        <div
            id="createAppointmentError"
            style="display:none;color:#c00;margin-bottom:12px"
        ></div>

        <div style="display:flex;gap:10px;justify-content:flex-end">

            <button
                id="createCancel"
                type="button"
                style="padding:10px 16px"
            >
                Скасувати
            </button>

            <button
                id="createSubmit"
                type="button"
                style="padding:10px 16px"
            >
                Створити
            </button>

        </div>
    `;


    overlay.appendChild(modal);

    document.body.appendChild(overlay);


    document
        .getElementById("createCancel")
        .addEventListener(
            "click",
            () => overlay.remove()
        );


    document
        .getElementById("createSubmit")
        .addEventListener(
            "click",
            submitCreateAppointment
        );
}


// =========================================================
// CREATE APPOINTMENT
// =========================================================

async function submitCreateAppointment() {

    const date =
        document.getElementById(
            "createDate"
        ).value;

    const start =
        document.getElementById(
            "createStart"
        ).value;

    const end =
        document.getElementById(
            "createEnd"
        ).value;

    const stafferId =
        document.getElementById(
            "createStafferId"
        ).value.trim();

    const variantId =
        document.getElementById(
            "createVariantId"
        ).value.trim();

    const clientId =
        document.getElementById(
            "createClientId"
        ).value.trim();

    const note =
        document.getElementById(
            "createNote"
        ).value;


    const errorElement =
        document.getElementById(
            "createAppointmentError"
        );

    const submitButton =
        document.getElementById(
            "createSubmit"
        );


    errorElement.style.display =
        "none";


    if (
        !date ||
        !start ||
        !end ||
        !stafferId ||
        !variantId ||
        !clientId
    ) {

        errorElement.textContent =
            "Заповни всі обов'язкові поля.";

        errorElement.style.display =
            "block";

        return;
    }


    submitButton.disabled =
        true;

    submitButton.textContent =
        "Створення...";


    try {

        const response =
            await fetch(
                "/api/booksy/create-appointment",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        date:
                            date,

                        start:
                            start,

                        end:
                            end,

                        staffer_id:
                            stafferId,

                        variant_id:
                            variantId,

                        client_id:
                            clientId,

                        business_secret_note:
                            note

                    })
                }
            );


        const data =
            await response.json();


        console.log(
            "[ADMIN] Create appointment response:",
            data
        );


        if (!response.ok || !data.ok) {

            throw new Error(
                data.error ||
                `HTTP ${response.status}`
            );

        }


        document
            .getElementById(
                "createAppointmentModal"
            )
            .remove();


        /*
         * Якщо створення відбулося
         * на іншій даті — переключаємо
         * адмінку на неї.
         */

        const targetDate =
            new Date(
                date + "T00:00:00"
            );


        selectedDate =
            targetDate;


        currentDateElement.textContent =
            formatHumanDate(
                selectedDate
            );


        await requestBooksyDate(
            date
        );


        await loadCalendar();


        alert(
            "Запис успішно створено"
        );


    } catch (error) {

        console.error(
            "[ADMIN] Create appointment error:",
            error
        );


        errorElement.textContent =
            error.message;


        errorElement.style.display =
            "block";


        submitButton.disabled =
            false;

        submitButton.textContent =
            "Створити";

    }

}


// =========================================================
// FETCH CALENDAR
// =========================================================

async function loadCalendar() {

    const date =
        formatDate(selectedDate);


    currentDateElement.textContent =
        formatHumanDate(selectedDate);


    loadingElement.classList.remove(
        "hidden"
    );

    errorElement.classList.add(
        "hidden"
    );

    calendarElement.classList.add(
        "hidden"
    );


    try {

        console.log(
            "[ADMIN] Loading calendar:",
            date
        );


        const response =
            await fetch(
                `${API_URL}?date=${encodeURIComponent(date)}`,
                {
                    cache:
                        "no-store"
                }
            );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );

        }


        const data =
            await response.json();


        console.log(
            "[ADMIN] Calendar response:",
            data
        );


        if (!data.ok) {

            throw new Error(
                data.error ||
                "Backend returned error"
            );

        }


        if (data.calendar) {

            renderCalendar(
                data.calendar
            );

            setOnline();

            return;
        }


        if (data.requested) {

            renderEmpty();

            setOnline();

            return;
        }


        renderEmpty();

        setOnline();


    } catch (error) {

        console.error(
            "[ADMIN] Calendar error:",
            error
        );


        showError(
            error.message
        );

        setOffline();


    } finally {

        loadingElement.classList.add(
            "hidden"
        );

    }

}


// =========================================================
// STATUS
// =========================================================

function setOnline() {

    statusDotElement.className =
        "status-dot online";

    statusTextElement.textContent =
        "Backend підключений";
}


function setOffline() {

    statusDotElement.className =
        "status-dot error";

    statusTextElement.textContent =
        "Backend недоступний";
}


// =========================================================
// ERROR
// =========================================================

function showError(message) {

    errorElement.textContent =
        `Помилка: ${message}`;

    errorElement.classList.remove(
        "hidden"
    );
}


// =========================================================
// RENDER CALENDAR
// =========================================================

function renderCalendar(calendar) {

    const bookings =
        calendar.bookings || {};

    const resources =
        calendar.resources || [];


    staffHeadersElement.innerHTML =
        "";

    staffColumnsElement.innerHTML =
        "";

    timeColumnElement.innerHTML =
        "";


    const startHour =
        10;

    const endHour =
        19;


    for (
        let hour = startHour;
        hour <= endHour;
        hour++
    ) {

        const slot =
            document.createElement(
                "div"
            );

        slot.className =
            "time-slot";

        slot.textContent =
            `${String(hour).padStart(2, "0")}:00`;

        timeColumnElement.appendChild(
            slot
        );

    }


    resources.forEach(
        resource => {

            const header =
                document.createElement(
                    "div"
                );

            header.className =
                "staff-header";


            const name =
                document.createElement(
                    "div"
                );

            name.className =
                "staff-name";

            name.textContent =
                resource.name;


            const hours =
                document.createElement(
                    "div"
                );

            hours.className =
                "staff-hours";


            const workingHours =
                resource.working_hours?.[
                    calendar.start_date
                ] || [];


            if (workingHours.length) {

                hours.textContent =
                    `${workingHours[0].hour_from}–${workingHours[0].hour_till}`;

            } else {

                hours.textContent =
                    "Немає робочих годин";

            }


            header.appendChild(
                name
            );

            header.appendChild(
                hours
            );

            staffHeadersElement.appendChild(
                header
            );


            const column =
                document.createElement(
                    "div"
                );

            column.className =
                "staff-column";


            const bookingIds =
                resource.bookings?.[
                    calendar.start_date
                ] || [];


            bookingIds.forEach(
                bookingId => {

                    const booking =
                        bookings[bookingId];


                    if (!booking) {
                        return;
                    }


                    renderBooking(
                        column,
                        booking,
                        startHour
                    );

                }
            );


            staffColumnsElement.appendChild(
                column
            );

        }
    );


    calendarElement.classList.remove(
        "hidden"
    );

}


// =========================================================
// BOOKING
// =========================================================

function renderBooking(
    column,
    booking,
    startHour
) {

    const from =
        formatTime(
            booking.booked_from
        );

    const till =
        formatTime(
            booking.booked_till
        );


    const fromMinutes =
        timeToMinutes(from);

    const startMinutes =
        startHour * 60;


    const top =
        fromMinutes -
        startMinutes;


    const duration =
        timeToMinutes(till) -
        fromMinutes;


    const bookingElement =
        document.createElement(
            "div"
        );

    bookingElement.className =
        "booking";


    bookingElement.style.top =
        `${top}px`;

    bookingElement.style.height =
        `${Math.max(duration, 45)}px`;


    const time =
        document.createElement(
            "div"
        );

    time.className =
        "booking-time";

    time.textContent =
        `${from} – ${till}`;


    const customer =
        document.createElement(
            "div"
        );

    customer.className =
        "booking-customer";

    customer.textContent =
        booking.customer?.name ||
        "Без імені";


    const service =
        document.createElement(
            "div"
        );

    service.className =
        "booking-service";

    service.textContent =
        booking.service?.name ||
        "Послуга";


    bookingElement.appendChild(
        time
    );

    bookingElement.appendChild(
        customer
    );

    bookingElement.appendChild(
        service
    );


    bookingElement.addEventListener(
        "click",
        () => {

            console.log(
                "[ADMIN] Booking clicked:",
                booking
            );

        }
    );


    column.appendChild(
        bookingElement
    );

}


// =========================================================
// EMPTY
// =========================================================

function renderEmpty() {

    staffHeadersElement.innerHTML =
        "";

    staffColumnsElement.innerHTML =
        "";

    timeColumnElement.innerHTML =
        "";


    const empty =
        document.createElement(
            "div"
        );

    empty.className =
        "empty-day";

    empty.textContent =
        "Календар поки порожній";


    staffColumnsElement.appendChild(
        empty
    );


    calendarElement.classList.remove(
        "hidden"
    );

}


// =========================================================
// REALTIME
// =========================================================

function startRealtimeSync() {

    console.log(
        "[ADMIN] Starting realtime sync..."
    );


    const events =
        new EventSource(
            "/api/booksy/events"
        );


    events.onopen =
        function () {

            console.log(
                "[ADMIN] Realtime connection established"
            );

        };


    events.onmessage =
        function (event) {

            try {

                const message =
                    JSON.parse(
                        event.data
                    );


                console.log(
                    "[ADMIN] Realtime event:",
                    message
                );


                if (
                    message.type !==
                    "CALENDAR_UPDATED"
                ) {

                    return;

                }


                const updatedDate =
                    message.date;


                const currentDate =
                    formatDate(
                        selectedDate
                    );


                if (
                    updatedDate ===
                    currentDate
                ) {

                    loadCalendar();

                }


            } catch (error) {

                console.error(
                    "[ADMIN] Realtime event parse error:",
                    error
                );

            }

        };


    events.onerror =
        function () {

            console.warn(
                "[ADMIN] Realtime connection lost. Browser will retry automatically."
            );

        };

}


// =========================================================
// EVENTS
// =========================================================

document
    .getElementById("prevDay")
    .addEventListener(
        "click",
        () => changeDay(-1)
    );


document
    .getElementById("nextDay")
    .addEventListener(
        "click",
        () => changeDay(1)
    );


document
    .getElementById("refreshButton")
    .addEventListener(
        "click",
        loadCalendar
    );


// =========================================================
// START
// =========================================================

createAppointmentButton();

startRealtimeSync();

loadCalendar();