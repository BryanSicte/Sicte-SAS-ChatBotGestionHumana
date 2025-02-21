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
        const text = message.text?.body || "Mensaje vacío";

        console.log(`📩 Mensaje recibido de ${from}: ${text}`);

        restartUserTimer(from);

        if (!userStates[from]) {
            userStates[from] = { stage: "esperando_cedula", data: {} };

            await sendMessage(from, "👋 ¡Bienvenido! Por favor, ingresa tu número de cédula para continuar:");
        } else if (userStates[from].stage === "esperando_cedula") {

            if (/^\d{6,10}$/.test(text)) {
                userStates[from].data.cedula = text;
                userStates[from].stage = "esperando_nombre";

                const userInfo = `
                    📋 Datos Ingresados:
                    \n\n🆔 Cédula ingresada: ${text}
                    \n\n🔹 Ahora por favor, ingresa tu nombre para continuar:
                `;

                await sendMessage(from, userInfo);
            } else {
                await sendMessage(from, "⚠️ La cédula ingresada no es válida. Por favor, ingrésala nuevamente.");
            }

        } else if (userStates[from].stage === "esperando_nombre") {

            if (/^[a-zA-ZÀ-ÿ\s]{3,50}$/.test(text)) {
                userStates[from].data.nombre = text;
                userStates[from].stage = "esperando_apellido";

                const userInfo = `
                    📋 Datos Ingresados:
                    \n\n🆔 Cédula ingresada: ${userStates[from].data.cedula}.
                    \n👤 Nombre ingresado: ${text}.
                    \n\n🔹 Ahora, por favor ingresa tus apellidos:
                `;

                await sendMessage(from, userInfo);
            } else {
                await sendMessage(from, "⚠️ El nombre ingresado no es válido. Asegúrate de escribir solo letras y al menos 3 caracteres.");
            }

        } else if (userStates[from].stage === "esperando_apellido") {

            if (/^[a-zA-ZÀ-ÿ\s]{3,50}$/.test(text)) {
                userStates[from].data.apellido = text;
                userStates[from].stage = "esperando_celular";

                const userInfo = `
                    📋 Datos Ingresados:
                    \n\n🆔 Cédula ingresada: ${userStates[from].data.cedula}
                    \n👤 Nombre ingresado: ${userStates[from].data.nombre}
                    \n🔠 Apellido ingresado: ${text}
                    \n\n🔹 Por ultimo, por favor ingresa tu numero de celular:
                `;

                await sendMessage(from, userInfo);

                // // Aquí puedes llamar a una función para guardar en MySQL
                // await saveToDatabase(userStates[from].data);

                // // Limpiar el estado del usuario después de guardar
                // delete userStates[from];

            } else {
                await sendMessage(from, "⚠️ El apellido ingresado no es válido. Asegúrate de escribir solo letras y al menos 3 caracteres.");
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

                const userInfo = `
                    📋 Datos Ingresados:
                    \n\n🆔 Cédula ingresada: ${userStates[from].data.cedula}
                    \n👤 Nombre ingresado: ${userStates[from].data.nombre}
                    \n🔠 Apellido ingresado: ${userStates[from].data.apellido}
                    \n📱 Celular ingresado: ${text}
                    \n\n🔹 Ahora requerimos saber de que ciudad nos contactas para mostrarte los cargos que tenemos ofertados, por favor ingresa el numero de la ciudad de la cual nos contactas:
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

                userStates[from].data.ciudad = ciudadSeleccionada;
                userStates[from].stage = "esperando_cargo";

                const userInfo = `
                    📋 Datos Ingresados:
                    \n\n🆔 Cédula ingresada: ${userStates[from].data.cedula}
                    \n👤 Nombre ingresado: ${userStates[from].data.nombre}
                    \n🔠 Apellido ingresado: ${userStates[from].data.apellido}
                    \n📱 Celular ingresado: ${userStates[from].data.celular}
                    \n📍 Ciudad de contacto ingresada: ${ciudadSeleccionada}
                    \n\n🔹 Los cargos ofertados son los siguientes, por favor indica el numero del cual quieres resivir informacion y ser agendado para una entrevista:
                    ${listaCargos || "\n⚠️ No hay cargos disponibles para esta ciudad."}
                `;

                await sendMessage(from, userInfo);
            } else {
                await sendMessage(from, "⚠️ El numero de celular ingresado no es válido. Por favor, ingresa un número de la lista de ciudades.");
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
