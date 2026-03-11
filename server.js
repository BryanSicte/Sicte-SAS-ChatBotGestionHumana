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

        async function salirDeLaConversacion() {
            console.log("Datos almacenados en userStates:", userStates[from]);

            if (userStates[from].stage === 'esperando_tratamientoDeDatos') {

                await sendMessage(from, `🔹 Gracias por comunicarte con nosotros, en Sicte SAS. Recuerda que puedes revisar nuestra lista de ofertas en cualquier momento. ¡Estamos aquí para ayudarte!
                    \nPara mantenerte informado de nuestras ofertas laborales síguenos en nuestro canal de WhatsApp: https://whatsapp.com/channel/0029VbAzYTLFMqrUNzwotM0l.`);
            } else {

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();

                await sendMessage(from, `🔹 ${nombreFormateado}, gracias por comunicarte con nosotros, en Sicte SAS. Recuerda que puedes revisar nuestra lista de ofertas en cualquier momento. ¡Estamos aquí para ayudarte!
                    \nPara mantenerte informado de nuestras ofertas laborales síguenos en nuestro canal de WhatsApp: https://whatsapp.com/channel/0029VbAzYTLFMqrUNzwotM0l.`);
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
                .filter(c => c.ciudad === userStates[from].data.ciudad)
                .map(c => c.cargo);

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
                .filter(c => c.ciudad === userStates[from].data.ciudad)
                .map(c => c.direccion);

            const direccion = [...new Set(direcciones)].sort();

            userStates[from].stage = "Completado";
            userStates[from].data.direccion = direccion;

            const ahora = new Date().toLocaleString("en-US", { timeZone: "America/Bogota" });
            const horaActual = new Date(ahora).getHours();
            const diaSemana = new Date(ahora).getDay();
            let opciones;

            if (userStates[from].data.ciudad === "Bogotá") {
                opciones = [
                    `➊ ${fechaMañana} a las 8:30 am.`,
                    `➋ ${fechaMañana} a las 2:00 pm.`,
                    `➌ ${fechaPasadoMañana} a las 8:30 am.`,
                    `➍ ${fechaPasadoMañana} a las 2:00 pm.`,
                ];

                if (diaSemana === 4 || (diaSemana === 5 && horaActual < 16)) {
                    opciones.push(`➎ ${fechaProximoSabado} a las 8:00 am.`);
                    opciones.push(`➏ No tengo disponibilidad para asistir.`);
                } else {
                    opciones.push(`➎ No tengo disponibilidad para asistir.`);
                }

                if (horaActual >= 16) {
                    opciones.shift(); // Elimina la primera opción (8:30 am de mañana)
                }
            } else if (userStates[from].data.ciudad === "Zipaquirá y Sabana Norte") {
                opciones = [
                    `➊ ${fechaMañana} a las 8:30 am.`,
                    `➋ ${fechaMañana} a las 2:00 pm.`,
                    `➌ ${fechaPasadoMañana} a las 8:30 am.`,
                    `➍ ${fechaPasadoMañana} a las 2:00 pm.`,
                    `➎ No tengo disponibilidad para asistir.`
                ];

                if (horaActual >= 16) {
                    opciones.shift(); // Elimina la primera opción (8:30 am de mañana)
                }
            } else if (userStates[from].data.ciudad === "Armenia") {
                opciones = [
                    `➊ ${fechaMañana} a la 1:30 pm.`,
                    `➋ ${fechaPasadoMañana} a la 1:30 pm.`,
                    `➌ No tengo disponibilidad para asistir.`
                ];
            } else if (userStates[from].data.ciudad === "Manizales") {
                opciones = [
                    `➊ ${fechaMañana} a las 10:00 am.`,
                    `➋ ${fechaPasadoMañana} a las 10:00 am.`,
                    `➌ No tengo disponibilidad para asistir.`
                ];
            } else if (userStates[from].data.ciudad === "Pereira") {
                opciones = [
                    `➊ ${fechaMañana} a las 10:00 am.`,
                    `➋ ${fechaPasadoMañana} a las 10:00 am.`,
                    `➌ No tengo disponibilidad para asistir.`
                ];
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

        function obtenerProximoSabado(fechaBase) {
            const fecha = new Date(fechaBase);
            const diaActual = fecha.getDay(); // 0=Domingo, 6=Sábado
            const diasParaSabado = (6 - diaActual + 7) % 7 || 7; // Garantiza que siempre sea el próximo sábado
            fecha.setDate(fecha.getDate() + diasParaSabado);
            return fecha;
        }

        const from = message.from;
        let text = message.text?.body || "Mensaje vacío";

        console.log(`📩 Mensaje recibido de ${from}: ${text}`);

        restartUserTimer(from);

        let hoy = new Date();
        let diaMañana = obtenerDiaHabil(hoy, 1);
        let diaPasadoMañana = obtenerDiaHabil(diaMañana, 1);
        let proximoSabado = obtenerProximoSabado(hoy);

        let opcionesFecha = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        let fechaMañana = diaMañana.toLocaleDateString('es-ES', opcionesFecha);
        let fechaPasadoMañana = diaPasadoMañana.toLocaleDateString('es-ES', opcionesFecha);
        let fechaProximoSabado = proximoSabado.toLocaleDateString('es-ES', opcionesFecha);

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

            const ciudadesUnicas = [...new Set(ciudades.map(c => c.ciudad))].sort();

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

            const ciudadesUnicas = [...new Set(ciudadesCache.map(c => c.ciudad))].sort();

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado >= 1 && numeroIngresado <= ciudadesUnicas.length) {
                const ciudadSeleccionada = ciudadesUnicas[numeroIngresado - 1];

                const cargosDisponibles = ciudadesCache
                    .filter(c => c.ciudad === ciudadSeleccionada)
                    .map(c => c.cargo);

                const cargosUnicos = [...new Set(cargosDisponibles)].sort();

                const numerosIconos = ["➊", "➋", "➌", "➍", "➎", "➏", "➐", "➑", "➒", "➓"];
                const listaCargos = cargosUnicos
                    .map((cargo, index) => `\n ${numerosIconos[index] || index + 1} ${cargo}`)
                    .join("");

                const PersonasDisponibles = ciudadesCache
                    .filter(c => c.ciudad === ciudadSeleccionada)
                    .map(c => c.nombre);

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
                .filter(c => c.ciudad === userStates[from].data.ciudad)
                .map(c => c.cargo);

            const cargosUnicos = [...new Set(cargosDisponibles)].sort();

            const numeroIngresado = parseInt(text, 10);
            if (numeroIngresado >= 1 && numeroIngresado <= cargosUnicos.length) {
                const cargoSeleccionado = cargosUnicos[numeroIngresado - 1];

                userStates[from].data.cargo = cargoSeleccionado;

                if (userStates[from].data.cargo === "Ayudante (Sin Moto)" || userStates[from].data.cargo === "Aparejador (Electrico)"
                    || userStates[from].data.cargo === "Líder Técnico Licencia C1 - C2 (Electrico)" || userStates[from].data.cargo === "Operador de Equipo Hidráulico (Electrico)"
                    || userStates[from].data.cargo === "Técnico Operativo (Electrico)"
                ) {
                    userStates[from].stage = "esperando_detalleCargo";
                } else if (userStates[from].data.cargo === "Conductor" || userStates[from].data.cargo === "Motorizados" || userStates[from].data.cargo === "Conductor – Ayudante de Obra Civil y Telecomunicaciones") {
                    userStates[from].stage = "esperando_filtro1";
                }

                let nombre = userStates[from].data.nombreApellido.split(" ")[0];
                let nombreFormateado = nombre.charAt(0).toUpperCase() + nombre.slice(1).toLowerCase();
                let detalleCargo;

                if (cargoSeleccionado === "Motorizados") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos personas con motocicleta para realizar instalaciones de internet, televisión y telefonía en la ciudad ${userStates[from].data.ciudad}.
                        \n¡NO SE REQUIERE EXPERIENCIA NOSOTROS TE CAPACITAMOS!
                        \n*Requisitos del vehículo:*\n• Cilindraje de 125cc en adelante.\n• No debe ser tipo scooter.\n• Modelo 2016 en adelante.
                        \n¿Qué te ofrecemos?
                        \n• Salario: $1.750.905 + $500.000 rodamiento + $249.095 auxilio de transporte + ¡Excelente! tabla de bonificaciones y todas las prestaciones de ley.\n• Contrato a término indefinido.\n• Plan carrera.\n•	Capacitación paga.\n• Se realiza curso de alturas una vez se firme contrato laboral.\n•	Horario: Lunes a sábado con disponibilidad de laborar 2 domingos.
                    `
                } else if (cargoSeleccionado === "Conductor") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos conductores con licencia C1 o C2 para realizar instalaciones de internet, televisión y telefonía en la ciudad ${userStates[from].data.ciudad}.
                        \n¿Qué te ofrecemos?
                        \n• Salario: $1.750.905 + $310.000 aux. movilizacion + $249.095 auxilio de transporte + todas las prestaciones de ley.\n• Contrato a término indefinido.\n• Plan carrera.\n• Capacitación paga.\n• Se realiza curso de alturas una vez se firme contrato laboral.\n• Horario: Lunes a sábado con disponibilidad de laborar 2 domingos.
                    `
                } else if (cargoSeleccionado === "Ayudante (Sin Moto)") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos bachilleres para realizar instalaciones de internet, televisión y telefonía en la ciudad ${userStates[from].data.ciudad}.
                        \n¡NO SE REQUIERE EXPERIENCIA NOSOTROS TE CAPACITAMOS!
                        \n¿Qué te ofrecemos?
                        \n• Salario: $1.750.905 + $249.095 auxilio de transporte + ¡Excelente! tabla de bonificaciones y todas las prestaciones de ley.\n• Contrato a término indefinido.\n• Plan carrera.\n• Capacitación paga.\n•	Se realiza curso de alturas una vez se firme contrato laboral.\n• Horario: Lunes a sábado con disponibilidad de laborar 2 domingos.
                    `                    
                } else if (cargoSeleccionado === "Aparejador (Electrico)") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos para la ciudad ${userStates[from].data.ciudad}.
                        \n🏗️ Vacante Laboral: Aparejador\n📍 Ubicación: Bogotá [Zona centro y sur]\n⏰ Jornada: Horarios rotativos.\n💰Salario: $2'000.000\n📢 ¡Únete a un equipo que construye con seguridad, precisión y compromiso!
                        \n🔧 ¿Qué harás como Aparejador?\nBuscamos un profesional comprometido y disciplinado que garantice la correcta ejecución de actividades de izaje, mantenimiento e instalación en redes eléctricas, cumpliendo estrictamente con los estándares de seguridad y calidad.
                        \nTus principales funciones serán:\n• Verificar el estado de equipos de izaje (eslingas, estrobos, ganchos, etc.).\n• Ejecutar actividades de mantenimiento, instalación y cambio de postería.\n• Señalizar y adecuar el área de trabajo al iniciar y finalizar cada tarea.\n• Participar en pruebas de control de alcohol y drogas.\n• Reportar incidentes y participar en su investigación.\n• Garantizar el cumplimiento del plan de izaje de cargas y normativas de seguridad vigentes.\n• Utilizar y cuidar adecuadamente herramientas, equipos y EPP asignados.\n• Registrar correctamente la información de actividades realizadas.\n• Desplazarse según la naturaleza del cargo.
                        \n✅ Lo que necesitas para aplicar:
                        \n🎓 Educación: \n• Mínimo Bachiller Académico.
                        \n🧰 Formación Requerida:\n• Curso de alturas (nivel trabajador autorizado y/o reentrenamiento).\n• Curso de Aparejador de Grúa.\n• Capacitación en el Sistema de Gestión Integral.
                        \n🏗️ Experiencia:\nMínimo 6 meses de experiencia en trabajos relacionados con sistemas de distribución eléctrica aérea y/o subterránea.
                        \n🧑‍🔧 ¿Por qué trabajar con nosotros?\n• Entorno seguro y profesional.\n• Formación y capacitación continua.\n• Oportunidades de desarrollo en el sector eléctrico.\n• Estabilidad laboral y beneficios extra legales
                    `
                } else if (cargoSeleccionado === "Líder Técnico Licencia C1 - C2 (Electrico)") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos para la ciudad ${userStates[from].data.ciudad}.
                        \n🚛 Vacante: Líder Técnico Licencia C1 - C2\n📍 Ubicación: Bogotá [Zona centro y Sur]\n✍🏻Tipo de contrato:Indefinido\n⏰ Horarios: Rotativos.\n💰Salario: $3'300.000.\n📣¡Sé parte de un equipo que ilumina ciudades con responsabilidad y liderazgo!
                        \n🔧 ¿Qué harás?\nComo Líder Técnico Licencia C1 - C2, serás responsable de: Conducir y operar vehículos y maquinaria hidráulica (canasta, grúa). Coordinar y ejecutar actividades de instalación, mantenimiento y reparación del sistema de alumbrado público (redes aéreas y subterráneas MT/BT/AP). Velar por el cumplimiento de normas de seguridad, correcta documentación de actividades y manejo eficiente de materiales. Garantizar el buen estado del vehículo, herramientas y elementos de protección personal (EPP). Transportar al equipo técnico y asegurar el cumplimiento de las rutas asignadas.
                        \n✅ Requisitos\n🎓Educación: Técnico o tecnólogo en electricidad o afines.\nMatrícula CONTE: TE3 y TE5 (vigente).\nLicencia: C1 o C2.
                        \n🧰Formación adicional:\n• Curso de alturas (trabajador autorizado o reentrenamiento)\n• Capacitación en sistema de gestión integral
                        \n🏗️ Experiencia:\n• 3 años en redes eléctricas MT/BT/AP\n• 1 año conduciendo vehículos.
                    `
                } else if (cargoSeleccionado === "Operador de Equipo Hidráulico (Electrico)") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos para la ciudad ${userStates[from].data.ciudad}.
                        \n🛠️ Vacante: Operador de Equipo Hidráulico\nUbicación: Bogotá [Zona centro y sur]\nTipo de contrato:Indefinido.\nHorario: Turnos rotativos\nSalario: $2'700.000
                        \n🚧 ¿Qué harás?\nOperarás equipos hidráulicos (elevadores tipo canasta, grúas, etc.) para instalación, mantenimiento y cambio de redes eléctricas MT/BT/AP y alumbrado público. Asegurarás el cumplimiento de normas de seguridad, manejo eficiente de materiales y registros técnicos, y transportarás personal y herramientas al sitio de trabajo.
                        \n✅ Requisitos\n• Formación: Técnico o tecnólogo en electricidad o afines.\n• Licencia y Matrícula: CONTE TE3 y TE5 vigentes.\n• Cursos: Alturas (nivel autorizado)\n• Operador de maquinaria hidráulica\n• Sistema de Gestión Integral
                        \nExperiencia:\n3 años en redes eléctricas MT/BT/AP\n2 años operando maquinaria hidráulica\n1 año conduciendo vehículos.
                    `
                } else if (cargoSeleccionado === "Técnico Operativo (Electrico)") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos para la ciudad ${userStates[from].data.ciudad}.
                        \n💡 Vacante: Técnico Operativo\nUbicación: Bogotá [Zona centro y sur]\nTipo de contrato: Indefinido\nHorarios: Rotativos\nSalario: $2'650.000\nÁrea: Alumbrado público – Redes eléctricas MT/BT/AP
                        \n🎯 Objetivo del Cargo\nGarantizar el funcionamiento eficiente del sistema de alumbrado público a través de labores de instalación, mantenimiento, inspección y reparación, cumpliendo con altos estándares de calidad, seguridad y tiempos establecidos.
                        \n🔧 Responsabilidades Principales\nEjecutar mantenimiento, instalación y cambio de luminarias.\nRealizar trabajos en redes eléctricas aéreas y subterráneas MT/BT/AP.\nSeñalizar y adecuar las zonas de trabajo.\nDiligenciar formatos operativos y reportes técnicos.\nCumplir con normativas de seguridad, salud en el trabajo y medio ambiente.\nPortar y usar correctamente el EPP, herramientas y dotación asignada.\nAsegurar orden, limpieza y buena presentación del lugar de trabajo.\nParticipar en pruebas de control (alcohol y drogas) y actividades del SIG.
                        \n✅ Requisitos del Cargo\nFormación académica: Técnico o tecnólogo en electricidad o áreas afines.\nMatrícula profesional: CONTE vigente (TE3 y TE5).
                    `
                } else if (cargoSeleccionado === "Conductor – Ayudante de Obra Civil y Telecomunicaciones") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos para la ciudad ${userStates[from].data.ciudad}.
                        \n🚨 OPORTUNIDAD LABORAL – AYUDANTE CONDUCTOR 🚨\n📍 Trabajo en campo | Contrato a término indefinido | Contratación inmediata\n💰 Salario total: $1.933.500\n• Básico: $1.750.905\n• Aux. transporte: $249.095\n• Bono movilidad: $310.000\n• Prestaciones de ley y capacitación paga
                        \n👷 Funciones principales\n• Apoyar en instalación de redes de telecomunicaciones\n• Acompañar la conducción y transporte de equipos y herramientas\n• Ejecutar tareas de ayudante de obra civil: excavaciones, canalizaciones, mezcla de materiales, preparación de terreno y apoyo en obras menores\n• Participar en sondeos e instalación de baterías\n• Cuidar vehículo, herramientas y materiales\n• Cumplir protocolos de seguridad (incluye trabajo en altura)
                        \n📌 Requisitos\n✔ Saber leer y escribir (bachiller deseable)\n✔ 10 meses de experiencia conduciendo (camioneta o similar)\n✔ Licencia C1 o C2 vigente\n✔ Disponibilidad para turnos diurnos o nocturnos\n✔ Buena actitud, responsabilidad y trabajo en equipo
                        \n🎁 Beneficios\n✅ Contrato directo con la empresa\n✅ Prestaciones sociales completas\n✅ Estabilidad y oportunidad de crecimiento\n✅ Ambiente laboral activo y colaborativo
                        \n📣 ¡Postúlate hoy y sé parte de un equipo que construye y conecta! 🚀
                    `
                } else if (cargoSeleccionado === "Oficial de Obra Civil") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos para la ciudad ${userStates[from].data.ciudad}.
                        \n🚨 OPORTUNIDAD LABORAL – OFICIAL DE OBRA CIVIL 🚨\n📍 Trabajo en campo | Contrato Indefinido | Contratación inmediata\n💰 Salario total: $2.414.095\n• Básico: $1.850.000\n• Aux. transporte: $249.095\n• Bono movilidad: $315.000\n• Prestaciones de ley completas
                        \n👷 Funciones principales\n• Ejecutar labores de obra negra y gris en proyectos de construcción y/o telecomunicaciones\n• Realizar excavaciones, canalizaciones y preparación de mezclas\n• Apoyar en la instalación de infraestructura y redes\n• Leer e interpretar planos básicos para la correcta ejecución de tareas\n• Mantener el orden y limpieza en el área de trabajo\n• Cumplir con los protocolos de seguridad y calidad establecidos
                        \n📌 Requisitos\n✔ Bachiller titulado\n✔ Mínimo 1 año de experiencia en Obra Negra y Gris\n✔ Capacidad para trabajar en equipo y seguir instrucciones\n✔ Alta disposición y capacidad de aprendizaje\n✔ Disponibilidad para trabajar en campo
                        \n🎁 Beneficios\n✅ Contrato indefinido directo con la empresa\n✅ Prestaciones sociales completas (prima, cesantías, vacaciones, etc.)\n✅ Estabilidad laboral y oportunidad de crecimiento\n✅ Ambiente de trabajo profesional y colaborativo
                        \n📣 ¡Postúlate hoy y sé parte de un equipo que construye y conecta! 🚀
                    `
                } else if (cargoSeleccionado === "Diseñador de Redes Electricas") {
                    detalleCargo = `🔹 ${nombreFormateado}, en este momento buscamos para la ciudad ${userStates[from].data.ciudad}.
                        \n🚨 OPORTUNIDAD LABORAL – DISEÑADOR DE REDES ELÉCTRICAS 🚨\n📍 Trabajo en oficina | Contrato Indefinido | Contratación inmediata\n💰 Salario total: $4.000.000\n• Básico: $3.200.000\n• Bono o auxilio: $800.000\n• Prestaciones de ley completas
                        \n👷 Funciones principales\n• Elaborar diseños de redes de Media y Baja Tensión (MT/BT) cumpliendo normativas vigentes\n• Diseñar planos eléctricos utilizando AutoCAD o MicroStation\n• Asegurar el cumplimiento de normas RETIE, NTC y requisitos del Operador de Red\n• Generar memorias de cálculo, informes técnicos y documentación para aprobación de proyectos
                        \n📌 Requisitos\n✔ Profesional en Ingeniería Eléctrica, Electromecánica o carreras afines\n✔ Mínimo 2 años de experiencia en diseño de redes MT/BT\n✔ Conocimiento profundo de RETIE, NTC y normas del Operador de Red\n✔ Manejo de software de cálculo y simulación eléctrica\n✔ Dominio de AutoCAD o MicroStation para planimetría\n✔ Experiencia en coordinación de protecciones y estudios de cortocircuito
                        \n🎁 Beneficios\n✅ Contrato indefinido directo con la empresa\n✅ Salario competitivo con bono incluido\n✅ Prestaciones sociales completas (prima, cesantías, vacaciones, caja de compensación)\n✅ Estabilidad laboral y oportunidad de desarrollo profesional\n✅ Ambiente de trabajo técnico y colaborativo
                        \n📣 ¡Únete a nuestro equipo de ingeniería y construye redes seguras y eficientes! ⚡
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
                } else if (userStates[from].data.cargo === "Conductor" || userStates[from].data.cargo === "Conductor – Ayudante de Obra Civil y Telecomunicaciones") {
                    userInfo = `
                        🔹 ${nombreFormateado}, nos alegra que continues en el proceso, ¿Cuentas con experiencia certificada en conducción en empresas o aplicaciones?
                        \n➊ Si, más de 10 meses.\n➋ Si, menos de 10 meses.\n➌ No tengo experiencia certificada.
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

                    let mensajeRechazo;
                    mensajeRechazo = "No cumples con uno de los requisito para el cargo el cual es tener moto propia."

                    userInfo = `
                        🔹 ${mensajeRechazo}.
                    `;

                    await sendMessage(from, userInfo);

                    preguntaMirarOtrosCargos();
                } else {
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indique 1 para Si o 2 para No.");
                }

            } else if (userStates[from].data.cargo === "Conductor" || userStates[from].data.cargo === "Conductor – Ayudante de Obra Civil y Telecomunicaciones") {

                const numeroIngresado = parseInt(text, 10);
                if (numeroIngresado === 1) {
                    userStates[from].data.respuestaFiltro1 = "Si, más de 10 meses.";
                    userStates[from].stage = "esperando_detalleCargo";

                    const userInfo = `
                        🔹 ${nombreFormateado}, ¿Qué tipo de licencia de conducción tienes vigente?
                        \nPor favor, selecciona la opción correspondiente colocando el número:
                        \n➊ C1\n➋ C2\n➌ C3\n➍ No tengo licencia de conducción categoría C
                    `;

                    await sendMessage(from, userInfo);

                } else if (numeroIngresado >= 2 && numeroIngresado <= 3) {
                    if (numeroIngresado === 2) {
                        userStates[from].data.respuestaFiltro1 = "Si, menos de 10 meses.";
                    } else if (numeroIngresado === 3) {
                        userStates[from].data.respuestaFiltro1 = "No tengo experiencia certificada.";
                    }

                    let mensajeRechazo;
                    mensajeRechazo = "No cumples con uno de los requisito para el cargo el cual es tener mas de 10 meses de experiencia."

                    userInfo = `
                        🔹 ${mensajeRechazo}.
                    `;

                    await sendMessage(from, userInfo);

                    preguntaMirarOtrosCargos();
                } else {
                    await sendMessage(from, "⚠️ El valor ingresado no es válido. Por favor, indique un numero entre 1 y 3.");
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

            } else if (userStates[from].data.cargo === "Conductor" || userStates[from].data.cargo === "Conductor – Ayudante de Obra Civil y Telecomunicaciones") {

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

            } else if (userStates[from].data.cargo === "Ayudante (Sin Moto)" || userStates[from].data.cargo === "Aparejador (Electrico)"
                || userStates[from].data.cargo === "Líder Técnico Licencia C1 - C2 (Electrico)" || userStates[from].data.cargo === "Operador de Equipo Hidráulico (Electrico)" 
                || userStates[from].data.cargo === "Técnico Operativo (Electrico)" || userStates[from].data.cargo === "Oficial de Obra Civil"
                || userStates[from].data.cargo === "Diseñador de Redes Electricas"
            ) {

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
            const diaSemana = new Date(ahora).getDay();

            const ciudad = userStates[from].data.ciudad;
            const numeroIngresado = parseInt(text, 10);

            if ((numeroIngresado === 5 && (diaSemana === 4 || (diaSemana === 5 && horaActual < 16)) && ciudad === "Bogotá") ||
                (numeroIngresado === 1 && horaActual < 16 && (ciudad === "Bogotá" || ciudad === "Zipaquirá y Sabana Norte")) ||
                (numeroIngresado >= 2 && numeroIngresado <= 4 && (ciudad === "Bogotá" || ciudad === "Zipaquirá y Sabana Norte")) ||
                (numeroIngresado >= 1 && numeroIngresado <= 2 && (ciudad === "Armenia")) ||
                (numeroIngresado >= 1 && numeroIngresado <= 2 && (ciudad === "Manizales")) ||
                (numeroIngresado >= 1 && numeroIngresado <= 2 && (ciudad === "Pereira"))) {

                if (ciudad === "Bogotá") {
                    if (numeroIngresado === 1) {
                        userStates[from].data.fechaHora = `${fechaMañana} a las 8:30 am`;
                    } else if (numeroIngresado === 2) {
                        userStates[from].data.fechaHora = `${fechaMañana} a las 2:00 pm`;
                    } else if (numeroIngresado === 3) {
                        userStates[from].data.fechaHora = `${fechaPasadoMañana} a las 8:30 am`;
                    } else if (numeroIngresado === 4) {
                        userStates[from].data.fechaHora = `${fechaPasadoMañana} a las 2:00 pm`;
                    } else if (numeroIngresado === 5) {
                        userStates[from].data.fechaHora = `${fechaProximoSabado} a las 8:00 am`;
                    }
                } else if (ciudad === "Zipaquirá y Sabana Norte") {
                    if (numeroIngresado === 1) {
                        userStates[from].data.fechaHora = `${fechaMañana} a las 8:30 am`;
                    } else if (numeroIngresado === 2) {
                        userStates[from].data.fechaHora = `${fechaMañana} a las 2:00 pm`;
                    } else if (numeroIngresado === 3) {
                        userStates[from].data.fechaHora = `${fechaPasadoMañana} a las 8:30 am`;
                    } else if (numeroIngresado === 4) {
                        userStates[from].data.fechaHora = `${fechaPasadoMañana} a las 2:00 pm`;
                    }
                } else if (ciudad === "Armenia") {
                    if (numeroIngresado === 1) {
                        userStates[from].data.fechaHora = `${fechaMañana} a las 1:30 pm`;
                    } else if (numeroIngresado === 2) {
                        userStates[from].data.fechaHora = `${fechaPasadoMañana} a las 1:30 pm`;
                    }
                } else if (ciudad === "Manizales") {
                    if (numeroIngresado === 1) {
                        userStates[from].data.fechaHora = `${fechaMañana} a las 10:00 am`;
                    } else if (numeroIngresado === 2) {
                        userStates[from].data.fechaHora = `${fechaPasadoMañana} a las 10:00 am`;
                    }
                } else if (ciudad === "Pereira") {
                    if (numeroIngresado === 1) {
                        userStates[from].data.fechaHora = `${fechaMañana} a las 10:00 am`;
                    } else if (numeroIngresado === 2) {
                        userStates[from].data.fechaHora = `${fechaPasadoMañana} a las 10:00 am`;
                    }
                }

                let textoAdicional;

                if (userStates[from].data.cargo === "Motorizados" || userStates[from].data.cargo === "Conductor") {
                    textoAdicional = `3. Fotocopia de la licencia de conducción.`
                } else {
                    textoAdicional = ``
                }

                const PersonasDisponibles = ciudadesCache
                    .filter(c => c.ciudad === userStates[from].data.ciudad)
                    .map(c => c.nombre);

                const personasUnicas = [...new Set(PersonasDisponibles)].sort();

                const NumerosDisponibles = ciudadesCache
                    .filter(c => c.ciudad === userStates[from].data.ciudad)
                    .map(c => c.celular);

                const numerosUnicos = [...new Set(NumerosDisponibles)].sort();

                const userInfo = `
                🔹 ${nombreFormateado}, gracias por confirmar tu asistencia, recuerda que mi nombre es ${personasUnicas} y te espero el día ${userStates[from].data.fechaHora} en la dirección ${userStates[from].data.direccion} de la ciudad ${userStates[from].data.ciudad}.
                \nPor favor no olvides traer los siguientes documentos:
                \n1. Hoja de vida actualizada\n2. Fotocopia de la cedula al 150%\n${textoAdicional}
                \nPara mantenerte informado de nuestras ofertas laborales síguenos en nuestro canal de WhatsApp: https://whatsapp.com/channel/0029VbAzYTLFMqrUNzwotM0l.
                \nSi tienes alguna inquietud puedes contactarme al número de teléfono ${numerosUnicos}\n👋 Ten un excelente dia.
                `;

                await sendMessage(from, userInfo);

                console.log("Datos almacenados en userStates:", userStates[from]);

                await guardarEnBaseDeDatos(userStates[from], from);

                delete userStates[from];

            } else if (((numeroIngresado === 5 || (numeroIngresado === 6 && (diaSemana === 4 || diaSemana === 5))) && userStates[from].data.ciudad === "Bogotá") ||
                (numeroIngresado === 5 && userStates[from].data.ciudad === "Zipaquirá y Sabana Norte") ||
                (numeroIngresado === 3 && (userStates[from].data.ciudad === "Pereira" || userStates[from].data.ciudad === "Armenia" || userStates[from].data.ciudad === "Manizales"))) {

                userStates[from].data.fechaHora = `No tengo disponibilidad para asistir`;

                const PersonasDisponibles = ciudadesCache
                    .filter(c => c.ciudad === userStates[from].data.ciudad)
                    .map(c => c.nombre);

                const personasUnicas = [...new Set(PersonasDisponibles)].sort();

                const NumerosDisponibles = ciudadesCache
                    .filter(c => c.ciudad === userStates[from].data.ciudad)
                    .map(c => c.celular);

                const numerosUnicos = [...new Set(NumerosDisponibles)].sort();

                const userInfo = `
                🔹 ${nombreFormateado}, gracias por comunicarte con nosotros, mi nombre es ${personasUnicas} y me estare comunicando contigo para validar tu disponibilidad. Recuerda que si tienes alguna inquietud puedes contactarme al numero ${numerosUnicos}.
                \nPara mantenerte informado de nuestras ofertas laborales síguenos en nuestro canal de WhatsApp: https://whatsapp.com/channel/0029VbAzYTLFMqrUNzwotM0l.
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
                        text: "¡Hola! Te damos la bienvenida a Sicte SAS, una empresa líder en telecomunicaciones, te encuentras en contacto con David Turriago del equipo de Gestión Humana.\n📜 Antes de iniciar y en cumplimiento de la Ley 1581 de 2012 y el Decreto 1377 de 2013, te informo que el tratamiento de tus datos personales se realizará conforme a nuestra política de privacidad que puedes consultar en: https://sicte.com/imagenes/certificados/politicadedatos.pdf.\n\n✅ ¿Aceptas estos términos?"
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

        const userInfo = `🕛 Tiempo de espera agotado para ${user}, Gracias por comunicarse con nosotros.
        \nPara mantenerte informado de nuestras ofertas laborales síguenos en nuestro canal de WhatsApp: https://whatsapp.com/channel/0029VbAzYTLFMqrUNzwotM0l.`;
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
            INSERT INTO registros_chatbot (registro, fuente, stage, celularChat, aceptoPolitica, nombreApellido, celular, ciudad, cargo, detalleCargo, respuestaFiltro1, respuestaFiltro2, respuestaFiltro3, direccion, fechaHora, estadoFinal, fechaHoraInicial)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            "Chatbot",
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
