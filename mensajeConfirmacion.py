import pyodbc
import requests
import pandas as pd
from dateutil import parser
import locale

# Configurar el locale en español (para interpretar los nombres de días y meses)
locale.setlocale(locale.LC_TIME, 'es_ES.UTF-8')

print("... Leyendo archivos de la base ...")
conexion = pyodbc.connect('DSN=CCOT Ferias;UID=BryanUtria;PWD=Bry@n.98#;DATABASE=gestion_humana;CHARSET=utf8mb4')
consulta = "SELECT * FROM registros_chatbot"
df_registros = pd.read_sql_query(consulta, conexion)
conexion.close()

conexion = pyodbc.connect('DSN=CCOT Ferias;UID=BryanUtria;PWD=Bry@n.98#;DATABASE=gestion_humana;CHARSET=utf8mb4')
consulta = "SELECT * FROM ciudad_cargos"
df_datos = pd.read_sql_query(consulta, conexion)
conexion.close()

print("... Adecuando datos ...")
# Función para convertir la fecha
def convertir_fecha(fecha_str):
    fecha = parser.parse(fecha_str, fuzzy=True)  # Detecta automáticamente la fecha
    return fecha.strftime('%Y-%m-%d')  # Formato YYYY/MM/DD

df_registros = df_registros[df_registros['estadoFinal'] == "Confirmado"]
df_registros['fechaHora2'] = pd.to_datetime(df_registros['fechaHora'].apply(convertir_fecha), errors='coerce')

# Actualizar estado para a Finalizado en BD para dias anteriores al actual
fecha_actual = pd.Timestamp.today().normalize()

print("... Actualizando estado para dias anteriores ...")
df_actualizar_anteriores = df_registros[df_registros['fechaHora2'] < fecha_actual]
conexion = pyodbc.connect('DSN=CCOT Ferias;UID=BryanUtria;PWD=Bry@n.98#;DATABASE=gestion_humana;CHARSET=utf8mb4')
cursor = conexion.cursor()
for index, row in df_actualizar_anteriores.iterrows():
    query = f"""
    UPDATE registros_chatbot 
    SET estadoFinal = 'Finalizado' 
    WHERE id = ?
    """
    cursor.execute(query, (row['id'],))
conexion.commit()
cursor.close()
conexion.close()

print("... Enviando mensaje para confirmados y actualizando estado en BD ...")
df_actualizar_posteriores = df_registros[df_registros['fechaHora2'] >= fecha_actual]

url = "https://sicte-sas-chatbotgestionhumana.onrender.com/enviar-mensaje"

headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer EAAckKNFSZCZBUBOZC7nynsQMXCaywrSAcJOWZC4bojx4bGZAhyRfIxFQ2Sp0uClFT6AF5cAjWUh00jo08GpKKAELTdFkOjEgopY8Tm1jhBZAajqmVuv7EuIi6GEC7OEJLf0EKtdaAXPTF6jBZCnkzqs06ZCA0D25lwackJ2rTMDMXXImv9sh62kMBYdFiD9fi8Yo4AZDZD"  # Reemplaza con el token si es necesario
}

for _, row in df_actualizar_posteriores.iterrows():
    ciudad = row["ciudad"]
    fila_ciudad = df_datos[df_datos["Ciudad"] == ciudad].head(1)

    data = {
        "numero": row["celularChat"],
        "nombre": row["nombreApellido"],
        "fecha": row["fechaHora"],
        "direccion": row["direccion"],
        "ciudad": row["ciudad"],
        "nombreGH": fila_ciudad["Nombre"].values[0],
        "numeroGH": fila_ciudad["Celular"].values[0]
    }

    # Hacer la petición POST
    response = requests.post(url, json=data, headers=headers)

    # Imprimir la respuesta
    print(f"Enviando mensaje a {data}")
    print(f"Status Code: {response.status_code}")
    
    try:
        print("Respuesta:", response.json())  # Intentar parsear JSON
    except:
        print("Error en la respuesta:", response.text)  # Mostrar texto si no es JSON

    # conexion = pyodbc.connect('DSN=CCOT Ferias;UID=BryanUtria;PWD=Bry@n.98#;DATABASE=gestion_humana;CHARSET=utf8mb4')
    # cursor = conexion.cursor()
    # query = f"""
    # UPDATE registros_chatbot 
    # SET estadoFinal = 'Finalizado' 
    # WHERE id = ?
    # """
    # cursor.execute(query, (row['id'],))
    # conexion.commit()
    # cursor.close()
    # conexion.close()
