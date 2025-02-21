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
            userStates[from] = { stage: "esperando_cedula", data: {} };
        
            await sendMessage(from, "👋 ¡Bienvenido! Por favor, ingresa tu número de cédula para continuar.");
        } else if (userStates[from].stage === "esperando_cedula") {
            
            if (/^\d{6,10}$/.test(text)) {
                userStates[from].data.cedula = text;
                userStates[from].stage = "esperando_nombre";
        
                const userInfo = `
                    📋 Datos Ingresados: \n\n
                    🆔 Cédula ingresada: ${text}
                    \n\n🔹 Ahora por favor, ingresa tu nombre para continuar.
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
                    📋 Datos Ingresados: \n\n
                    🆔 Cédula ingresada: ${userStates[from].data.cedula}.
                    \n👤 Nombre ingresado: ${text}.
                    \n\n🔹 Ahora, por favor ingresa tus apellidos.
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
                    📋 Datos Ingresados: \n\n
                    🆔 Cédula ingresada: ${userStates[from].data.cedula}
                    \n👤 Nombre ingresado: ${userStates[from].data.nombre}
                    \n🔠 Apellido ingresado: ${text}
                    \n\n🔹 Por ultimo, por favor ingresa tu numero de celular.
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
            
            if (/^\d{10}$/.test(text)) {
                userStates[from].data.celular = text;
                userStates[from].stage = "esperando_ciudad";
        
                const userInfo = `
                    📋 Datos Ingresados: \n\n
                    🆔 Cédula ingresada: ${userStates[from].data.cedula}
                    \n👤 Nombre ingresado: ${userStates[from].data.nombre}
                    \n🔠 Apellido ingresado: ${userStates[from].data.apellido}
                    \n📱 Celular ingresado: ${text}
                    \n\n🔹 Ahora requerimos saber de que ciudad nos contactas para mostrarte los cargos que tenemos ofertados, por favor ingresa el numero de la ciudad de la cual nos contactas.
                    \n\n ➊ Bogotá  
                    \n ➋ Zipaquirá y Sabana Norte  
                    \n ➌ Armenia  
                    \n ➍ Pereira  
                    \n ➎ Manizales 
                `;
        
                await sendMessage(from, userInfo);
            } else {
                await sendMessage(from, "⚠️ El numero de celular ingresado no es válido. Asegúrate de escribir 10 numeros.");
            }
        } else if (userStates[from].stage === "esperando_ciudad") {
            
            if (/^[1-5]$/.test(text)) {
                let ciudad;
                if (text === "1") {ciudad = "Bogotá"}
                else if (text === "2") {ciudad = "Zipaquirá y Sabana Norte"}
                else if (text === "3") {ciudad = "Armenia"}
                else if (text === "4") {ciudad = "Pereira"}
                else if (text === "5") {ciudad = "Manizales"}

                userStates[from].data.ciudad = ciudad;
                userStates[from].stage = "esperando_cargo";
        
                const userInfo = `
                    📋 Datos Ingresados: \n\n
                    🆔 Cédula ingresada: ${userStates[from].data.cedula}
                    \n👤 Nombre ingresado: ${userStates[from].data.nombre}
                    \n🔠 Apellido ingresado: ${userStates[from].data.apellido}
                    \n📱 Celular ingresado: ${userStates[from].data.celular}
                    \n📱 Ciudad de contacto ingresada: ${ciudad}
                    \n\n🔹 Los cargos ofertados son los siguientes, por favor indica el numero del cual quieres resivir informacion y ser agendado para una entrevista.
                `;
        
                await sendMessage(from, userInfo);
            } else {
                await sendMessage(from, "⚠️ El numero de celular ingresado no es válido. Asegúrate de escribir 10 numeros.");
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
