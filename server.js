require("dotenv").config();
const express = require("express");
const axios = require("axios");
const Holidays = require('date-holidays');
const app = express();
const PORT = 3000;
app.use(express.json());

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

let ciudadesCache = []

const pool = require('./db');

setInterval(async () => {
    try {
        const [rows] = await pool.query("SELECT 1"); // Mantiene activas las conexiones
    } catch (error) {
        console.error("❌ Error en keep-alive:", error);
    }
}, 30000); // Ejecuta cada 30 segundos

async function obtenerCiudades() {
    let connection;
    try {
        connection = await pool.getConnection();

        console.log("✅ Conexión exitosa a MySQL");

        const [rows] = await connection.execute("select * from ciudad_cargos");
        const ciudadesFiltradas = rows.filter(c => c.estado === "true");


        ciudadesCache = ciudadesFiltradas;
        return ciudadesCache;

    } catch (error) {
        console.error("❌ Error conectando a MySQL:", error);
        return "Error: " + error.message;

    } finally {
        if (connection) connection.release();
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
        const hd = new Holidays('CO'); // Configura Colombia como país

        function esFestivo(fecha) {
            return hd.isHoliday(fecha) !== false; // Devuelve true si es festivo
        }

        function obtenerDiaHabil(hoy, diasSumar) {
            let nuevoDia = new Date(hoy);
            nuevoDia.setDate(hoy.getDate() + diasSumar);

            while (nuevoDia.getDay() === 0 || nuevoDia.getDay() === 6 || esFestivo(nuevoDia)) {
                nuevoDia.setDate(nuevoDia.getDate() + 1); // Avanza al siguiente día
            }

            return nuevoDia;
        }

        async function salirDeLaConversacion() {
            console.log("Datos almacenados en userStates:", userStates[from]);

            if (userStates[from].stage === 'esperando_tratamientoDeDatos') {

                await sendMessage(from, `🔹 Gracias por comunicarte con nosotros, en Sicte SAS. Recuerda que puedes revisar nuestra lista de ofertas en cualquier momento. ¡Estamos aquí para ayudarte!`);
            } else {

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                await sendMessage(from, `🔹 ${nombreFormateado}, gracias por comunicarte con nosotros, en Sicte SAS. Recuerda que puedes revisar nuestra lista de ofertas en cualquier momento. ¡Estamos aquí para ayudarte!`);
            }

            if (userStates[from].stage !== 'Completado') {
                userStates[from].stage = "Salio de la conversacion";
            }

            await guardarEnBaseDeDatos(userStates[from], from);

            if (userTimers[from]) {
                clearTimeout(userTimers[from]);
                delete userTimers[from];
            }

            delete userStates[from];
        }

        async function mirarOtrosCargos() {
            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            const userInfo1 = `
                🔹 ¡Perfecto! Te mostramos nuevamente la lista de cargos ofertados para la ciudad de ${userStates[from].data.ciudad}.
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

            const userInfo2 = `
                🔹 ${nombreFormateado}, los cargos ofertados para la ciudad de ${userStates[from].data.ciudad} son los siguientes.
                \nPor favor, indícanos el número del cargo que más te interese para recibir más información.
                ${listaCargos}
            `;

            await sendMessage(from, userInfo2);
        }

        async function preguntaMirarOtrosCargos() {
            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            userStates[from].stage = "esperando_otroCargo";

            userInfo = `
                🔹 ${nombreFormateado}, ¿te gustaría revisar otros cargos disponibles? 
                \nPor favor, responde colocando el número correspondiente a tu opción:
                \n➊ Si\n➋ No
            `;

            await sendMessage(from, userInfo);
        }

        async function fechasEntrevista() {
            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            const direcciones = ciudadesCache
                .filter(c => c.Ciudad === userStates[from].data.ciudad)
                .map(c => c.Direccion);

            const direccion = [...new Set(direcciones)].sort();

            userStates[from].stage = "Completado";
            userStates[from].data.direccion = direccion;

            const ahora = new Date().toLocaleString("en-US", { timeZone: "America/Bogota" });
            const horaActual = new Date(ahora).getHours();

            let opciones = [
                `➊ ${fechaMañana} a las 8:30 am.`,
                `➋ ${fechaMañana} a las 2:00 pm.`,
                `➌ ${fechaPasadoMañana} a las 8:30 am.`,
                `➍ ${fechaPasadoMañana} a las 2:00 pm.`,
                `➎ No tengo disponibilidad para asistir.`
            ];

            console.log(horaActual)

            if (horaActual >= 16) {
                opciones.shift(); // Elimina la primera opción (8:30 am de mañana)
            }

            const userInfo = `
            🔹 ${nombreFormateado}, el siguiente paso es agendar una entrevista presencial para conocerte mejor y resolver tus inquietudes, por favor indícanos cuando tienes disponibilidad para presentarte en la dirección ${direccion} de la ciudad ${userStates[from].data.ciudad}.
            \n${opciones.join("\n")}
            `;

            await sendMessage(from, userInfo);
        }

        async function preguntaFiltro3() {
            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            userStates[from].stage = "esperando_detalleCargo";

            const userInfo = `
                🔹 ${nombreFormateado}, ¿Cuánto tiempo de antigüedad tiene tu licencia A2?
                \nPor favor, selecciona la opción correspondiente colocando el número:
                \n➊ Menos de 6 meses.\n➋ Más de 6 meses.\n➌ No tengo licencia A2.
            `;

            await sendMessage(from, userInfo);
        }

        const from = message.from;
        let text = message.text?.body || "Mensaje vacío";

        console.log(`📩 Mensaje recibido de ${from}: ${text}`);

        restartUserTimer(from);

        let hoy = new Date();
        let diaMañana = obtenerDiaHabil(hoy, 1);
        let diaPasadoMañana = obtenerDiaHabil(diaMañana, 1);

        let opcionesFecha = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        let fechaMañana = diaMañana.toLocaleDateString('es-ES', opcionesFecha);
        let fechaPasadoMañana = diaPasadoMañana.toLocaleDateString('es-ES', opcionesFecha);

        if (!userStates[from]) {
            userStates[from] = { stage: "esperando_tratamientoDeDatos", data: {} };

            enviarMensajeTratamientoDeDatos(from);

        } else if (userStates[from].stage === "esperando_tratamientoDeDatos") {
            if (message.interactive && message.interactive.button_reply) {
                const buttonId = message.interactive.button_reply.id;

                if (buttonId === "aceptar_datos") {
                    userStates[from].stage = "esperando_nombreApellido";
                    userStates[from].data.aceptoDatos = "Acepto";

                    const userInfo = `
                    🔹 Para comenzar, por favor ingresa tu nombre y apellido, para así continuar con el proceso.
                    \n¡Para nosotros es un gusto que nos contactes y poder avanzar juntos!
                `;

                    await sendMessage(from, userInfo);
                } else if (buttonId === "rechazar_datos") {
                    userStates[from].data.aceptoDatos = "No acepto";
                    await sendMessage(from, "❌ No has aceptado el tratamiento de datos. No podemos continuar con el proceso.");
                    salirDeLaConversacion();
                } else {
                    await sendMessage(from, "⚠️ La opcion ingresada no es válida. Por favor, seleccione una opcion.");
                }
            }

        } else if (userStates[from].stage === "esperando_nombreApellido") {

            if (/^[a-zA-ZÀ-ÿ]+(\s[a-zA-ZÀ-ÿ]+){1,49}$/.test(text)) {
                userStates[from].data.nombreApellido = text;
                userStates[from].stage = "esperando_celular";

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                const userInfo = `
                    🔹 Hola ${nombreFormateado}, para continuar con el proceso, *por favor ingresa tu número de celular*:
                `;

                await sendMessage(from, userInfo);
            } else {
                await sendMessage(from, "⚠️ El nombre ingresado no es válido. Por favor, ingresa nombre y apellido.");
            }

        } else if (userStates[from].stage === "esperando_celular") {
            const ciudades = await obtenerCiudades();

            const ciudadesUnicas = [...new Set(ciudades.map(c => c.Ciudad))].sort();

            const numerosIconos = ["➊", "➋", "➌", "➍", "➎", "➏", "➐", "➑", "➒", "➓"];
            const opcionesCiudades = ciudadesUnicas
                .map((ciudad, index) => `\n ${numerosIconos[index] || index + 1} ${ciudad}`)
                .join("");

            if (/^3\d{9}$/.test(text)) {
                userStates[from].data.celular = text;
                userStates[from].stage = "esperando_ciudad";

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                const userInfo = `
                    🔹 ${nombreFormateado}, nos gustaría conocer desde qué ciudad nos contactas. Por favor ingresa el número correspondiente.
                    ${opcionesCiudades}
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
                    🔹 ¡Hola ${nombreFormateado}! Mi nombre es ${personasUnicas} es un gusto saludarte. Soy la persona encargada del proceso de selección en ${userStates[from].data.ciudad} y te estaré acompañando de aquí en adelante. A continuación, te comparto los cargos disponibles:
                    \nPor favor, indícame el número del cargo que más te interese para ampliar la información.
                    ${listaCargos}
                `;

                await sendMessage(from, userInfo);
            } else {
                await sendMessage(from, "⚠️ El numero de la ciudad ingresado no es válido. Por favor, ingresa un número de la lista de ciudades.");
            }

        } else if (userStates[from].stage === "esperando_cargo") {

            const cargosDisponibles = ciudadesCache
                    .filter(c => c.Ciudad === userStates[from].data.ciudad)
                    .map(c => c.Cargo);

            const cargosUnicos = [...new Set(cargosDisponibles)].sort();

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado >= 1 && numeroIngresado <= cargosUnicos.length) {
                const cargoSeleccionado = cargosUnicos[numeroIngresado - 1];

                userStates[from].data.cargo = cargoSeleccionado;

                if (userStates[from].data.cargo === "Ayudante (Sin Moto)") {
                    userStates[from].stage = "esperando_detalleCargo";
                } else if (userStates[from].data.cargo === "Conductor" || userStates[from].data.cargo === "Motorizados") {
                    userStates[from].stage = "esperando_filtro1";
                }

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();
                let detalleCargo;

                if (cargoSeleccionado === "Motorizados") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos personas con motocicleta para realizar instalaciones de internet, televisión y telefonía en la ciudad ${userStates[from].data.ciudad}.
                        \n¡NO SE REQUIERE EXPERIENCIA NOSOTROS TE CAPACITAMOS!
                        \n¿Qué te ofrecemos?
                        \n• Salario: $1.423.500 + $500.000 rodamiento + $200.000 auxilio de transporte + ¡Excelente! tabla de bonificaciones y todas las prestaciones de ley.\n• Contrato a término indefinido.\n• Plan carrera.\n•	Capacitación paga.\n• Se realiza curso de alturas una vez se firme contrato laboral.\n•	Horario: Lunes a sábado con disponibilidad de laborar 2 domingos.
                    `
                } else if (cargoSeleccionado === "Conductor") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos conductores con licencia C1 o C2 para realizar instalaciones de internet, televisión y telefonía en la ciudad ${userStates[from].data.ciudad}.
                        \n¿Qué te ofrecemos?
                        \n• Salario: $1.423.500 + $310.000 aux. movilizacion + $200.000 auxilio de transporte + todas las prestaciones de ley.\n• Contrato a término indefinido.\n• Plan carrera.\n• Capacitación paga.\n• Se realiza curso de alturas una vez se firme contrato laboral.\n• Horario: Lunes a sábado con disponibilidad de laborar 2 domingos.
                    `
                } else if (cargoSeleccionado === "Ayudante (Sin Moto)") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos bachilleres para realizar instalaciones de internet, televisión y telefonía en la ciudad ${userStates[from].data.ciudad}.
                        \n¡NO SE REQUIERE EXPERIENCIA NOSOTROS TE CAPACITAMOS!
                        \n¿Qué te ofrecemos?
                        \n• Salario: $1.423.500 + $200.000 auxilio de transporte + ¡Excelente! tabla de bonificaciones y todas las prestaciones de ley.\n• Contrato a término indefinido.\n• Plan carrera.\n• Capacitación paga.\n•	Se realiza curso de alturas una vez se firme contrato laboral.\n• Horario: Lunes a sábado con disponibilidad de laborar 2 domingos.
                    `
                }

                const userInfo = `
                    ${detalleCargo}
                    \n🔹 Por favor, indícanos si deseas continuar con esta oferta. Responde con el número correspondiente a tu elección:
                    \n➊ Sí, quiero continuar con la oferta.\n➋ No, gracias, no me interesa, quiero ver la información de otros cargos disponibles.\n➌ No, gracias, no me interesa continuar con el proceso.
                    \n¡Esperamos que continues con el proceso de selección!
                `;

                await sendMessage(from, userInfo);

            } else {
                await sendMessage(from, "⚠️ El cargo ingresado no es válido. Por favor, ingresa un número de la lista de cargos.");
            }

        } else if (userStates[from].stage === "esperando_filtro1") {

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado === 1) {

                userStates[from].data.detalleCargo = "Sí, quiero continuar con la oferta.";
                userStates[from].stage = "esperando_filtro2";

                let userInfo;

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                if (userStates[from].data.cargo === "Motorizados") {
                    userInfo = `
                        🔹 ${nombreFormateado}, nos alegra que continues en el proceso, ¿Cuentas con motocicleta? 
                        \n➊ Si\n➋ No
                    `;
                } else if (userStates[from].data.cargo === "Conductor") {
                    userInfo = `
                        🔹 ${nombreFormateado}, nos alegra que continues en el proceso, ¿Cuentas con experiencia certificada en conducción?
                        \n➊ Si, menos de 1 año.\n➋ Si, más de 1 año.\n➌ No tengo experiencia certificada.
                    `;
                }

                await sendMessage(from, userInfo);

            } else if (numeroIngresado === 2) {
                userStates[from].data.detalleCargo = "No, gracias, no me interesa, quiero ver la información de otros cargos disponibles.";
                mirarOtrosCargos();

            } else if (numeroIngresado === 3) {
                userStates[from].data.detalleCargo = "No, gracias, no me interesa continuar con el proceso.";
                salirDeLaConversacion();

            } else {
                await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indique un numero de 1 a 3.");
            }

        } else if (userStates[from].stage === "esperando_filtro2") {

            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            if (userStates[from].data.cargo === "Motorizados") {

                const numeroIngresado = parseInt(text, 10);
                if (numeroIngresado === 1) {
                    userStates[from].data.respuestaFiltro1 = "Si";
                    userStates[from].stage = "esperando_filtro3";

                    const userInfo = `
                        🔹 ${nombreFormateado}, ¿Tu motocicleta es tipo Scooter?
                        \nPor favor, selecciona la opción correspondiente colocando el número:
                        \n➊ Si\n➋ No
                    `;

                    await sendMessage(from, userInfo);

                } else if (numeroIngresado === 2) {
                    userStates[from].data.respuestaFiltro1 = "No";
                    userStates[from].data.respuestaFiltro2 = "No Aplica";

                    preguntaFiltro3();
                } else {
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indique 1 para Si o 2 para No.");
                }

            } else if (userStates[from].data.cargo === "Conductor") {

                const numeroIngresado = parseInt(text, 10);
                if (numeroIngresado >= 1 && numeroIngresado <= 3) {

                    if (numeroIngresado === 1) {
                        userStates[from].data.respuestaFiltro1 = "Si, menos de 6 meses.";
                    } else if (numeroIngresado === 2) {
                        userStates[from].data.respuestaFiltro1 = "Si, más de 6 meses.";
                    } else if (numeroIngresado === 3) {
                        userStates[from].data.respuestaFiltro1 = "No tengo experiencia certificada.";
                    }

                    userStates[from].stage = "esperando_detalleCargo";

                    const userInfo = `
                        🔹 ${nombreFormateado}, ¿Qué tipo de licencia de conducción tienes vigente?
                        \nPor favor, selecciona la opción correspondiente colocando el número:
                        \n➊ C1\n➋ C2\n➌ C3\n➍ No tengo licencia de conducción categoría C
                    `;

                    await sendMessage(from, userInfo);

                } else {
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indique un numero entre 1 y 4.");
                }
            }

        } else if (userStates[from].stage === "esperando_filtro3") {

            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            if (userStates[from].data.cargo === "Motorizados") {

                const numeroIngresado = parseInt(text, 10);
                if (numeroIngresado === 2) {

                    userStates[from].data.respuestaFiltro2 = "No";

                    preguntaFiltro3();

                } else if (numeroIngresado === 1) {
                    userStates[from].data.respuestaFiltro2 = "Si";

                    let mensajeRechazo;
                    mensajeRechazo = "No cumples con uno de los requisito para el cargo el cual es que tu moto no sea una scooter o señoritera"

                    userInfo = `
                        🔹 ${mensajeRechazo}.
                    `;

                    await sendMessage(from, userInfo);

                    preguntaMirarOtrosCargos();
                } else {
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indique 1 para Si o 2 para No.");
                }
            }

        } else if (userStates[from].stage === "esperando_detalleCargo") {

            const numeroIngresado = parseInt(text, 10);

            if (userStates[from].data.cargo === "Motorizados") {

                if (numeroIngresado >= 1 && numeroIngresado <= 2) {
                    if (numeroIngresado === 1) {
                        userStates[from].data.respuestaFiltro3 = "Menos de 1 año.";
                    } else if (numeroIngresado === 2) {
                        userStates[from].data.respuestaFiltro3 = "Más de 1 año.";
                    }

                    fechasEntrevista();

                } else if (numeroIngresado === 3) {
                    userStates[from].data.respuestaFiltro3 = "No tengo licencia A2.";

                    let mensajeRechazo;
                    mensajeRechazo = "No cumples con uno de los requisito para el cargo el cual es tener licencia A2."

                    userInfo = `
                        🔹 ${mensajeRechazo}.
                    `;

                    await sendMessage(from, userInfo);

                    preguntaMirarOtrosCargos();
                } else {
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indique un numero de 1 a 3.");
                }

            } else if (userStates[from].data.cargo === "Conductor") {

                if (numeroIngresado >= 1 && numeroIngresado <= 3) {
                    if (numeroIngresado === 1) {
                        userStates[from].data.respuestaFiltro2 = "C1";
                    } else if (numeroIngresado === 2) {
                        userStates[from].data.respuestaFiltro2 = "C2";
                    } else if (numeroIngresado === 3) {
                        userStates[from].data.respuestaFiltro2 = "C3";
                    }

                    fechasEntrevista();

                } else if (numeroIngresado === 4) {
                    userStates[from].data.respuestaFiltro2 = "No tengo licencia de conducción categoría C";

                    let mensajeRechazo;
                    mensajeRechazo = "No cumples con uno de los requisito para el cargo el cual es tener licencia categoria C."

                    userInfo = `
                        🔹 ${mensajeRechazo}.
                    `;

                    await sendMessage(from, userInfo);

                    preguntaMirarOtrosCargos();

                } else {
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indique un numero de 1 a 4.");
                }

            } else if (userStates[from].data.cargo === "Ayudante (Sin Moto)") {

                const numeroIngresado = parseInt(text, 10);
                if (numeroIngresado === 1) {

                    userStates[from].data.detalleCargo = "Sí, quiero continuar con la oferta.";

                    fechasEntrevista();

                } else if (numeroIngresado === 2) {
                    userStates[from].data.detalleCargo = "No, gracias, no me interesa, quiero ver la información de otros cargos disponibles.";
                    mirarOtrosCargos();

                } else if (numeroIngresado === 3) {
                    userStates[from].data.detalleCargo = "No, gracias, no me interesa continuar con el proceso.";
                    salirDeLaConversacion();

                } else {
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indique un numero de 1 a 3.");
                }

            } else {
                await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indique 1 para Si o 2 para No.");
            }

        } else if (userStates[from].stage === "Completado") {

            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            const ahora = new Date().toLocaleString("en-US", { timeZone: "America/Bogota" });
            const horaActual = new Date(ahora).getHours();

            const numeroIngresado = parseInt(text, 10);
            if ((numeroIngresado === 1 && horaActual < 16) || (numeroIngresado >= 2 && numeroIngresado <= 4)) {

                if (numeroIngresado === 1) {
                    userStates[from].data.fechaHora = `${fechaMañana} a las 8:30 am`;
                } else if (numeroIngresado === 2) {
                    userStates[from].data.fechaHora = `${fechaMañana} a las 2:00 pm`;
                } else if (numeroIngresado === 3) {
                    userStates[from].data.fechaHora = `${fechaPasadoMañana} a las 8:30 am`;
                } else if (numeroIngresado === 4) {
                    userStates[from].data.fechaHora = `${fechaPasadoMañana} a las 2:00 pm`;
                }

                let textoAdicional;

                if (userStates[from].data.cargo === "Motorizados" || userStates[from].data.cargo === "Conductor") {
                    textoAdicional = `3. Fotocopia de la licencia de conducción.`
                } else {
                    textoAdicional = ``
                }

                const PersonasDisponibles = ciudadesCache
                    .filter(c => c.Ciudad === userStates[from].data.ciudad)
                    .map(c => c.Nombre);

                const personasUnicas = [...new Set(PersonasDisponibles)].sort();

                const NumerosDisponibles = ciudadesCache
                    .filter(c => c.Ciudad === userStates[from].data.ciudad)
                    .map(c => c.Celular);

                const numerosUnicos = [...new Set(NumerosDisponibles)].sort();

                const userInfo = `
                🔹 ${nombreFormateado}, gracias por confirmar tu asistencia, recuerda que mi nombre es ${personasUnicas} y te espero el día ${userStates[from].data.fechaHora} en la dirección ${userStates[from].data.direccion} de la ciudad ${userStates[from].data.ciudad}.
                \nPor favor no olvides traer los siguientes documentos:
                \n1. Hoja de vida actualizada\n2. Fotocopia de la cedula al 150%\n${textoAdicional}
                \nSi tienes alguna inquietud puedes contactarme al número de teléfono ${numerosUnicos}\n👋 Ten un excelente dia.
                `;

                await sendMessage(from, userInfo);

                console.log("Datos almacenados en userStates:", userStates[from]);

                await guardarEnBaseDeDatos(userStates[from], from);

                delete userStates[from];

            } else if (numeroIngresado === 5) {
                userStates[from].data.fechaHora = `No tengo disponibilidad para asistir`;

                const PersonasDisponibles = ciudadesCache
                    .filter(c => c.Ciudad === userStates[from].data.ciudad)
                    .map(c => c.Nombre);

                const personasUnicas = [...new Set(PersonasDisponibles)].sort();

                const NumerosDisponibles = ciudadesCache
                    .filter(c => c.Ciudad === userStates[from].data.ciudad)
                    .map(c => c.Celular);

                const numerosUnicos = [...new Set(NumerosDisponibles)].sort();

                const userInfo = `
                🔹 ${nombreFormateado}, gracias por comunicarte con nosotros, mi nombre es ${personasUnicas} y me estare comunicando contigo para validar tu disponibilidad. Recuerda que si tienes alguna inquietud puedes contactarme al numero ${numerosUnicos}.
                `;

                await sendMessage(from, userInfo);

                await guardarEnBaseDeDatos(userStates[from], from);

                if (userTimers[from]) {
                    clearTimeout(userTimers[from]);
                    delete userTimers[from];
                }

                delete userStates[from];

            } else {
                await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indique un numero de la lista.");
            }

        } else if (userStates[from].stage === "esperando_otroCargo") {

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado === 1) {
                mirarOtrosCargos();

            } else if (numeroIngresado === 2) {
                userStates[from].data.entrevista = "No";
                salirDeLaConversacion();

            } else {
                await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indique un numero de la lista.");
            }
        }
    }

    res.sendStatus(200);
});

// Función para enviar mensaje de tratamiento de datos
const enviarMensajeTratamientoDeDatos = async (to) => {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: to,
                type: "interactive",
                interactive: {
                    type: "button",
                    body: {
                        text: "¡Hola! Te damos la bienvenida a Sicte SAS, una empresa líder en telecomunicaciones, te encuentras en contacto con Esteban Morales del equipo de Gestión Humana.\n📜 Antes de iniciar y en cumplimiento de la Ley 1581 de 2012 y el Decreto 1377 de 2013, te informo que el tratamiento de tus datos personales se realizará conforme a nuestra política de privacidad que puedes consultar en: https://sicte.com/imagenes/certificados/politicadedatos.pdf.\n\n✅ ¿Aceptas estos términos?"
                    },
                    action: {
                        buttons: [
                            {
                                type: "reply",
                                reply: {
                                    id: "aceptar_datos",
                                    title: "✅ Acepto"
                                }
                            },
                            {
                                type: "reply",
                                reply: {
                                    id: "rechazar_datos",
                                    title: "❌ No acepto"
                                }
                            }
                        ]
                    }
                }
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${TOKEN}`
                }
            }
        );
        console.log("Mensaje enviado:", response.data);
    } catch (error) {
        console.error("Error enviando mensaje:", error.response ? error.response.data : error.message);
    }
};

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

app.post("/enviar-mensaje", async (req, res) => {
    const { numero, nombre, fecha, direccion, ciudad, nombreGH, numeroGH } = req.body;

    if (!numero || !nombre || !fecha || !direccion || !ciudad || !nombreGH || !numeroGH) {
        return res.status(400).json({ error: "Numero, nombre, fecha, direccion, ciudad, nombreGH y numeroGH son requeridos" });
    }

    try {
        const response = await axios.post(
            `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: numero,
                type: "template",
                template: {
                    name: "confirmacion_entrevista",
                    language: { code: "es_CO" },
                    components: [
                        {
                            type: "body",
                            parameters: [
                                { type: "text", text: nombre },
                                { type: "text", text: fecha },
                                { type: "text", text: direccion },
                                { type: "text", text: ciudad },
                                { type: "text", text: nombreGH },
                                { type: "text", text: numeroGH }
                            ]
                        }
                    ]
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${TOKEN}`,
                    "Content-Type": "application/json",
                },
            }
        );

        res.status(200).json({ success: true, data: response.data });
    } catch (error) {
        console.error("❌ Error al enviar mensaje:", error.response?.data || error.message);
        res.status(500).json({ error: "Error al enviar el mensaje" });
    }
});

// Función para reiniciar el temporizador de usuario
function restartUserTimer(user) {
    if (userTimers[user]) {
        clearTimeout(userTimers[user]);
    }

    if (!userStates[user] || userStates[user].stage === "Salio de la conversacion" || userStates[user].stage === "Completado") {
        return;
    }

    userTimers[user] = setTimeout(async () => {
        if (!userStates[user]) return;

        const userInfo = `🕛 Tiempo de espera agotado para ${user}, Gracias por comunicarse con nosotros.`;
        console.log(userInfo);
        await sendMessage(user, userInfo);

        userStates[user].stage = "Tiempo Agotado";
        console.log("Datos almacenados en userStates:", userStates[user]);

        await guardarEnBaseDeDatos(userStates[user], user);

        delete userStates[user];
        delete userTimers[user];
    }, 30 * 60 * 1000); // 10 minutos
}

async function guardarEnBaseDeDatos(userData, from) {
    let connection;

    try {
        connection = await pool.getConnection();
        console.log(userData)

        const sql = `
            INSERT INTO registros_chatbot (registro, stage, celularChat, aceptoPolitica, nombreApellido, celular, ciudad, cargo, detalleCargo, respuestaFiltro1, respuestaFiltro2, respuestaFiltro3, direccion, fechaHora, estadoFinal, fechaHoraInicial)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const fechaRegistro = new Date().toLocaleString("en-CA", {
            timeZone: "America/Bogota",
            hour12: false 
        }).replace(",", "");

        let estadoFinal

        if (userData.stage === "Salio de la conversacion") {
            estadoFinal = "No Continua"
        } else if (userData.stage === "Completado") {
            estadoFinal = "Pendiente"
        } else if (userData.stage === "Tiempo Agotado") {
            if (userData.data.nombreApellido) {
                estadoFinal = "Pendiente"
            } else {
                estadoFinal = "No Continua"
            }
        }

        const valores = [
            fechaRegistro,
            userData.stage ?? "-",
            userData.data.aceptoDatos === 'Acepto' ? from : "-",
            userData.data.aceptoDatos ?? "-",
            userData.data.nombreApellido ?? "-",
            userData.data.celular ?? "-",
            userData.data.ciudad ?? "-",
            userData.data.cargo ?? "-",
            userData.data.detalleCargo ?? "-",
            userData.data.respuestaFiltro1 ?? "-",
            userData.data.respuestaFiltro2 ?? "-",
            userData.data.respuestaFiltro3 ?? "-",
            (userData.data.direccion?.join(', ') ?? "-"), // Asegura que dirección sea un string
            userData.data.fechaHora ?? "-",
            estadoFinal,
            userData.data.fechaHora ?? "-"
        ];

        await connection.execute(sql, valores);
        console.log("✅ Datos guardados en MySQL");

    } catch (error) {
        console.error("❌ Error guardando en MySQL:", error);

    } finally {
        if (connection) connection.release(); // Cerrar la conexión
    }
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
