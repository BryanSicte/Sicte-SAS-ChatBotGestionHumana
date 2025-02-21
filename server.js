require("dotenv").config();
const express = require("express");
const axios = require("axios");
const app = express();
const PORT = 3000;
app.use(express.json());

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

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
            userStates[from] = { stage: "waiting_cedula", data: {} };
        
            await sendMessage(from, "👋 ¡Bienvenido! Por favor, ingresa tu número de cédula para continuar.");
        } else if (userStates[from].stage === "waiting_cedula") {
            
            if (/^\d{6,10}$/.test(text)) {
                userStates[from].data.cedula = text;
                userStates[from].stage = "waiting_nombre";
        
                const userInfo = `📄 Cédula ingresada: ${text}\n\n🔹 Ahora por favor, ingresa tu nombre para continuar.`;
        
                await sendMessage(from, userInfo);
            } else {
                await sendMessage(from, "⚠️ La cédula ingresada no es válida. Por favor, ingrésala nuevamente.");
            }
        
        } else if (userStates[from].stage === "waiting_nombre") {
            
            if (/^[a-zA-ZÀ-ÿ\s]{3,50}$/.test(text)) {
                userStates[from].data.nombre = text;
                userStates[from].stage = "waiting_apellido";
        
                const userInfo = `📄 Cédula ingresada: ${userStates[from].data.cedula}.\n🔹 Nombre ingresado: ${text}.\n\n🔹 Ahora, por favor ingresa tus apellidos.`;
        
                await sendMessage(from, userInfo);
            } else {
                await sendMessage(from, "⚠️ El nombre ingresado no es válido. Asegúrate de escribir solo letras y al menos 3 caracteres.");
            }
        
        } else if (userStates[from].stage === "waiting_apellido") {
            
            if (/^[a-zA-ZÀ-ÿ\s]{3,50}$/.test(text)) {
                userStates[from].data.apellido = text;
                userStates[from].stage = "completed";
        
                const userInfo = `✅ Registro completado:\n📄 Cédula: ${userStates[from].data.cedula}\n🔹 Nombre: ${userStates[from].data.nombre}\n🔹 Apellido: ${text}\n\n💾 Ahora se guardará la información en la base de datos.`;
        
                await sendMessage(from, userInfo);
        
                // Aquí puedes llamar a una función para guardar en MySQL
                await saveToDatabase(userStates[from].data);
                
                // Limpiar el estado del usuario después de guardar
                delete userStates[from];
        
            } else {
                await sendMessage(from, "⚠️ El apellido ingresado no es válido. Asegúrate de escribir solo letras y al menos 3 caracteres.");
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
    console.log(`Servidor corriendo en http://localhost:${address.port}`);
});
