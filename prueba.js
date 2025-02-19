require("dotenv").config();
const axios = require("axios");

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const TO = "573059043034";

console.log("TOKEN:", TOKEN);
console.log("PHONE_NUMBER_ID:", PHONE_NUMBER_ID);

axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
        messaging_product: "whatsapp",
        to: TO,
        text: { body: "Prueba de mensaje desde código independiente" }
    },
    {
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json"
        },
    }
)
.then(response => {
    console.log("✅ Mensaje enviado:", response.data);
})
.catch(error => {
    console.error("❌ Error en la solicitud:", error.response?.data || error.message);
});
