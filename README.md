# Pregúntale a mi pantalla — extensión de Safari

Panel flotante que lee la pestaña actual (texto + captura) y responde tus dudas con Gemini.

## Instalar (Mac con Xcode)

Safari solo carga extensiones empaquetadas dentro de una app de macOS, así que hay que convertirla una vez:

1. Instala Xcode desde la App Store (y ábrelo una vez para aceptar la licencia).
2. En Terminal, dentro de la carpeta que contiene `safari-ask-screen/`:

   ```
   xcrun safari-web-extension-converter safari-ask-screen --app-name "Pregunta a mi pantalla" --macos-only
   ```

3. Se abre el proyecto en Xcode. Arriba selecciona el esquema "Pregunta a mi pantalla (macOS)" y pulsa ▶ Run.
4. Safari > Ajustes > Avanzado > activa "Mostrar funciones para desarrolladores".
5. En Xcode, selecciona el proyecto > Signing & Capabilities, y en los DOS targets (app y extensión) elige tu Apple ID en "Team". Cambia el Bundle Identifier a uno propio (la extensión debe ser el de la app + `.Extension`). Así Safari no exige "Permitir extensiones sin firmar" en cada reinicio. Si prefieres no firmar, activa esa opción en Safari > Ajustes > Desarrollador (se desactiva al cerrar Safari).
6. Safari > Ajustes > Extensiones > activa "Pregúntale a mi pantalla" y en "Permisos" elige "Permitir en todos los sitios web".
7. En esa misma pantalla abre las opciones de la extensión y pega tu API key de Gemini (aistudio.google.com/apikey).

## Uso

- Clic en el icono de la extensión, o **Opción + Shift + A**, para abrir/cerrar el panel.
- Escribe tu duda. Con "Incluir captura" activado se envía también una imagen de lo que ves.
- Si seleccionas texto en la página antes de preguntar, se envía como contexto destacado.

## Límites a tener en cuenta

- Lee solo la pestaña activa y su frame principal (no iframes). No funciona en el visor de PDF de Safari ni en páginas internas (about:, ajustes).
- La captura es del área visible, no de toda la página con scroll; el texto sí es de toda la página (hasta ~60.000 caracteres).
- No ve otras apps ni el escritorio completo.
- No hay streaming: la respuesta aparece completa al terminar.

## Privacidad y seguridad

- Cada pregunta envía a Google (Gemini) el texto de la página y (opcional) la captura. No lo uses en banca, correo corporativo o intranets: añade esos dominios en "Sitios bloqueados" en las opciones.
- La API key vive en el almacenamiento local de la extensión y solo la usa el script de fondo; las páginas no pueden leerla. Aun así, usa una key dedicada con límite de gasto.
- El contenido de la página se trata como datos no confiables (defensa básica contra inyección de prompts); no es infalible.

## Licencia

MIT. Proyecto personal, sin garantía. No está afiliado a Google.
