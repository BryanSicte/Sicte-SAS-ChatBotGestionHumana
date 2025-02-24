require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();
const PORT = 3000;
app.use(express.json());
const mysql = require("mysql2/promise");

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

let ciudadesCache = []

async function obtenerCiudades() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log("✅ Conexión exitosa a MySQL");
        const [rows] = await connection.execute("select * from ciudad_cargos");
        const ciudadesFiltradas = rows.filter(c => c.estado === "true");

        await connection.end();
        ciudadesCache = ciudadesFiltradas;
        return ciudadesCache;
    } catch (error) {
        console.error("❌ Error conectando a MySQL:", error);
        return "Error: " + error.message;
    }
}

// Nuevo endpoint para probar conexión desde el navegador
app.get("/test-db", async (req, res) => {
    const resultado = await obtenerCiudades();
    res.send(resultado);
});

const userStates = {};
const userTimers = {};

// Webhook para recibir mensajes
app.post("/webhook", async (req, res) => {
    console.log("📩 Webhook recibido:", JSON.stringify(req.body, null, 2));

    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
        const from = message.from;
        let text = message.text?.body || "Mensaje vacío";

        console.log(`📩 Mensaje recibido de ${from}: ${text}`);

        restartUserTimer(from);

        let hoy = new Date();
        let diaSemana = hoy.getDay();

        function obtenerDiaHabil(diaActual, diasSumar) {
            let nuevoDia = new Date(hoy);
            nuevoDia.setDate(hoy.getDate() + diasSumar);

            if (nuevoDia.getDay() === 0) {
                nuevoDia.setDate(nuevoDia.getDate() + 1);
            } else if (nuevoDia.getDay() === 6) {
                nuevoDia.setDate(nuevoDia.getDate() + 2);
            }

            return nuevoDia;
        }

        let diaMañana = obtenerDiaHabil(diaSemana, 1);
        let diaPasadoMañana = obtenerDiaHabil(diaSemana, 2);

        let opcionesFecha = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        let fechaMañana = diaMañana.toLocaleDateString('es-ES', opcionesFecha);
        let fechaPasadoMañana = diaPasadoMañana.toLocaleDateString('es-ES', opcionesFecha);

        if (!userStates[from]) {
            userStates[from] = { stage: "esperando_nombreApellido", data: {} };

            await sendMessage(from, "👋 ¡Bienvenido! Por favor, ingrese su(s) nombre(s) y apellidos para continuar:");
        } else if (userStates[from].stage === "esperando_nombreApellido") {

            if (/^[a-zA-ZÀ-ÿ]+(\s[a-zA-ZÀ-ÿ]+){1,49}$/.test(text)) {
                userStates[from].data.nombreApellido = text;
                userStates[from].stage = "esperando_celular";

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                const userInfo = `
                    🔹 ${nombreFormateado} por favor ingresa tu numero de celular para continuar:
                `;

                await sendMessage(from, userInfo);
            } else {
                await sendMessage(from, "⚠️ El nombre ingresado no es válido. Por favor, ingrésalo nuevamente.");
            }

        } else if (userStates[from].stage === "esperando_celular") {
            const ciudades = await obtenerCiudades();

            const ciudadesUnicas = [...new Set(ciudades.map(c => c.Ciudad))].sort();

            const numerosIconos = ["➊", "➋", "➌", "➍", "➎", "➏", "➐", "➑", "➒", "➓"];
            const opcionesCiudades = ciudadesUnicas
                .map((ciudad, index) => `\n ${numerosIconos[index] || index + 1} ${ciudad}`)
                .join("");

            if (/^\d{10}$/.test(text)) {
                userStates[from].data.celular = text;
                userStates[from].stage = "esperando_ciudad";

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                const userInfo = `
                    🔹 ${nombreFormateado} requerimos saber de que ciudad nos contactas para mostrarte los cargos que tenemos ofertados, por favor ingresa el numero de la ciudad de la cual nos contactas:
                    \n${opcionesCiudades}
                `;

                await sendMessage(from, userInfo);
            } else {
                await sendMessage(from, "⚠️ El numero de celular ingresado no es válido. Asegúrate de escribir 10 numeros.");
            }
        } else if (userStates[from].stage === "esperando_ciudad") {

            const ciudadesUnicas = [...new Set(ciudadesCache.map(c => c.Ciudad))].sort();

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado >= 1 && numeroIngresado <= ciudadesUnicas.length) {
                const ciudadSeleccionada = ciudadesUnicas[numeroIngresado - 1];

                const cargosDisponibles = ciudadesCache
                    .filter(c => c.Ciudad === ciudadSeleccionada)
                    .map(c => c.Cargo);

                const cargosUnicos = [...new Set(cargosDisponibles)].sort();

                const numerosIconos = ["➊", "➋", "➌", "➍", "➎", "➏", "➐", "➑", "➒", "➓"];
                const listaCargos = cargosUnicos
                    .map((cargo, index) => `\n ${numerosIconos[index] || index + 1} ${cargo}`)
                    .join("");

                const PersonasDisponibles = ciudadesCache
                    .filter(c => c.Ciudad === ciudadSeleccionada)
                    .map(c => c.Nombre);

                const personasUnicas = [...new Set(PersonasDisponibles)].sort();

                userStates[from].data.ciudad = ciudadSeleccionada;
                userStates[from].stage = "esperando_cargo";

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                const userInfo = `
                    🔹 Hola ${nombreFormateado}, te habla ${personasUnicas}, un gusto saludarte. Los cargos ofertados para la ciudad ${ciudadSeleccionada} son los siguientes, por favor indicame el numero del cargo del cual quieres resivir informacion y ser agendado para una entrevista:
                    ${listaCargos}
                `;

                await sendMessage(from, userInfo);
            } else {
                await sendMessage(from, "⚠️ El numero de la ciudad ingresado no es válido. Por favor, ingresa un número de la lista de ciudades.");
            }

        } else if (userStates[from].stage === "esperando_cargo") {

            const cargosUnicas = [...new Set(ciudadesCache.map(c => c.Cargo))].sort();

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado >= 1 && numeroIngresado <= cargosUnicas.length) {
                const cargoSeleccionado = cargosUnicas[numeroIngresado - 1];

                userStates[from].data.cargo = cargoSeleccionado;

                if (userStates[from].data.cargo === "Ayudante (Sin Moto)") {
                    userStates[from].stage = "esperando_detalleCargo";
                } else if (userStates[from].data.cargo === "Conductor" || userStates[from].data.cargo === "Motorizados") {
                    userStates[from].stage = "esperando_filtro1";
                }

                let detalleCargo;

                if (cargoSeleccionado === "Motorizados") {
                    detalleCargo = "Detalle cargo Motorizados"
                } else if (cargoSeleccionado === "Conductor") {
                    detalleCargo = "Detalle cargo Conductor"
                } else if (cargoSeleccionado === "Ayudante (Sin Moto)") {
                    detalleCargo = "Detalle cargo Ayudante (Sin Moto)"
                }

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                const userInfo = `
                    🔹 ${nombreFormateado} el detalle de la oferta es la siguiente:
                    \n\n${detalleCargo}
                    \n\n🔹 Por favor indicanos si quieres continuar con la oferta, coloca el numero segun tu respuesta:
                    \n\n➊ Si
                    \n➋ No
                `;

                await sendMessage(from, userInfo);

            } else {
                await sendMessage(from, "⚠️ El cargo ingresado no es válido. Por favor, ingresa un número de la lista de cargos.");
            }

        } else if (userStates[from].stage === "esperando_filtro1") {

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado === 1) {

                userStates[from].data.detalleCargo = "Si";
                userStates[from].stage = "esperando_filtro2";

                let userInfo;

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                if (userStates[from].data.cargo === "Motorizados") {
                    userInfo = `
                        🔹 ¿${nombreFormateado} tiene licencia de conduccion A2 y cuenta con moto?, coloca el numero segun tu respuesta:
                        \n\n➊ Si
                        \n➋ No
                    `;
                } else if (userStates[from].data.cargo === "Conductor") {
                    userInfo = `
                        🔹 ¿${nombreFormateado} que categoria de licencia tiene?, coloca el numero segun tu respuesta:
                        \n\n➊ C1
                        \n➋ C2
                        \n➌ C3
                    `;
                }

                await sendMessage(from, userInfo);

            } else if (numeroIngresado === 2) {
                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                userStates[from].stage = "esperando_otroCargo";
                userStates[from].data.detalleCargo = "No";

                userInfo = `
                    🔹 ¿${nombreFormateado} quieres revisar otros cargos?, coloca el numero segun tu respuesta:
                    \n\n➊ Si
                    \n➋ No
                `;

                await sendMessage(from, userInfo);

            } else {
                await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice 1 para Si o 2 para No.");
            }

        } else if (userStates[from].stage === "esperando_filtro2") {

            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            if (userStates[from].data.cargo === "Motorizados") {

                const numeroIngresado = parseInt(text, 10);
                if (numeroIngresado === 1) {

                    userStates[from].data.respuestaFiltro1 = "Si";
                    userStates[from].stage = "esperando_detalleCargo";

                    const userInfo = `
                        🔹 ¿${nombreFormateado} tu moto es una scooter o señoritera?, coloca el numero segun tu respuesta:
                        \n\n➊ No
                        \n➋ Si
                    `;

                    await sendMessage(from, userInfo);

                } else if (numeroIngresado === 2) {
                    let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                    let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                    userStates[from].stage = "esperando_otroCargo";
                    userStates[from].data.detalleCargo = "No";

                    userInfo = `
                        🔹 ¿${nombreFormateado} quieres revisar otros cargos?, coloca el numero segun tu respuesta:
                        \n\n➊ Si
                        \n➋ No
                    `;

                    await sendMessage(from, userInfo);

                } else {
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice 1 para Si o 2 para No.");
                }

            } else if (userStates[from].data.cargo === "Conductor") {

                const numeroIngresado = parseInt(text, 10);
                if (numeroIngresado >= 1 && numeroIngresado <= 3) {

                    if (numeroIngresado === 1) {
                        userStates[from].data.respuestaFiltro1 = "C1";
                    } else if (numeroIngresado === 2) {
                        userStates[from].data.respuestaFiltro1 = "C2";
                    } else if (numeroIngresado === 3) {
                        userStates[from].data.respuestaFiltro1 = "C3";
                    }

                    userStates[from].stage = "esperando_detalleCargo";

                    const userInfo = `
                        🔹 ¿${nombreFormateado} hace cuanto tiene licencia?, coloca el numero segun tu respuesta:
                        \n\n➊ 1 año o mas
                        \n➋ Menos de 1 año
                    `;

                    await sendMessage(from, userInfo);

                } else {
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice 1 para C1, 2 para C2 o 3 para C3.");
                }
            }

        } else if (userStates[from].stage === "esperando_detalleCargo") {

            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado === 1) {

                if (userStates[from].data.cargo === "Motorizados") {
                    userStates[from].data.respuestaFiltro2 = "No";
                } else if (userStates[from].data.cargo === "Conductor") {
                    userStates[from].data.respuestaFiltro2 = "1 año o mas";
                }

                userStates[from].data.detalleCargo = "Si";
                userStates[from].stage = "esperando_entrevista";

                const userInfo = `
                    🔹 ${nombreFormateado} deseas presentarte a una entrevista para mas informacion, coloca el numero segun tu respuesta:
                    \n\n➊ Si
                    \n➋ No
                `;

                await sendMessage(from, userInfo);

            } else if (numeroIngresado === 2) {
                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                userStates[from].stage = "esperando_otroCargo";
                userStates[from].data.detalleCargo = "No";

                if (userStates[from].data.cargo === "Motorizados") {
                    userStates[from].data.respuestaFiltro2 = "Si";
                } else if (userStates[from].data.cargo === "Conductor") {
                    userStates[from].data.respuestaFiltro2 = "Menos de 1 año";
                }

                userInfo = `
                    🔹 ¿${nombreFormateado} quieres revisar otros cargos?, coloca el numero segun tu respuesta:
                    \n\n➊ Si
                    \n➋ No
                `;

                await sendMessage(from, userInfo);

            } else {
                await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice 1 para Si o 2 para No.");
            }

        } else if (userStates[from].stage === "esperando_entrevista") {

            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado === 1) {

                userStates[from].data.entrevista = "Si";
                userStates[from].stage = "Completado";

                const userInfo = `
                    🔹 ${nombreFormateado} por favor indicanos segun la siguiente lista cuando puedes presentarte:
                    \n\n➊ ${fechaMañana} a las 8:30 am
                    \n➋ ${fechaMañana} a las 2:00 pm
                    \n➌ ${fechaPasadoMañana} a las 8:30 am
                    \n➍ ${fechaPasadoMañana} a las 2:00 pm
                `;

                await sendMessage(from, userInfo);

            } else if (numeroIngresado === 2) {
                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                userStates[from].stage = "esperando_otroCargo";
                userStates[from].data.entrevista = "No";

                userInfo = `
                    🔹 ¿${nombreFormateado} quieres revisar otros cargos?, coloca el numero segun tu respuesta:
                    \n\n➊ Si
                    \n➋ No
                `;

                await sendMessage(from, userInfo);

            } else {
                await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice 1 para Si o 2 para No.");
            }

        } else if (userStates[from].stage === "Completado") {

            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado >= 1 && numeroIngresado <= 4) {

                if (numeroIngresado === 1) {
                    userStates[from].data.fechaHora = `${fechaMañana} a las 8:30 am`;
                } else if (numeroIngresado === 2) {
                    userStates[from].data.fechaHora = `${fechaMañana} a las 2:00 pm`;
                } else if (numeroIngresado === 3) {
                    userStates[from].data.fechaHora = `${fechaPasadoMañana} a las 8:30 am`;
                } else if (numeroIngresado === 4) {
                    userStates[from].data.fechaHora = `${fechaPasadoMañana} a las 2:00 pm`;
                }

                delete userStates[from];

                const userInfo = `
                    🙏 ${nombreFormateado} Gracias por comunicarse con nosotros, te estaremos esperando en nuestras instalaciones con los isguientes documentos.
                `;

                await sendMessage(from, userInfo);

            } else {
                await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice un numero de la lista.");
            }
        } else if (userStates[from].stage === "esperando_otroCargo") {

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado === 1) {

                const userInfo1 = `
                    🔹 Vale, te mostrate nuevamente nuevamente la lista de cargos ofertados para la ciudad de ${userStates[from].data.ciudad}.
                `;

                await sendMessage(from, userInfo1);

                const cargosDisponibles = ciudadesCache
                    .filter(c => c.Ciudad === userStates[from].data.ciudad)
                    .map(c => c.Cargo);

                const cargosUnicos = [...new Set(cargosDisponibles)].sort();

                const numerosIconos = ["➊", "➋", "➌", "➍", "➎", "➏", "➐", "➑", "➒", "➓"];
                const listaCargos = cargosUnicos
                    .map((cargo, index) => `\n ${numerosIconos[index] || index + 1} ${cargo}`)
                    .join("");

                userStates[from].stage = "esperando_cargo";

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                const userInfo2 = `
                    🔹 ${nombreFormateado} los cargos ofertados para la ciudad ${userStates[from].data.ciudad} son los siguientes, por favor indicame el numero del cargo del cual quieres resivir informacion y ser agendado para una entrevista:
                    ${listaCargos}
                `;

                await sendMessage(from, userInfo2);

            } else if (numeroIngresado === 2) {
                userStates[from].data.entrevista = "No";
                await sendMessage(from, "🙏 Gracias por comunicarse con nosotros.");
                delete userStates[from];
                delete userTimers[from];

            } else {
                await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice un numero de la lista.");
            }
        }
    }

    res.sendStatus(200);
});

// Función para enviar mensajes de WhatsApp
async function sendMessage(to, text) {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to,
                text: { body: text }
            },
            {
                headers: {
                    Authorization: `Bearer ${TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log(`✅ Mensaje enviado a ${to}: ${body}`);
    } catch (error) {
        console.error(`❌ Error enviando mensaje a ${to}:`, error.response?.data || error.message);
    }
}

// Función para reiniciar el temporizador de usuario
function restartUserTimer(user) {
    if (userTimers[user]) {
        clearTimeout(userTimers[user]);
    }

    userTimers[user] = setTimeout(async () => {
        const userInfo = `🕛 Tiempo de espera agotado para ${user}, Gracias por comunicarse con nosotros.`;
        console.log(userInfo);
        await sendMessage(user, userInfo);
        delete userStates[user];
    }, 60 * 1000);
}

// Endpoint para la verificación del webhook
app.get("/webhook", (req, res) => {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
        res.send(req.query["hub.challenge"]);
    } else {
        res.sendStatus(403);
    }
});

app.get("/", (req, res) => {
    res.send("Servidor funcionando");
});

const server = app.listen(PORT, () => {
    const address = server.address();
    console.log(`Servidor corriendo en el puerto ${address.port}`);
});
