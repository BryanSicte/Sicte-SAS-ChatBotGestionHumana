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

        async function salirDeLaConversacion() {
            console.log("Datos almacenados en userStates:", userStates[from]);

            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            await sendMessage(from, `🙏 ${nombreFormateado}, gracias por comunicarte con nosotros, en Sicte SAS. Recuerda que puedes revisar nuestra lista de ofertas en cualquier momento. ¡Estamos aquí para ayudarte!`);

            if (userStates[from].stage !== 'Completado') {
                userStates[from].stage = "Salio de la conversacion";
            }

            await guardarEnBaseDeDatos(userStates[from]); 

            delete userStates[from];
            delete userTimers[from];
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

            const userInfo = `
            🔹 ${nombreFormateado}, el siguiente paso es agendar una entrevista presencial para conocerte mejor y resolver tus inquietudes, por favor indícanos cuando tienes disponibilidad para presentarte en la dirección ${direccion} de la ciudad ${userStates[from].data.ciudad}.
            \n➊ ${fechaMañana} a las 8:30 am.\n➋ ${fechaMañana} a las 2:00 pm.\n➌ ${fechaPasadoMañana} a las 8:30 am.\n➍ ${fechaPasadoMañana} a las 2:00 pm.\n➎ No tengo disponibilidad para asistir.
            `;

            await sendMessage(from, userInfo);
        }

        const from = message.from;
        let text = message.text?.body || "Mensaje vacío";

        console.log(`📩 Mensaje recibido de ${from}: ${text}`);

        restartUserTimer(from);

        let hoy = new Date();
        let diaSemana = hoy.getDay();

        let diaMañana = obtenerDiaHabil(diaSemana, 1);
        let diaPasadoMañana = obtenerDiaHabil(diaSemana, 2);

        let opcionesFecha = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        let fechaMañana = diaMañana.toLocaleDateString('es-ES', opcionesFecha);
        let fechaPasadoMañana = diaPasadoMañana.toLocaleDateString('es-ES', opcionesFecha);

        if (!userStates[from]) {
            userStates[from] = { stage: "esperando_nombreApellido", data: {} };

            await sendMessage(from, `
                👋 ¡Hola! Te damos la bienvenida a Sicte SAS, una empresa líder en telecomunicaciones, te encuentras en contacto con Gestión Humana.
                \nPara comenzar, por favor ingresa tu nombre y apellido, para así continuar con el proceso.
                \n¡Para nosotros es un gusto que nos contactes y poder avanzar juntos!
            `);

        } else if (userStates[from].stage === "esperando_nombreApellido") {

            if (/^[a-zA-ZÀ-ÿ]+(\s[a-zA-ZÀ-ÿ]+){1,49}$/.test(text)) {
                userStates[from].data.nombreApellido = text;
                userStates[from].stage = "esperando_celular";

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                const userInfo = `
                    🔹 Hola ${nombreFormateado}, para continuar con el proceso, por favor ingresa tu número de celular:
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

            if (/^\d{10}$/.test(text)) {
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
                    🔹 ¡Hola ${nombreFormateado}! Mi nombre es ${personasUnicas} es un gusto saludarte. A continuación, te compartimos los cargos disponibles:
                    \nPor favor, indícanos el número del cargo que más te interese para recibir más información.
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

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();
                let detalleCargo;

                if (cargoSeleccionado === "Motorizados") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos personas con motocicleta para realizar instalaciones de internet, televisión y telefonía en la ciudad ${userStates[from].data.ciudad}.
                        \n¡NO SE REQUIERE EXPERIENCIA NOSOTROS TE CAPACITAMOS!
                        \n¿Qué te ofrecemos?
                        \n• Salario: $1.423.500 + $310.000 rodamiento + $200.000 auxilio de transporte + ¡Excelente! tabla de bonificaciones y todas las prestaciones de ley.\n• Contrato a término indefinido.\n• Plan carrera.\n•	Capacitación paga.\n• Se realiza curso de alturas una vez se firme contrato laboral.\n•	Horario: Lunes a sábado con disponibilidad de laborar 2 domingos.
                    `
                } else if (cargoSeleccionado === "Conductor") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos conductores con licencia C1 o C2 para realizar instalaciones de internet, televisión y telefonía en la ciudad ${userStates[from].data.ciudad}.
                        \n¿Qué te ofrecemos?
                        \n• Salario: $1.423.500 + $500.000 rodamiento + $200.000 auxilio de transporte + ¡Excelente! tabla de bonificaciones y todas las prestaciones de ley.\n• Contrato a término indefinido.\n• Plan carrera.\n•	Capacitación paga.\n• Se realiza curso de alturas una vez se firme contrato laboral.\n•	Horario: Lunes a sábado con disponibilidad de laborar 2 domingos.
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
                        🔹 ${nombreFormateado}, nos alegra que continues en el proceso, ¿Cuentas con motocicleta propia? 
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
                await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice un numero de 1 a 3.");
            }

        } else if (userStates[from].stage === "esperando_filtro2") {

            let nombre = userStates[from].data.nombreApellido.split(" ")[0];
            let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

            if (userStates[from].data.cargo === "Motorizados") {

                const numeroIngresado = parseInt(text, 10);
                if (numeroIngresado >= 1 && numeroIngresado <= 2) {

                    if (numeroIngresado === 1) {
                        userStates[from].data.respuestaFiltro1 = "Si";
                    } else if (numeroIngresado === 2) {
                        userStates[from].data.respuestaFiltro1 = "No";
                    }

                    userStates[from].stage = "esperando_filtro3";

                    const userInfo = `
                        🔹 ${nombreFormateado}, ¿Tu motocicleta es tipo Scooter?
                        \nPor favor, selecciona la opción correspondiente colocando el número:
                        \n➊ Si\n➋ No
                    `;

                    await sendMessage(from, userInfo);

                } else {
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice 1 para Si o 2 para No.");
                }

            } else if (userStates[from].data.cargo === "Conductor") {

                const numeroIngresado = parseInt(text, 10);
                if (numeroIngresado >= 1 && numeroIngresado <= 3) {

                    if (numeroIngresado === 1) {
                        userStates[from].data.respuestaFiltro1 = "Si, menos de 1 año.";
                    } else if (numeroIngresado === 2) {
                        userStates[from].data.respuestaFiltro1 = "Si, más de 1 año.";
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
                    userStates[from].stage = "esperando_detalleCargo";

                    const userInfo = `
                        🔹 ${nombreFormateado}, ¿Cuánto tiempo de antigüedad tiene tu licencia A2?
                        \nPor favor, selecciona la opción correspondiente colocando el número:
                        \n➊ Menos de 1 año.\n➋ Más de 1 año.\n➌ No tengo licencia A2.
                    `;

                    await sendMessage(from, userInfo);

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
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice 1 para Si o 2 para No.");
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
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice un numero de 1 a 3.");
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
                    mensajeRechazo = "No cumples con uno de los requisito para el cargo el cual es tener licencia A2."

                    userInfo = `
                        🔹 ${mensajeRechazo}.
                    `;

                    await sendMessage(from, userInfo);

                    preguntaMirarOtrosCargos();

                } else {
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice un numero de 1 a 4.");
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
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice un numero de 1 a 3.");
                }

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

                let textoAdicional;

                if (userStates[from].data.cargo === "Motorizados" || userStates[from].data.cargo === "Conductor") {
                    textoAdicional = `3. Fotocopia de la licencia de conducción.`
                } else  {
                    textoAdicional = ``
                }

                const userInfo = `
                🙏 ${nombreFormateado}, gracias por cofirmar tu asistencia, te espero el día ${userStates[from].data.fechaHora} en la dirección ${userStates[from].data.direccion} de la ciudad ${userStates[from].data.ciudad}.
                \nPor favor no olvides traer los siguientes documentos:
                \n1. Hoja de vida actualizada\n2. Fotocopia de la cedula al 150%\n${textoAdicional}
                `;

                await sendMessage(from, userInfo);

                console.log("Datos almacenados en userStates:", userStates[from]);

                await guardarEnBaseDeDatos(userStates[from]); 

                delete userStates[from];

            } else if (numeroIngresado === 5) {
                userStates[from].data.fechaHora = `No tengo disponibilidad para asistir`;

                salirDeLaConversacion();
                
            } else {
                await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indice un numero de la lista.");
            }

        } else if (userStates[from].stage === "esperando_otroCargo") {

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado === 1) {
                mirarOtrosCargos();

            } else if (numeroIngresado === 2) {
                userStates[from].data.entrevista = "No";
                salirDeLaConversacion();

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
        userStates[from].stage = "Tiempo Agotado";

        console.log("Datos almacenados en userStates:", userStates[from]);
        await guardarEnBaseDeDatos(userStates[from]); 

        delete userStates[user];
    }, 60 * 1000);
}

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'sicteferias.from-co.net',
    port: 3309,
    user: 'BryanUtria',
    password: 'Bry@n.98#',
    database: 'gestion_humana'
});

async function guardarEnBaseDeDatos(userData) {
    try {
        const sql = `
            INSERT INTO registros_chatbot (stage, nombreApellido, celular, ciudad, cargo, detalleCargo, respuestaFiltro1, respuestaFiltro2, respuestaFiltro3, direccion, fechaHora)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const valores = [
            userData.stage,
            userData.data.nombreApellido,
            userData.data.celular,
            userData.data.ciudad,
            userData.data.cargo,
            userData.data.detalleCargo,
            userData.data.respuestaFiltro1,
            userData.data.respuestaFiltro2,
            userData.data.respuestaFiltro3,
            userData.data.direccion.join(', '), // Convertir array a string si hay varias direcciones
            userData.data.fechaHora
        ];

        const connection = await pool.getConnection();
        await connection.execute(sql, valores);
        connection.release();
        console.log("✅ Datos guardados en MySQL");
    } catch (error) {
        console.error("❌ Error guardando en MySQL:", error);
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
